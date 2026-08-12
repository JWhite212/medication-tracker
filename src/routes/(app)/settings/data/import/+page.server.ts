import { fail } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { medications, users } from "$lib/server/db/schema";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { confirmReauth } from "$lib/server/auth/reauth";
import { applyImport } from "$lib/server/import/apply";
import { buildPlanFromFile } from "$lib/server/import/pipeline";
import { planIsEmpty } from "$lib/server/import/plan";
import { ALL_SECTIONS, type ImportPlan, type NameMapping } from "$lib/server/import/types";
import { IMPORT_MAX_BYTES, importOptionsSchema, nameMappingSchema } from "$lib/utils/validation";
import type { Actions, PageServerLoad } from "./$types";

// A large import is a single bulk transaction rather than one write per
// row, but a 50k-dose file still needs more than the platform default.
export const config = { maxDuration: 60 };

const PREVIEW_WINDOW_MS = 15 * 60 * 1000;
const PREVIEW_MAX = 20;
const COMMIT_WINDOW_MS = 60 * 60 * 1000;
const COMMIT_MAX = 5;

const REPLACE_PHRASE = "REPLACE";

/** What the browser needs to render a preview. Deliberately not the
 * whole plan: that carries every source row, and shipping it to the
 * client then trusting it back would defeat the point of re-parsing on
 * commit. */
export type PreviewView = {
  format: ImportPlan["format"];
  mode: ImportPlan["mode"];
  summary: ImportPlan["summary"];
  warnings: string[];
  unmatchedNames: string[];
  createdNames: string[];
  reusedNames: string[];
  empty: boolean;
};

function toPreview(plan: ImportPlan): PreviewView {
  return {
    format: plan.format,
    mode: plan.mode,
    summary: plan.summary,
    warnings: plan.warnings,
    unmatchedNames: plan.unmatchedNames,
    createdNames: plan.medications
      .filter((m) => m.action === "create")
      .map((m) => m.source.name)
      .slice(0, 50),
    reusedNames: plan.medications
      .filter((m) => m.action === "reuse")
      .map((m) => m.source.name)
      .slice(0, 50),
    empty: planIsEmpty(plan),
  };
}

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user!.id;

  const [meds, [account]] = await Promise.all([
    db
      .select({ id: medications.id, name: medications.name, isArchived: medications.isArchived })
      .from(medications)
      .where(eq(medications.userId, userId))
      .orderBy(medications.isArchived, medications.sortOrder, medications.name),
    db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
  ]);

  return {
    medications: meds,
    // OAuth-only accounts have no password hash, so confirmReauth can
    // never succeed for them. They confirm by typing the phrase instead
    // — being locked out of restoring your own backup would be worse
    // than the marginal difference in gate strength.
    hasPassword: Boolean(account?.passwordHash),
    timezone: locals.user!.timezone,
    maxBytes: IMPORT_MAX_BYTES,
  };
};

type UploadResult = { ok: true; text: string; formData: FormData } | { ok: false; reason: string };

async function readUpload(request: Request): Promise<UploadResult> {
  // Reject on the declared length before buffering the body, so an
  // oversized upload doesn't have to be read into memory to be refused.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > IMPORT_MAX_BYTES) {
    return {
      ok: false,
      reason: `That file is over the ${IMPORT_MAX_BYTES / 1024 / 1024} MB limit.`,
    };
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { ok: false, reason: "The upload could not be read. Please try again." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, reason: "Choose a file to import." };
  }
  if (file.size > IMPORT_MAX_BYTES) {
    return {
      ok: false,
      reason: `That file is over the ${IMPORT_MAX_BYTES / 1024 / 1024} MB limit.`,
    };
  }

  return { ok: true, text: await file.text(), formData };
}

function readOptions(formData: FormData) {
  const parsed = importOptionsSchema.safeParse({
    mode: formData.get("mode") ?? undefined,
    sectionInventory: formData.get("sectionInventory") ?? undefined,
    sectionPreferences: formData.get("sectionPreferences") ?? undefined,
    sectionProfile: formData.get("sectionProfile") ?? undefined,
  });

  if (!parsed.success) {
    return { mode: "merge" as const, sections: { ...ALL_SECTIONS } };
  }

  return {
    mode: parsed.data.mode,
    sections: {
      inventory: parsed.data.sectionInventory,
      preferences: parsed.data.sectionPreferences,
      profile: parsed.data.sectionProfile,
    },
  };
}

