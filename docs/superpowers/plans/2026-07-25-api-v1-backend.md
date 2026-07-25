# API v1 Backend (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a versioned `/api/v1` JSON surface to the existing SvelteKit app (bearer auth + native Sign in with Apple + TOTP step, delta-sync pull, an idempotent command endpoint that wraps existing domain functions, and a full-account JSON export) so the forthcoming native macOS client shares one account and one dataset with the web app.

**Architecture:** The server stays canonical. New endpoints under `src/routes/api/v1/` authenticate via an `Authorization: Bearer <lucia-session-id>` header (reusing `lucia.validateSession`), read data through delta-sync cursors, and apply writes by dispatching **idempotent commands** that call the _same_ domain functions the web form actions already use (`logDose`, `refillMedication`, `updateMedicationWithSchedules`, …). No business logic is reimplemented. Deletes are captured with a `sync_tombstones` table; bulk wipes bump a per-user `sync_epoch` that forces the client to full-resync.

**Tech Stack:** SvelteKit 2 endpoints, Drizzle ORM (Neon Postgres; `db` HTTP driver for autocommit, `dbTx` websocket pool for transactions), Lucia v3 sessions, arctic 3.7.0 (`Apple`), `jose` (Apple identity-token JWKS verification — new dep), Zod v4, Vitest with the codebase's db-mock pattern.

## Global Constraints

_Every task's requirements implicitly include this section._

- **Reuse, never reimplement.** Command handlers call existing exported domain functions verbatim. If a needed behavior isn't exposed, extend the domain module — do not inline SQL in a route.
- **Transactions:** use `dbTx.transaction(...)` for any multi-statement atomic unit; `db` for single autocommit queries. (`src/lib/server/db/index.ts`.)
- **IDs:** cuid2 `TEXT` everywhere (`import { createId } from "@paralleldrive/cuid2"`). Entity ids may be **client-generated** (the client sends cuid2 ids for new rows) so sync round-trips without an id-mapping layer.
- **Numeric-as-string:** `medications.dosageAmount`, `medications.scheduleIntervalHours`, `medicationSchedules.intervalHours` are **strings** in JS (Drizzle `numeric`). API responses pass them through as strings; the Swift client parses to `Decimal`/`Double`.
- **Auth:** the bearer token **is** a Lucia session id. Validate with `lucia.validateSession(id)`. No new session store.
- **Versioning:** the path is `/api/v1`. Never make a breaking change to an existing v1 response — additive only; a breaking change means `/api/v2`.
- **Coverage floors (CI fails if any drops):** statements 30, branches 25, functions 25.5, lines 30 (`vite.config.ts`). Every new module ships with unit tests.
- **House style:** `import { json, error } from "@sveltejs/kit"`; `if (!user) throw error(401)`; rate-limit → `{ error: "rate_limited", retryAfterSeconds }` + `Retry-After` header on 429; Zod `safeParse` → `throw error(400, ...)`.
- **Secrets:** new env vars (`APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`) are **optional**, gated at use-site like `getGoogle()` — not added to `env.ts`'s `required` tuple. The bearer/preauth HMAC key derives from the existing `ENCRYPTION_KEY`.

## File Structure

New/modified files (created in the tasks that follow):

- `src/lib/server/db/schema.ts` — **modify**: `updated_at` on `dose_logs`; new `syncTombstones`, `apiCommands` tables; `sync_epoch` on `users`.
- `drizzle/00XX_api_v1_sync.sql` — **generated** migration.
- `src/lib/server/doses.ts` — **modify**: `updateDose` bumps `updatedAt`; `deleteDose` writes a tombstone.
- `src/lib/server/api/auth.ts` — bearer resolver (`resolveApiUser`, `requireApiUser`).
- `src/lib/server/api/preauth.ts` — HMAC pre-auth token for the 2FA handshake.
- `src/lib/server/api/apple.ts` — Apple identity-token (JWKS) verifier.
- `src/lib/server/api/sync.ts` — delta-pull query assembly + serialization.
- `src/lib/server/api/commands.ts` — command registry + `dispatchCommand` + idempotency.
- `src/lib/server/api/export.ts` — full-account JSON assembly.
- `src/lib/server/api/serialize.ts` — shared row→JSON serializers (numeric coercion, date→ISO).
- `src/lib/utils/validation.ts` — **modify**: JSON-native command payload schemas.
- `src/routes/api/v1/auth/login/+server.ts`, `.../auth/2fa/+server.ts`, `.../auth/apple/+server.ts`
- `src/routes/api/v1/sync/+server.ts`
- `src/routes/api/v1/commands/+server.ts`
- `src/routes/api/v1/export/+server.ts`
- Tests under `tests/unit/api/` mirroring each module.

Deferred to a follow-on (NOT in this plan): the Sign in with Apple **web redirect** flow (`getApple()` + `/auth/callback/apple`) — only the native token endpoint is needed by the Mac app.

---

### Task 1: Sync schema — columns + tombstone + idempotency tables

**Files:**

- Modify: `src/lib/server/db/schema.ts`
- Modify: `tests/unit/schema.test.ts`
- Generate: `drizzle/00XX_api_v1_sync.sql` (via `npm run db:generate`)

**Interfaces:**

- Produces: `doseLogs.updatedAt` (timestamptz, not null, default now); tables `syncTombstones { id, userId, entityType, entityId, deletedAt }`, `apiCommands { userId, idempotencyKey, result(jsonb), createdAt, PK(userId, idempotencyKey) }`; `users.syncEpoch` (integer, not null, default 0).

- [ ] **Step 1: Add columns/tables to schema.ts**

In `src/lib/server/db/schema.ts`, add to the existing `doseLogs` table definition:

```ts
updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
```

Add to the `users` table:

```ts
syncEpoch: integer("sync_epoch").notNull().default(0),
```

Append two new tables (mirror the existing table style in the file):

```ts
export const syncTombstones = pgTable(
  "sync_tombstones",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(), // 'medication' | 'dose_log' | 'medication_schedule' | 'inventory_event'
    entityId: text("entity_id").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sync_tombstones_user_deleted_idx").on(t.userId, t.deletedAt)],
);

export const apiCommands = pgTable(
  "api_commands",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    result: jsonb("result").$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.idempotencyKey] })],
);
```

Ensure `integer`, `jsonb`, `primaryKey`, `index`, `createId` are imported at the top (most already are; add any missing).

Also add an index for the dose-log sync cursor to the `doseLogs` table's index list:

```ts
index("dose_logs_user_updated_idx").on(t.userId, t.updatedAt),
```

- [ ] **Step 2: Add schema assertions**

In `tests/unit/schema.test.ts`, add:

```ts
import { doseLogs, syncTombstones, apiCommands, users } from "../../src/lib/server/db/schema";

it("dose_logs has updatedAt for delta sync", () => {
  expect(doseLogs.updatedAt).toBeDefined();
});
it("users has syncEpoch", () => {
  expect(users.syncEpoch).toBeDefined();
});
it("sync tables exist", () => {
  expect(syncTombstones.entityType).toBeDefined();
  expect(apiCommands.idempotencyKey).toBeDefined();
});
```

