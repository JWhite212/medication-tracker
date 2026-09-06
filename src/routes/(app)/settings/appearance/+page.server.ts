import { error, fail } from "@sveltejs/kit";
import { getOrCreatePreferences, updatePreferences } from "$lib/server/preferences";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { appearanceFieldSchemas, APPEARANCE_ACTION_KEYS } from "$lib/appearance/schema";
import type { AppearanceKey } from "$lib/appearance/registry";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

// Instant save turns this page into an unthrottled authenticated write
// path, and audit rows have no retention policy. The client debounce is
// what keeps a normal session well inside this; the limit is here to
// bound a stuck control or a scripted client. Sized between the closest
// precedents: push-test is 5/15min, api-commands 60/60s.
const APPEARANCE_MAX = 60;
const APPEARANCE_WINDOW_MS = 60 * 1000;

export const load: PageServerLoad = async ({ locals }) => {
  const prefs = await getOrCreatePreferences(locals.user!.id);
  return { preferences: prefs };
};

/**
 * One named action per appearance option.
 *
 * Per-field rather than one loosened schema (spec decision 7): each
 * schema is a `strictObject` with exactly one REQUIRED key, so a mistyped
 * field name is a 400 rather than a save that reports success and changes
 * nothing. An all-optional shared schema would be worse still — the
 * checkbox transform fires on an empty parse and writes `false` over the
 * user's reduce-motion setting.
 *
 * There is deliberately no `default` action: SvelteKit rejects one
 * coexisting with named actions, and the page gives each control its own
 * <form action="?/key"> so the no-JS path saves exactly the field the
 * button sits next to.
 */
function fieldAction(key: AppearanceKey) {
  return async ({ request, locals }: RequestEvent) => {
    // Form actions run BEFORE layout load functions, so the (app) group's
    // auth guard has not executed at this point. Without this an
    // anonymous POST reaches locals.user!.id and 500s.
    if (!locals.user) error(401, "Unauthorized");
    const userId = locals.user.id;

    const { allowed, retryAfterMs } = await checkRateLimit(
      `appearance:${userId}`,
      APPEARANCE_MAX,
      APPEARANCE_WINDOW_MS,
    );
    if (!allowed) {
      return fail(429, {
        key,
        saveError: `Too many changes. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`,
      });
    }

    const formData = Object.fromEntries(await request.formData());
    const parsed = appearanceFieldSchemas[key].safeParse(formData);
    if (!parsed.success) {
      return fail(400, { key, errors: parsed.error.flatten().fieldErrors });
    }

    await updatePreferences(userId, parsed.data);

    return { success: true, key };
  };
}

export const actions: Actions = Object.fromEntries(
  APPEARANCE_ACTION_KEYS.map((key) => [key, fieldAction(key)]),
) as Actions;