function readMapping(formData: FormData): NameMapping {
  const raw = formData.get("mapping");
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = nameMappingSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Mapping entries may name a medication id — verify every one of them
 * belongs to this user before the planner can attach doses to it. */
async function assertMappingOwnership(userId: string, mapping: NameMapping): Promise<boolean> {
  const ids = Object.values(mapping)
    .filter((choice): choice is { action: "map"; medicationId: string } => choice.action === "map")
    .map((choice) => choice.medicationId);
  if (ids.length === 0) return true;

  const owned = await db
    .select({ id: medications.id })
    .from(medications)
    .where(eq(medications.userId, userId));
  const ownedIds = new Set(owned.map((row) => row.id));
  return ids.every((id) => ownedIds.has(id));
}

export const actions: Actions = {
  preview: async ({ request, locals }) => {
    const userId = locals.user!.id;

    const { allowed, retryAfterMs } = await checkRateLimit(
      `import-preview:${userId}`,
      PREVIEW_MAX,
      PREVIEW_WINDOW_MS,
    );
    if (!allowed) {
      return fail(429, {
        importError: `Too many import previews. Try again in ${Math.ceil(retryAfterMs / 60000)} minutes.`,
      });
    }

    const upload = await readUpload(request);
    if (!upload.ok) return fail(400, { importError: upload.reason });

    const options = readOptions(upload.formData);
    const mapping = readMapping(upload.formData);
    if (!(await assertMappingOwnership(userId, mapping))) {
      return fail(400, { importError: "That medication mapping isn't valid for your account." });
    }

    const result = await buildPlanFromFile(userId, upload.text, locals.user!.timezone, {
      ...options,
      nameMapping: mapping,
    });
    if (!result.ok) return fail(400, { importError: result.reason });

    return { preview: toPreview(result.plan) };
  },

  commit: async ({ request, locals }) => {
    const userId = locals.user!.id;

    const { allowed, retryAfterMs } = await checkRateLimit(
      `import-commit:${userId}`,
      COMMIT_MAX,
      COMMIT_WINDOW_MS,
    );
    if (!allowed) {
      return fail(429, {
        importError: `Too many imports. Try again in ${Math.ceil(retryAfterMs / 60000)} minutes.`,
      });
    }

    const upload = await readUpload(request);
    if (!upload.ok) return fail(400, { importError: upload.reason });

    const options = readOptions(upload.formData);
    const mapping = readMapping(upload.formData);
    if (!(await assertMappingOwnership(userId, mapping))) {
      return fail(400, { importError: "That medication mapping isn't valid for your account." });
    }

    if (options.mode === "replace") {
      const [account] = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (account?.passwordHash) {
        const password = String(upload.formData.get("password") ?? "");
        if (!password) {
          return fail(400, { importError: "Enter your password to replace all data." });
        }
        const reauth = await confirmReauth(userId, password, "import_replace_data");
        if (!reauth.ok) return fail(400, { importError: "Incorrect password." });
      } else {
        const phrase = String(upload.formData.get("confirmPhrase") ?? "").trim();
        if (phrase !== REPLACE_PHRASE) {
          return fail(400, {
            importError: `Type ${REPLACE_PHRASE} to confirm replacing all your data.`,
          });
        }
      }
    }

    // Re-parsed and re-planned from the uploaded bytes rather than
    // trusting anything the preview handed the browser, so there is no
    // path where client-supplied data reaches the writer.
    const result = await buildPlanFromFile(userId, upload.text, locals.user!.timezone, {
      ...options,
      nameMapping: mapping,
    });
    if (!result.ok) return fail(400, { importError: result.reason });

    const plan = result.plan;

    if (plan.unmatchedNames.length > 0) {
      return fail(400, {
        importError: "Some medications still need a decision before importing.",
        preview: toPreview(plan),
      });
    }

    if (planIsEmpty(plan)) {
      return fail(400, {
        importError: "Nothing to import — everything in that file is already in your account.",
        preview: toPreview(plan),
      });
    }

    const applied = await applyImport(userId, plan);

    return { imported: applied.summary, importId: applied.importId };
  },
};