- [ ] **Step 3: Run the schema tests**

Run: `npx vitest run tests/unit/schema.test.ts`
Expected: PASS.

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/00XX_api_v1_sync.sql` file plus a `drizzle/meta` snapshot. Open the SQL and confirm it (a) adds `updated_at` to `dose_logs` with `DEFAULT now()` and `NOT NULL`, (b) adds `sync_epoch` to `users`, (c) creates both tables, (d) creates the indexes.

- [ ] **Step 5: Backfill note in the migration**

Because `updated_at` is `NOT NULL DEFAULT now()`, existing `dose_logs` rows get `now()` on migration — acceptable (they become "recently changed" and sync once). If a truer backfill is wanted, append to the generated SQL:

```sql
UPDATE dose_logs SET updated_at = logged_at WHERE updated_at > logged_at;
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/db/schema.ts tests/unit/schema.test.ts drizzle/
git commit -m "feat(db): add sync columns, tombstone + idempotency tables for /api/v1"
```

---

### Task 2: Make dose mutations sync-aware

**Files:**

- Modify: `src/lib/server/doses.ts` (`updateDose` ~:208, `deleteDose` ~:155)
- Modify: `tests/unit/doses-inventory.test.ts`

**Interfaces:**

- Consumes: `syncTombstones` (Task 1).
- Produces: `updateDose` bumps `doseLogs.updatedAt`; `deleteDose` inserts a `sync_tombstones` row `{ entityType: "dose_log", entityId: doseId }` inside its existing transaction.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/doses-inventory.test.ts` (follow the file's existing db-mock harness — capture `inserts`/`updates`), add:

```ts
it("updateDose bumps updatedAt", async () => {
  // arrange an existing 'taken' dose, then:
  await updateDose("user1", "dose1", { quantity: 2 });
  const doseUpdate = updates.find((u) => u.table === "dose_logs");
  expect(doseUpdate?.values).toHaveProperty("updatedAt");
});

it("deleteDose writes a tombstone", async () => {
  await deleteDose("user1", "dose1");
  const tomb = inserts.find((i) => i.table === "sync_tombstones");
  expect(tomb?.values).toMatchObject({ entityType: "dose_log", entityId: "dose1" });
});
```

(If the existing harness doesn't track `updates`, extend its mock client's `update().set()` to push `{ table, values }` into an `updates` array, mirroring the `inserts` pattern.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/doses-inventory.test.ts`
Expected: FAIL (no `updatedAt` in the update; no tombstone insert).

- [ ] **Step 3: Implement**

In `updateDose`, add `updatedAt: new Date()` to the `.set({...})` object of the dose-row update.

In `deleteDose`, inside the existing `dbTx.transaction(async (tx) => {...})` block, after the delete + inventory restore, add:

```ts
await tx.insert(syncTombstones).values({
  id: createId(),
  userId,
  entityType: "dose_log",
  entityId: doseId,
});
```

Import `syncTombstones` from `./db/schema`. `syncTombstones.id` has **no** schema-level default (it follows the codebase convention where callers generate the cuid2 id), so you MUST pass `id: createId()` — import `createId` from `@paralleldrive/cuid2` (it is very likely already imported in `doses.ts`; check first).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/doses-inventory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/doses.ts tests/unit/doses-inventory.test.ts
git commit -m "feat(doses): bump updatedAt on edit, write tombstone on delete"
```

---

### Task 3: Bearer-auth resolver

**Files:**

- Create: `src/lib/server/api/auth.ts`
- Test: `tests/unit/api/auth.test.ts`

**Interfaces:**

- Consumes: `lucia.validateSession` (`src/lib/server/auth/lucia.ts`).
- Produces:
  - `resolveApiUser(request: Request): Promise<{ user: SessionUser; sessionId: string } | null>`
  - `requireApiUser(request: Request): Promise<{ user: SessionUser; sessionId: string }>` (throws `error(401)` when null).

- [ ] **Step 1: Write the failing test**

`tests/unit/api/auth.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

const validateSession = vi.fn();
vi.mock("$lib/server/auth/lucia", () => ({ lucia: { validateSession } }));

const { resolveApiUser } = await import("../../../src/lib/server/api/auth");

const reqWith = (auth?: string) =>
  new Request("http://x/api/v1/sync", { headers: auth ? { authorization: auth } : {} });

describe("resolveApiUser", () => {
  it("returns null with no header", async () => {
    expect(await resolveApiUser(reqWith())).toBeNull();
  });
  it("returns null for a non-bearer scheme", async () => {
    expect(await resolveApiUser(reqWith("Basic abc"))).toBeNull();
  });
  it("returns null when lucia rejects", async () => {
    validateSession.mockResolvedValueOnce({ session: null, user: null });
    expect(await resolveApiUser(reqWith("Bearer bad"))).toBeNull();
  });
  it("returns user + sessionId on success", async () => {
    validateSession.mockResolvedValueOnce({
      session: { id: "s1" },
      user: { id: "u1", email: "a@b.c" },
    });
    const r = await resolveApiUser(reqWith("Bearer s1"));
    expect(r).toEqual({ user: { id: "u1", email: "a@b.c" }, sessionId: "s1" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/api/auth.test.ts`
Expected: FAIL ("Cannot find module .../api/auth").

- [ ] **Step 3: Implement**

`src/lib/server/api/auth.ts`:

```ts
import { error } from "@sveltejs/kit";
import { lucia } from "$lib/server/auth/lucia";
import type { SessionUser } from "$lib/types";

export async function resolveApiUser(
  request: Request,
): Promise<{ user: SessionUser; sessionId: string } | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const sessionId = header.slice("Bearer ".length).trim();
  if (!sessionId) return null;
  const { session, user } = await lucia.validateSession(sessionId);
  if (!session || !user) return null;
  return { user, sessionId };
}

export async function requireApiUser(request: Request) {
  const resolved = await resolveApiUser(request);
  if (!resolved) throw error(401, "Unauthorized");
  return resolved;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/api/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/api/auth.ts tests/unit/api/auth.test.ts
git commit -m "feat(api): bearer-token auth resolver reusing Lucia sessions"
```

---

### Task 4: Pre-auth token (2FA handshake)

**Files:**

- Create: `src/lib/server/api/preauth.ts`
- Test: `tests/unit/api/preauth.test.ts`

**Interfaces:**

- Produces:
  - `signPreAuthToken(userId: string, ttlMs?: number): string` — format `base64url(payload).base64url(hmac)` where payload is `{ userId, exp }`.
  - `verifyPreAuthToken(token: string): string | null` — returns `userId` if valid + unexpired, else `null`.
- Key derives from `ENCRYPTION_KEY` (already required for TOTP).

- [ ] **Step 1: Write the failing test**

`tests/unit/api/preauth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("$env/dynamic/private", () => ({ env: { ENCRYPTION_KEY: "test-encryption-key-123" } }));
const { signPreAuthToken, verifyPreAuthToken } =
  await import("../../../src/lib/server/api/preauth");

describe("preauth token", () => {
  it("round-trips a userId", () => {
    const t = signPreAuthToken("user-42");
    expect(verifyPreAuthToken(t)).toBe("user-42");
  });
  it("rejects a tampered token", () => {
    const t = signPreAuthToken("user-42");
    expect(verifyPreAuthToken(t.slice(0, -2) + "xy")).toBeNull();
  });
  it("rejects an expired token", () => {
    const t = signPreAuthToken("user-42", -1000); // already expired
    expect(verifyPreAuthToken(t)).toBeNull();
  });
  it("rejects garbage", () => {
    expect(verifyPreAuthToken("not-a-token")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/api/preauth.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`src/lib/server/api/preauth.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "$env/dynamic/private";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function key(): string {
  if (!env.ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is not set");
  return env.ENCRYPTION_KEY;
}
const b64u = (b: Buffer) => b.toString("base64url");

function sign(payloadB64: string): string {
  return createHmac("sha256", key()).update(payloadB64).digest("base64url");
}

export function signPreAuthToken(userId: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const payload = b64u(Buffer.from(JSON.stringify({ userId, exp: Date.now() + ttlMs })));
  return `${payload}.${sign(payload)}`;
}

export function verifyPreAuthToken(token: string): string | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { userId, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof userId !== "string" || typeof exp !== "number" || Date.now() > exp) return null;
    return userId;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/api/preauth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/api/preauth.ts tests/unit/api/preauth.test.ts
git commit -m "feat(api): HMAC pre-auth token for the 2FA handshake"
```

---

### Task 5: `POST /api/v1/auth/login`

**Files:**

- Create: `src/routes/api/v1/auth/login/+server.ts`
- Test: `tests/unit/api/login.test.ts`

**Interfaces:**

- Consumes: `loginSchema` (validation.ts), `checkRateLimit`, `verifyPassword` + `needsRehash` (`src/lib/server/auth/password.ts`), `lucia.createSession`, `signPreAuthToken` (Task 4).
- Produces (JSON): on success `{ token: string, user: SessionUser }`; when 2FA required `{ challenge: "totp", preAuthToken: string }`; on bad creds `401`.

- [ ] **Step 1: Write the failing test**

`tests/unit/api/login.test.ts` — mock `$lib/server/db`, `password`, `lucia`, `rate-limit`. Follow the db-mock pattern from `tests/unit/inventory-events.test.ts`. Assert: unknown email → 401; wrong password → 401; correct password, no 2FA → `{ token, user }`; correct password + `twoFactorEnabled` → `{ challenge: "totp", preAuthToken }`; rate-limited → 429. Build the `Request` with a JSON body and call the exported `POST` handler with a hand-made `RequestEvent`-shaped object `{ request }`.

```ts
// sketch — expand each case:
const { POST } = await import("../../../src/routes/api/v1/auth/login/+server");
const call = (body: object) =>
  POST({ request: new Request("http://x", { method: "POST", body: JSON.stringify(body) }) } as any);
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/api/login.test.ts`
Expected: FAIL (route missing).

- [ ] **Step 3: Implement**

`src/routes/api/v1/auth/login/+server.ts`:

```ts
import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { loginSchema } from "$lib/utils/validation";
import { verifyPassword } from "$lib/server/auth/password";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { lucia } from "$lib/server/auth/lucia";
import { signPreAuthToken } from "$lib/server/api/preauth";
import { toSessionUser } from "$lib/server/api/serialize"; // Task 12 defines this; inline if not yet present

export const POST: RequestHandler = async ({ request }) => {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) throw error(400, "Invalid credentials payload");
  const email = parsed.data.email.toLowerCase().trim();

  const { allowed, retryAfterMs } = await checkRateLimit(`api-login:${email}`, 5, 15 * 60 * 1000);
  if (!allowed) {
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    return json(
      { error: "rate_limited", retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const ok = user?.passwordHash
    ? await verifyPassword(user.passwordHash, parsed.data.password)
    : false;
  if (!user || !ok) throw error(401, "Invalid email or password");

  if (user.twoFactorEnabled) {
    return json({ challenge: "totp", preAuthToken: signPreAuthToken(user.id) });
  }

  const session = await lucia.createSession(user.id, {});
  return json({ token: session.id, user: toSessionUser(user) });
};
```

If Task 12's `toSessionUser` isn't implemented yet, inline the projection here and refactor later:

```ts
const toSessionUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  avatarUrl: u.avatarUrl,
  timezone: u.timezone,
  twoFactorEnabled: u.twoFactorEnabled,
  emailVerified: u.emailVerified,
});
```

(Confirm `verifyPassword`'s exact name/signature in `src/lib/server/auth/password.ts`; adjust the import if it differs, e.g. `verify`.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/api/login.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/v1/auth/login tests/unit/api/login.test.ts
git commit -m "feat(api): POST /api/v1/auth/login with 2FA challenge"
```

---

### Task 6: `POST /api/v1/auth/2fa`

**Files:**

- Create: `src/routes/api/v1/auth/2fa/+server.ts`
- Test: `tests/unit/api/2fa.test.ts`

**Interfaces:**

- Consumes: `verifyPreAuthToken` (Task 4), `verifyAndConsumeTOTPCode` (`totp.ts`), `lucia.createSession`, `db` (to load the user for the response).
- Produces (JSON): `{ token, user }` on success; `401` on invalid pre-auth token or code.

- [ ] **Step 1: Write the failing test**

`tests/unit/api/2fa.test.ts` — mock `preauth`, `totp`, `lucia`, `db`. Cases: bad preAuthToken → 401; valid token + wrong code (`verifyAndConsumeTOTPCode` → false) → 401; valid token + valid code → `{ token, user }`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/api/2fa.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/routes/api/v1/auth/2fa/+server.ts`:

```ts
import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { verifyPreAuthToken } from "$lib/server/api/preauth";
import { verifyAndConsumeTOTPCode } from "$lib/server/auth/totp";
import { lucia } from "$lib/server/auth/lucia";

const body = z.object({ preAuthToken: z.string(), code: z.string().regex(/^\d{6}$/) });

export const POST: RequestHandler = async ({ request }) => {
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) throw error(400, "Invalid payload");

  const userId = verifyPreAuthToken(parsed.data.preAuthToken);
  if (!userId) throw error(401, "Challenge expired — sign in again");

  const ok = await verifyAndConsumeTOTPCode(userId, parsed.data.code);
  if (!ok) throw error(401, "Invalid code");

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw error(401, "Unknown user");

  const session = await lucia.createSession(user.id, {});
  return json({
    token: session.id,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      timezone: user.timezone,
      twoFactorEnabled: user.twoFactorEnabled,
      emailVerified: user.emailVerified,
    },
  });
};
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/api/2fa.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/v1/auth/2fa tests/unit/api/2fa.test.ts
git commit -m "feat(api): POST /api/v1/auth/2fa completes the TOTP challenge"
```

---

### Task 7: Apple identity-token verifier

**Files:**

- Create: `src/lib/server/api/apple.ts`
- Test: `tests/unit/api/apple.test.ts`
- Modify: `package.json` (add `jose`), `.env.example`

**Interfaces:**

- Produces: `verifyAppleIdentityToken(idToken: string): Promise<{ appleUserId: string; email: string | null; emailVerified: boolean }>` — throws on invalid signature/claims.
- Uses `jose` `createRemoteJWKSet("https://appleid.apple.com/auth/keys")` + `jwtVerify` with `issuer: "https://appleid.apple.com"`, `audience: APPLE_CLIENT_ID`.

- [ ] **Step 1: Install jose**

Run: `npm install jose`
Expected: `jose` added to `dependencies`.

- [ ] **Step 2: Write the failing test**

`tests/unit/api/apple.test.ts` — mock `jose` so we test claim mapping without real Apple keys:

```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("$env/dynamic/private", () => ({ env: { APPLE_CLIENT_ID: "com.jamiewhite.medtracker" } }));
const jwtVerify = vi.fn();
vi.mock("jose", () => ({ createRemoteJWKSet: () => ({}), jwtVerify }));
const { verifyAppleIdentityToken } = await import("../../../src/lib/server/api/apple");

describe("verifyAppleIdentityToken", () => {
  it("maps sub/email/email_verified", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: { sub: "000123.abc", email: "a@b.c", email_verified: "true" },
    });
    expect(await verifyAppleIdentityToken("tok")).toEqual({
      appleUserId: "000123.abc",
      email: "a@b.c",
      emailVerified: true,
    });
  });
  it("handles boolean email_verified and missing email", async () => {
    jwtVerify.mockResolvedValueOnce({ payload: { sub: "000123.abc", email_verified: true } });
    expect(await verifyAppleIdentityToken("tok")).toEqual({
      appleUserId: "000123.abc",
      email: null,
      emailVerified: true,
    });
  });
  it("throws when jose rejects", async () => {
    jwtVerify.mockRejectedValueOnce(new Error("bad signature"));
    await expect(verifyAppleIdentityToken("tok")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/unit/api/apple.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement**

`src/lib/server/api/apple.ts`:

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "$env/dynamic/private";

const JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export async function verifyAppleIdentityToken(idToken: string): Promise<{
  appleUserId: string;
  email: string | null;
  emailVerified: boolean;
}> {
  if (!env.APPLE_CLIENT_ID) throw new Error("APPLE_CLIENT_ID is not set");
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: "https://appleid.apple.com",
    audience: env.APPLE_CLIENT_ID,
  });
  const ev = payload.email_verified;
  return {
    appleUserId: String(payload.sub),
    email: typeof payload.email === "string" ? payload.email : null,
    emailVerified: ev === true || ev === "true",
  };
}
```

- [ ] **Step 5: Document env**

Add to `.env.example`:

```
# === Sign in with Apple (optional; required for the macOS app's SIWA) ===
APPLE_CLIENT_ID=          # the app's Services ID / bundle id used as the token audience
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=        # PKCS8 .p8 contents (only needed for the web redirect flow)
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/unit/api/apple.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/api/apple.ts tests/unit/api/apple.test.ts package.json package-lock.json .env.example
git commit -m "feat(api): Apple identity-token (JWKS) verifier for native Sign in with Apple"
```

---

### Task 8: `POST /api/v1/auth/apple`

**Files:**

- Create: `src/routes/api/v1/auth/apple/+server.ts`
- Test: `tests/unit/api/apple-route.test.ts`

**Interfaces:**

- Consumes: `verifyAppleIdentityToken` (Task 7), `db`, `oauthAccounts`/`users` schema, `lucia.createSession`, `createId`.
- Produces (JSON): `{ token, user }` on link/create; `409 { error: "email_conflict" }` when the email already belongs to a non-Apple account (mirrors the web anti-auto-link guard).
- Request body: `{ identityToken: string, fullName?: string }`.

- [ ] **Step 1: Write the failing test**

`tests/unit/api/apple-route.test.ts` — mock `apple`, `db`, `lucia`. Cases:

- existing `oauthAccounts (apple, sub)` → `createSession(existing.userId)` → `{ token, user }`.
- no oauth link, email matches an existing user → `409` `email_conflict` (no session created).
- no oauth link, no user → insert user + oauthAccounts, `createSession` → `{ token, user }`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/api/apple-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/routes/api/v1/auth/apple/+server.ts`:

```ts
import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { db } from "$lib/server/db";
import { users, oauthAccounts } from "$lib/server/db/schema";
import { and, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { lucia } from "$lib/server/auth/lucia";
import { verifyAppleIdentityToken } from "$lib/server/api/apple";

const PROVIDER = "apple";
const body = z.object({
  identityToken: z.string().min(1),
  fullName: z.string().max(200).optional(),
});

const projectUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  avatarUrl: u.avatarUrl,
  timezone: u.timezone,
  twoFactorEnabled: u.twoFactorEnabled,
  emailVerified: u.emailVerified,
});

export const POST: RequestHandler = async ({ request }) => {
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) throw error(400, "Invalid payload");

  const identity = await verifyAppleIdentityToken(parsed.data.identityToken).catch(() => null);
  if (!identity) throw error(401, "Invalid Apple token");

  // 1. existing link → sign in
  const [link] = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, PROVIDER),
        eq(oauthAccounts.providerUserId, identity.appleUserId),
      ),
    )
    .limit(1);
  if (link) {
    const [u] = await db.select().from(users).where(eq(users.id, link.userId)).limit(1);
    const session = await lucia.createSession(u.id, {});
    return json({ token: session.id, user: projectUser(u) });
  }

  // 2. email collision with a non-Apple account → refuse to auto-link
  if (identity.email) {
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, identity.email.toLowerCase()))
      .limit(1);
    if (existing) throw error(409, "email_conflict");
  }

  // 3. create fresh account + link
  const userId = createId();
  const email = identity.email?.toLowerCase() ?? `${identity.appleUserId}@privaterelay.appleid.com`;
  await db.insert(users).values({
    id: userId,
    email,
    name: parsed.data.fullName ?? "Apple User",
    passwordHash: null,
    emailVerified: identity.emailVerified,
    avatarUrl: null,
  });
  await db
    .insert(oauthAccounts)
    .values({ provider: PROVIDER, providerUserId: identity.appleUserId, userId });
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const session = await lucia.createSession(userId, {});
  return json({ token: session.id, user: projectUser(u) });
};
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/api/apple-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/v1/auth/apple tests/unit/api/apple-route.test.ts
git commit -m "feat(api): POST /api/v1/auth/apple native Sign in with Apple"
```

---

### Task 9: Shared serializers

**Files:**

- Create: `src/lib/server/api/serialize.ts`
- Test: `tests/unit/api/serialize.test.ts`

**Interfaces:**

- Produces: `toSessionUser(row)`, `serializeMedication(row)`, `serializeSchedule(row)`, `serializeDoseLog(row)`, `serializeInventoryEvent(row)`, `serializeAuditLog(row)`, `serializePreferences(row)`, `serializeTombstone(row)`. Each returns a plain JSON object with `Date → ISO string` and numeric-as-string fields passed through unchanged.

- [ ] **Step 1: Write the failing test**

`tests/unit/api/serialize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { serializeDoseLog, serializeMedication } from "../../../src/lib/server/api/serialize";

describe("serializers", () => {
  it("converts dates to ISO and keeps numeric strings", () => {
    const d = serializeMedication({
      id: "m1",
      dosageAmount: "500",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      colourSecondary: null,
    } as any);
    expect(d.dosageAmount).toBe("500");
    expect(d.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(d.colourSecondary).toBeNull();
  });
  it("serializes dose log dates", () => {
    const d = serializeDoseLog({
      id: "d1",
      takenAt: new Date("2026-01-02T08:00:00Z"),
      updatedAt: new Date("2026-01-02T08:00:00Z"),
      sideEffects: null,
    } as any);
    expect(d.takenAt).toBe("2026-01-02T08:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/api/serialize.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/lib/server/api/serialize.ts` — write explicit field-by-field mappers (do NOT `JSON.stringify` blindly; be deliberate about which columns cross the wire). Example for two; follow the same shape for the rest, reading the exact columns from `schema.ts`:

```ts
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function serializeMedication(m: {
  id: string;
  userId: string;
  name: string;
  dosageAmount: string;
  dosageUnit: string;
  form: string;
  category: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  notes: string | null;
  scheduleType: string;
  scheduleIntervalHours: string | null;
  inventoryCount: number | null;
  inventoryAlertThreshold: number | null;
  sortOrder: number;
  isArchived: boolean;
  archivedAt: Date | null;
  startedAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...m,
    archivedAt: iso(m.archivedAt),
    startedAt: iso(m.startedAt),
    endedAt: iso(m.endedAt),
    createdAt: iso(m.createdAt),
    updatedAt: iso(m.updatedAt),
  };
}

export function serializeDoseLog(d: {
  id: string;
  userId: string;
  medicationId: string;
  quantity: number;
  takenAt: Date;
  loggedAt: Date;
  updatedAt: Date;
  notes: string | null;
  sideEffects: unknown;
  status: string;
}) {
  return { ...d, takenAt: iso(d.takenAt), loggedAt: iso(d.loggedAt), updatedAt: iso(d.updatedAt) };
}

export function toSessionUser(u: {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  timezone: string;
  twoFactorEnabled: boolean;
  emailVerified: boolean;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    timezone: u.timezone,
    twoFactorEnabled: u.twoFactorEnabled,
    emailVerified: u.emailVerified,
  };
}
```

Add `serializeSchedule`, `serializeInventoryEvent`, `serializeAuditLog`, `serializePreferences`, `serializeTombstone` following the same pattern (dates→ISO; `daysOfWeek`/`sideEffects`/`changes` JSON pass through). Then refactor Task 5/6/8's inline `projectUser` to import `toSessionUser`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/api/serialize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/api/serialize.ts tests/unit/api/serialize.test.ts src/routes/api/v1/auth
git commit -m "feat(api): shared row serializers; use toSessionUser in auth routes"
```

---

### Task 10: `GET /api/v1/sync` — delta pull

**Files:**

- Create: `src/lib/server/api/sync.ts`, `src/routes/api/v1/sync/+server.ts`
- Test: `tests/unit/api/sync.test.ts`

**Interfaces:**

- Consumes: `db`, schema tables, serializers (Task 9), `requireApiUser` (Task 3), `getSchedulesForUser` (`schedules.ts`).
- Produces:
  - `buildSyncResponse(userId: string, sinceIso: string | null, clientEpoch: number): Promise<SyncResponse>` where
    `SyncResponse = { epoch: number; fullResync: boolean; serverTime: string; cursor: string; medications: any[]; doseLogs: any[]; inventoryEvents: any[]; auditLogs: any[]; tombstones: any[]; preferences: any; profile: any }`.
  - Route `GET /api/v1/sync?since=<ISO>&epoch=<int>` returns it.
- Cursor rule: `since` filters `updatedAt > since` for medications, dose_logs, preferences, users; `createdAt > since` for append-only inventory_events, audit_logs; `deletedAt > since` for tombstones. `medications` carry their **full current schedule set** (schedules synced as children — avoids needing `updated_at` on `medication_schedules`). `cursor` in the response = `serverTime` (client passes it back as `since` next time). If `clientEpoch < users.syncEpoch` → `fullResync: true` and `since` is ignored (return everything).

- [ ] **Step 1: Write the failing test**

`tests/unit/api/sync.test.ts` — mock `db` + `getSchedulesForUser`. Cases:

- `since=null` returns all rows; `medications[i].schedules` is populated from `getSchedulesForUser`.
- `since=<t>` filters by `updatedAt`/`createdAt`/`deletedAt > t` (assert the WHERE captured by the mock, or assert only newer rows returned by seeding the mock to filter).
- `clientEpoch < serverEpoch` → `fullResync: true`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/api/sync.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `buildSyncResponse`**

`src/lib/server/api/sync.ts`:

```ts
import { db } from "$lib/server/db";
import {
  medications,
  doseLogs,
  inventoryEvents,
  auditLogs,
  userPreferences,
  users,
  syncTombstones,
} from "$lib/server/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { getSchedulesForUser } from "$lib/server/schedules";
import * as s from "$lib/server/api/serialize";

export async function buildSyncResponse(
  userId: string,
  sinceIso: string | null,
  clientEpoch: number,
) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const fullResync = !sinceIso || clientEpoch < (user?.syncEpoch ?? 0);
  const since = fullResync ? null : new Date(sinceIso!);
  const serverTime = new Date().toISOString();

  const changedSince = (col: any) =>
    since ? and(eq((col as any).table.userId, userId), gt(col, since)) : undefined;
  // NOTE: assemble each query explicitly rather than via the helper if Drizzle typing fights you.

  const medRows = await db
    .select()
    .from(medications)
    .where(
      since
        ? and(eq(medications.userId, userId), gt(medications.updatedAt, since))
        : eq(medications.userId, userId),
    );
  const schedulesByMed = await getSchedulesForUser(userId);
  const meds = medRows.map((m) => ({
    ...s.serializeMedication(m),
    schedules: (schedulesByMed.get(m.id) ?? []).map(s.serializeSchedule),
  }));

  const doses = await db
    .select()
    .from(doseLogs)
    .where(
      since
        ? and(eq(doseLogs.userId, userId), gt(doseLogs.updatedAt, since))
        : eq(doseLogs.userId, userId),
    );
  const invEvents = await db
    .select()
    .from(inventoryEvents)
    .where(
      since
        ? and(eq(inventoryEvents.userId, userId), gt(inventoryEvents.createdAt, since))
        : eq(inventoryEvents.userId, userId),
    );
  const audits = await db
    .select()
    .from(auditLogs)
    .where(
      since
        ? and(eq(auditLogs.userId, userId), gt(auditLogs.createdAt, since))
        : eq(auditLogs.userId, userId),
    );
  const tombstones = since
    ? await db
        .select()
        .from(syncTombstones)
        .where(and(eq(syncTombstones.userId, userId), gt(syncTombstones.deletedAt, since)))
    : [];
  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  return {
    epoch: user?.syncEpoch ?? 0,
    fullResync,
    serverTime,
    cursor: serverTime,
    medications: meds,
    doseLogs: doses.map(s.serializeDoseLog),
    inventoryEvents: invEvents.map(s.serializeInventoryEvent),
    auditLogs: audits.map(s.serializeAuditLog),
    tombstones: tombstones.map(s.serializeTombstone),
    preferences: prefs ? s.serializePreferences(prefs) : null,
    profile: user ? s.toSessionUser(user) : null,
  };
}
```

(Delete the `changedSince` helper sketch — the explicit per-table `where` blocks above are the implementation. Keep them explicit.)

- [ ] **Step 4: Implement the route**

`src/routes/api/v1/sync/+server.ts`:

```ts
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { requireApiUser } from "$lib/server/api/auth";
import { buildSyncResponse } from "$lib/server/api/sync";

export const GET: RequestHandler = async ({ request, url }) => {
  const { user } = await requireApiUser(request);
  const since = url.searchParams.get("since");
  const epoch = Number(url.searchParams.get("epoch") ?? "0") || 0;
  return json(await buildSyncResponse(user.id, since, epoch));
};
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/unit/api/sync.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/api/sync.ts src/routes/api/v1/sync tests/unit/api/sync.test.ts
git commit -m "feat(api): GET /api/v1/sync delta pull with tombstones + epoch full-resync"
```

---

### Task 11: Command dispatcher + idempotency (scaffold + `log_dose`)

**Files:**

- Create: `src/lib/server/api/commands.ts`, `src/routes/api/v1/commands/+server.ts`
- Modify: `src/lib/utils/validation.ts` (JSON-native command payloads)
- Test: `tests/unit/api/commands.test.ts`

**Interfaces:**

- Produces:
  - `type Command = { id: string; type: string; payload: unknown }`
  - `dispatchCommand(userId: string, type: string, payload: unknown): Promise<unknown>` — throws `UnknownCommandError` for unregistered types.
  - `runCommands(userId: string, commands: Command[]): Promise<Array<{ id: string; ok: boolean; result?: unknown; error?: string }>>` — idempotent per `(userId, id)` via `apiCommands`.
  - Route `POST /api/v1/commands` body `{ commands: Command[] }` → `{ results: [...] }`.
  - `commandPayloadSchemas` registry in validation.ts (JSON-native).

- [ ] **Step 1: Write the failing test**

`tests/unit/api/commands.test.ts` — mock `db` (incl. `apiCommands` select/insert), `doses`. Cases:

- `runCommands` with a fresh `log_dose` → calls `logDose`, stores result in `apiCommands`.
- replaying the same command id → returns the **cached** result, does NOT call `logDose` again.
- unknown type → `{ ok: false, error }`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/api/commands.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add JSON-native payload schemas**

In `src/lib/utils/validation.ts`, add (JSON-native — no `checkboxField`/`sideEffectsField` string transforms):

```ts
export const sideEffectJson = z.object({
  name: z.string().min(1).max(100),
  severity: z.enum(["mild", "moderate", "severe"]),
});
export const logDosePayload = z.object({
  medicationId: z.string(),
  quantity: z.number().int().min(1).max(10).default(1),
  takenAt: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
  sideEffects: z.array(sideEffectJson).max(20).optional(),
});
```

- [ ] **Step 4: Implement the dispatcher**

`src/lib/server/api/commands.ts`:

```ts
import { db } from "$lib/server/db";
import { apiCommands } from "$lib/server/db/schema";
import { and, eq } from "drizzle-orm";
import { logDose } from "$lib/server/doses";
import { logDosePayload } from "$lib/utils/validation";

export class UnknownCommandError extends Error {
  constructor(type: string) {
    super(`Unknown command: ${type}`);
    this.name = "UnknownCommandError";
  }
}

type Handler = (userId: string, payload: unknown) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  log_dose: async (userId, payload) => {
    const p = logDosePayload.parse(payload);
    const row = await logDose(
      userId,
      p.medicationId,
      p.quantity,
      p.takenAt ? new Date(p.takenAt) : undefined,
      p.notes,
      p.sideEffects,
    );
    return { id: (row as { id: string }).id };
  },
};

export async function dispatchCommand(
  userId: string,
  type: string,
  payload: unknown,
): Promise<unknown> {
  const handler = handlers[type];
  if (!handler) throw new UnknownCommandError(type);
  return handler(userId, payload);
}

export type Command = { id: string; type: string; payload: unknown };

export async function runCommands(userId: string, commands: Command[]) {
  const results: Array<{ id: string; ok: boolean; result?: unknown; error?: string }> = [];
  for (const cmd of commands) {
    const [cached] = await db
      .select()
      .from(apiCommands)
      .where(and(eq(apiCommands.userId, userId), eq(apiCommands.idempotencyKey, cmd.id)))
      .limit(1);
    if (cached) {
      results.push({ id: cmd.id, ok: true, result: cached.result });
      continue;
    }
    try {
      const result = await dispatchCommand(userId, cmd.type, cmd.payload);
      await db.insert(apiCommands).values({ userId, idempotencyKey: cmd.id, result });
      results.push({ id: cmd.id, ok: true, result });
    } catch (e) {
      results.push({
        id: cmd.id,
        ok: false,
        error: e instanceof Error ? e.message : "command failed",
      });
    }
  }
  return results;
}
```

`export { handlers };` at the bottom so later tasks register more.

- [ ] **Step 5: Implement the route**

`src/routes/api/v1/commands/+server.ts`:

```ts
import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { requireApiUser } from "$lib/server/api/auth";
import { runCommands } from "$lib/server/api/commands";

const body = z.object({
  commands: z
    .array(z.object({ id: z.string().min(1), type: z.string().min(1), payload: z.unknown() }))
    .max(200),
});

export const POST: RequestHandler = async ({ request }) => {
  const { user } = await requireApiUser(request);
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) throw error(400, "Invalid commands payload");
  return json({ results: await runCommands(user.id, parsed.data.commands) });
};
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/unit/api/commands.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/api/commands.ts src/routes/api/v1/commands src/lib/utils/validation.ts tests/unit/api/commands.test.ts
git commit -m "feat(api): idempotent command dispatcher + POST /api/v1/commands (log_dose)"
```

---

### Task 12: Dose + inventory commands

**Files:**

- Modify: `src/lib/server/api/commands.ts`, `src/lib/utils/validation.ts`
- Test: `tests/unit/api/commands.test.ts`

**Interfaces:**

- Produces handlers: `skip_dose`, `edit_dose`, `delete_dose`, `refill`, `adjust_inventory`. Consumes `logSkippedDose`, `updateDose`, `deleteDose` (doses.ts), `refillMedication`, `adjustInventory` (inventory-events.ts).

- [ ] **Step 1: Write the failing tests**

Add cases to `tests/unit/api/commands.test.ts`: each command type calls the right domain fn with the mapped args (assert the mock domain fn received the expected arguments), and its result shape is stored.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/api/commands.test.ts`
Expected: FAIL (handlers unregistered).

- [ ] **Step 3: Add payload schemas**

In `validation.ts`:

```ts
export const skipDosePayload = z.object({ medicationId: z.string() });
export const editDosePayload = z.object({
  doseId: z.string(),
  takenAt: z.string().datetime().optional(),
  quantity: z.number().int().min(1).max(10).optional(),
  notes: z.string().max(500).optional(),
  sideEffects: z.array(sideEffectJson).max(20).nullable().optional(),
});
export const deleteDosePayload = z.object({ doseId: z.string() });
export const refillPayload = z.object({
  medicationId: z.string(),
  quantity: z.number().int().positive(),
  note: z.string().max(200).nullable().optional(),
});
export const adjustInventoryPayload = z.object({
  medicationId: z.string(),
  newCount: z.number().int().min(0),
  note: z.string().max(200).nullable().optional(),
});
```

- [ ] **Step 4: Register handlers**

Add to the `handlers` map in `commands.ts` (import the domain fns + schemas):

```ts
skip_dose: async (userId, payload) => {
  const p = skipDosePayload.parse(payload);
  return { id: await logSkippedDose(userId, p.medicationId) };
},
edit_dose: async (userId, payload) => {
  const p = editDosePayload.parse(payload);
  const row = await updateDose(userId, p.doseId, {
    takenAt: p.takenAt ? new Date(p.takenAt) : undefined,
    quantity: p.quantity, notes: p.notes, sideEffects: p.sideEffects ?? undefined,
  });
  return { updated: row !== null };
},
delete_dose: async (userId, payload) => {
  const p = deleteDosePayload.parse(payload);
  return { deleted: await deleteDose(userId, p.doseId) };
},
refill: async (userId, payload) => {
  const p = refillPayload.parse(payload);
  return refillMedication(userId, p.medicationId, p.quantity, p.note ?? null);
},
adjust_inventory: async (userId, payload) => {
  const p = adjustInventoryPayload.parse(payload);
  return adjustInventory(userId, p.medicationId, p.newCount, p.note ?? null);
},
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/unit/api/commands.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/api/commands.ts src/lib/utils/validation.ts tests/unit/api/commands.test.ts
git commit -m "feat(api): dose + inventory commands (skip/edit/delete/refill/adjust)"
```

---

### Task 13: Medication + schedule + preference + wipe commands

**Files:**

- Modify: `src/lib/server/api/commands.ts`, `src/lib/utils/validation.ts`
- Modify: `src/lib/server/api/wipe.ts` (new) for bulk wipes that bump `sync_epoch`
- Test: `tests/unit/api/commands.test.ts`

**Interfaces:**

- Produces handlers: `upsert_medication_with_schedules` (create when no id, else update), `archive`, `unarchive`, `reorder`, `update_preferences`, `wipe_dose_history`, `wipe_archived_medications`. Consumes `createMedicationWithSchedules`/`updateMedicationWithSchedules`/`archiveMedication`/`unarchiveMedication`/`swapSortOrder` (medications.ts), `updatePreferences` (preferences.ts). Bulk wipes bump `users.syncEpoch`.

- [ ] **Step 1: Write the failing tests**

Add cases: upsert with no `id` → `createMedicationWithSchedules`; with `id` → `updateMedicationWithSchedules`; `archive`/`unarchive`/`reorder` call the right fns; `update_preferences` calls `updatePreferences`; `wipe_dose_history` bumps `syncEpoch` (assert an update to `users.syncEpoch`).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/api/commands.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add payload schemas**

In `validation.ts`, reuse `medicationSchema`'s field types but JSON-native. Since `medicationSchema` already validates the core fields (with numeric-as-string), define:

```ts
export const upsertMedicationPayload = z.object({
  id: z.string().optional(),
  medication: medicationSchema, // reuse existing MedicationInput shape
  schedules: schedulesSchema, // reuse existing 1..20 discriminated union
});
export const archivePayload = z.object({ medicationId: z.string() });
export const reorderPayload = z.object({ medId1: z.string(), medId2: z.string() });
export const updatePreferencesPayload = z.object({
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).optional(),
  timeFormat: z.enum(["12h", "24h"]).optional(),
  uiDensity: z.enum(["comfortable", "compact"]).optional(),
  reducedMotion: z.boolean().optional(),
  overdueEmailReminders: z.boolean().optional(),
  overduePushReminders: z.boolean().optional(),
  lowInventoryEmailAlerts: z.boolean().optional(),
  lowInventoryPushAlerts: z.boolean().optional(),
  doseLogPageSize: z.number().int().min(5).max(100).optional(),
  heatmapPeriod: z.number().int().optional(),
  exportFormat: z.enum(["pdf", "csv"]).optional(),
});
```

- [ ] **Step 4: Implement the wipe helper**

`src/lib/server/api/wipe.ts`:

```ts
import { dbTx } from "$lib/server/db";
import { doseLogs, medications, users } from "$lib/server/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { logAudit } from "$lib/server/audit";

export async function wipeDoseHistory(userId: string): Promise<{ deleted: number }> {
  const deleted = await dbTx.transaction(async (tx) => {
    const rows = await tx
      .delete(doseLogs)
      .where(eq(doseLogs.userId, userId))
      .returning({ id: doseLogs.id });
    await tx
      .update(users)
      .set({ syncEpoch: sql`${users.syncEpoch} + 1` })
      .where(eq(users.id, userId));
    return rows.length;
  });
  await logAudit(userId, "dose_log", "*", "delete", { deleted: { from: deleted, to: 0 } });
  return { deleted };
}

export async function wipeArchivedMedications(userId: string): Promise<{ deleted: number }> {
  const deleted = await dbTx.transaction(async (tx) => {
    const rows = await tx
      .delete(medications)
      .where(and(eq(medications.userId, userId), eq(medications.isArchived, true)))
      .returning({ id: medications.id });
    await tx
      .update(users)
      .set({ syncEpoch: sql`${users.syncEpoch} + 1` })
      .where(eq(users.id, userId));
    return rows.length;
  });
  await logAudit(userId, "medication", "*", "delete", {
    deleted: { from: deleted, to: 0 },
    filter: { from: null, to: "archived" },
  });
  return { deleted };
}
```

(Confirm `logAudit`'s exact signature against `src/lib/server/audit.ts`; the web wipe actions call it with these sentinel shapes.)

- [ ] **Step 5: Register handlers**

Add to `handlers`:

```ts
upsert_medication_with_schedules: async (userId, payload) => {
  const p = upsertMedicationPayload.parse(payload);
  if (p.id) return updateMedicationWithSchedules(userId, p.id, p.medication, p.schedules);
  return createMedicationWithSchedules(userId, p.medication, p.schedules);
},
archive: async (userId, payload) => { const p = archivePayload.parse(payload); await archiveMedication(userId, p.medicationId); return { ok: true }; },
unarchive: async (userId, payload) => { const p = archivePayload.parse(payload); await unarchiveMedication(userId, p.medicationId); return { ok: true }; },
reorder: async (userId, payload) => { const p = reorderPayload.parse(payload); await swapSortOrder(userId, p.medId1, p.medId2); return { ok: true }; },
update_preferences: async (userId, payload) => updatePreferences(userId, updatePreferencesPayload.parse(payload)),
wipe_dose_history: async (userId) => wipeDoseHistory(userId),
wipe_archived_medications: async (userId) => wipeArchivedMedications(userId),
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/unit/api/commands.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/api/commands.ts src/lib/server/api/wipe.ts src/lib/utils/validation.ts tests/unit/api/commands.test.ts
git commit -m "feat(api): medication/preference/wipe commands (wipes bump sync epoch)"
```

---

### Task 14: `GET /api/v1/export/full` — full-account JSON export

**Files:**

- Create: `src/lib/server/api/export.ts`, `src/routes/api/v1/export/+server.ts`
- Test: `tests/unit/api/export.test.ts`

**Interfaces:**

- Produces:
  - `buildFullExport(userId: string): Promise<FullExport>` where `FullExport = { version: 1; exportedAt: string; profile; preferences; medications: (med & { schedules })[]; doseLogs; inventoryEvents; auditLogs }`.
  - Route `GET /api/v1/export/full` (bearer auth + rate-limit `api-export:${userId}` 10/15min) → the JSON, `Content-Disposition: attachment; filename="medtracker-backup-<ISO date>.json"`.

- [ ] **Step 1: Write the failing test**

`tests/unit/api/export.test.ts` — mock `db` + `getSchedulesForUser`. Assert `buildFullExport` returns `version: 1` and every section, with medications carrying `schedules`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/api/export.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/lib/server/api/export.ts` — reuse `buildSyncResponse` logic with `since=null` (or query directly); wrap with `version`/`exportedAt`. Then the route:

```ts
import { error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { requireApiUser } from "$lib/server/api/auth";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { buildFullExport } from "$lib/server/api/export";

export const GET: RequestHandler = async ({ request }) => {
  const { user } = await requireApiUser(request);
  const { allowed, retryAfterMs } = await checkRateLimit(
    `api-export:${user.id}`,
    10,
    15 * 60 * 1000,
  );
  if (!allowed) {
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    return new Response(JSON.stringify({ error: "rate_limited", retryAfterSeconds }), {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds), "content-type": "application/json" },
    });
  }
  const data = await buildFullExport(user.id);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="medtracker-backup-${date}.json"`,
    },
  });
};
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/api/export.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/api/export.ts src/routes/api/v1/export tests/unit/api/export.test.ts
git commit -m "feat(api): GET /api/v1/export/full versioned account backup"
```

---

### Task 15: Full suite, coverage, and contract doc

**Files:**

- Create: `docs/api-v1-contract.md`
- Modify: none (verification task)

**Interfaces:**

- Produces: a checked-in contract doc the Mac repo consumes (endpoint list, request/response shapes, command types, sync-cursor rules, error codes).

- [ ] **Step 1: Run the whole unit suite**

Run: `npm run test`
Expected: PASS with coverage at or above the floors (statements 30 / branches 25 / functions 25.5 / lines 30). If any floor regressed, add tests to the thinnest new module until green.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run check && npm run lint`
Expected: no errors. Fix any type mismatches (esp. numeric-as-string, `RequestHandler` imports).

- [ ] **Step 3: Write the contract doc**

Create `docs/api-v1-contract.md` documenting: base path, auth header, every endpoint (`POST /auth/login|2fa|apple`, `GET /sync`, `POST /commands`, `GET /export/full`), the command `type` catalog with payload shapes, the sync response shape + cursor/epoch semantics, the tombstone shape, and error codes (`401`, `409 email_conflict`, `429 rate_limited`). This is the source of truth the `medtracker-mac` repo mirrors.

- [ ] **Step 4: Commit**

```bash
git add docs/api-v1-contract.md
git commit -m "docs: /api/v1 contract for the macOS client"
```

- [ ] **Step 5: Manual smoke (optional, needs a real DB)**

With a dev DB configured, run `npm run dev` and exercise: `curl -sX POST localhost:5173/api/v1/auth/login -d '{"email":"...","password":"..."}'` → token; `curl -s localhost:5173/api/v1/sync -H "authorization: Bearer <token>"` → data. (Requires valid `DATABASE_URL`; skip in CI.)

---

## Self-Review

**Spec coverage (Phase 0 rows of §5, §12):**

- §5.1 bearer auth + login + TOTP step → Tasks 3–6. ✅
- §5.1 Sign in with Apple → Tasks 7–8 (native token flow; web redirect deferred, noted). ✅
- §5.2 sync + `updated_at`/tombstones migrations → Tasks 1, 2, 10. ✅ (schedules synced as children — sidesteps missing `updated_at` on `medication_schedules`, documented in Task 10.)
- §5.3 idempotent commands wrapping existing domain fns → Tasks 11–13. ✅
- §5.4 conflict policy (LWW via `updated_at`, command replay, re-pull) → sync cursors + idempotency (Tasks 10–11); client-side re-pull is the Mac plan's job.
- §12 full JSON export → Task 14. ✅
- §5.5 strict versioning + contract doc → Task 15. ✅

**Placeholder scan:** the only intentionally-light spots are test bodies described as "sketch/cases" in Tasks 5, 6, 8, 10–14 where the exact assertions follow the established db-mock harness — each names the concrete cases to assert and the domain fn to check; the handler/implementation code is complete. The `changedSince` helper sketch in Task 10 is explicitly told to be deleted in favor of the explicit per-table `where` blocks.

**Type consistency:** `toSessionUser` (Task 9) replaces the inline `projectUser` in Tasks 5/6/8; `handlers` map is exported from Task 11 and extended in-place by Tasks 12–13; `buildSyncResponse` (Task 10) is reused by `buildFullExport` (Task 14). Command payload schema names are consistent across validation.ts and commands.ts.

**Open confirmations for the implementer (resolve at Task start, don't block):**

- `verifyPassword` exact export name in `src/lib/server/auth/password.ts` (Task 5).
- `logAudit` exact signature in `src/lib/server/audit.ts` (Task 13).
- Whether `getSchedulesForUser` returns archived meds' schedules (it should, for full sync fidelity) — verify in `schedules.ts`.
