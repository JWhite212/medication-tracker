# Push Payload & Tag Namespace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the push notification wire contract a single owning module, so the payload is typed at both ends and every notification tag comes from one namespace instead of four ad-hoc string formats.

**Architecture:** A new isomorphic module `src/lib/utils/push-payload.ts` owns the payload type, the tag registry (build **and** recognise), and a pure reader that turns received JSON into `showNotification` arguments. The server imports it to build payloads; the service worker imports it to read them, becoming a thin shell over the pure functions. Emitted wire bytes do not change.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), TypeScript strict, Vitest, `web-push`, Drizzle. Tests run with `npx vitest run`.

**Spec:** `docs/superpowers/specs/2026-08-14-push-payload-namespace-design.md` — read it before Task 1; it argues why each decision below is the one taken.

## Global Constraints

- **The wire format is frozen.** Service workers update lazily, so a push can reach a device whose worker predates the deploy. Every field the current reader consumes (`title`, `body`, `url`, `tag`) keeps arriving under the same name with the same meaning. New structure goes on the authoring side only.
- **Emitted tag strings must stay byte-identical:** `overdue-<medicationId>`, `low-inventory-<medicationId>`, `medtracker-test`.
- **The module lives in `src/lib/utils/`, never `src/lib/server/`.** The service worker imports it and may never reach `$lib/server`.
- **`verbatimModuleSyntax` is on.** Type-only imports must use `import type` or inline `type` specifiers.
- **Test-diff budget — the review gate.** Exactly **four** lines in existing test files may change: three payload arguments in `tests/unit/push-test-notification.test.ts` (lines 110, 124, 139) and the import path at line 50. **No `expect(...)` line may be edited.** Anything beyond those four means behaviour moved; stop and report.
- **Baseline:** 743 tests across 62 files, green in ~5.3s. Run tests with `DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run` — the local `.env` has stale Neon credentials.
- **Commit messages carry no AI/Claude attribution** of any kind — no trailers, no session URLs, no co-author lines.

---

### Task 1: Pin the test tag's literal value

The harness lands before anything moves. `push-test-notification.test.ts:83` asserts `payload.tag === TEST_PUSH_TAG`, which compares the constant to itself — changing the constant's _value_ breaks no test today. That value is compiled into every installed service worker, so a rename silently kills the render-confirmation hop on every device that has not updated yet. Pin it as a literal, against current code, before the constant moves module.

**Files:**

- Test: `tests/unit/push-test-notification.test.ts` (add a new `describe` block; touch nothing else)

**Interfaces:**

- Consumes: `TEST_PUSH_TAG` from `../../src/lib/utils/push` (its current home — Task 4 moves it)
- Produces: nothing later tasks import

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/push-test-notification.test.ts`, at the end of the file:

```ts
describe("TEST_PUSH_TAG", () => {
  // The literal, not the constant. Installed service workers compare
  // against the value compiled into them at build time, so changing this
  // string silently breaks the render-confirmation hop on every device
  // that has not picked up the new worker yet.
  it("is the exact string already deployed to installed service workers", () => {
    expect(TEST_PUSH_TAG).toBe("medtracker-test");
  });
});
```

- [ ] **Step 2: Run it and confirm it passes against current code**

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run tests/unit/push-test-notification.test.ts
```

Expected: PASS. This test pins existing behaviour, so it is green from the start — that is correct for a characterization test.

- [ ] **Step 3: Prove it can fail**

Temporarily edit `src/lib/utils/push.ts:10` to `export const TEST_PUSH_TAG = "medtracker-test-x";` and re-run the command from Step 2.

Expected: FAIL with `expected 'medtracker-test-x' to be 'medtracker-test'`.

**Revert the edit to `push.ts` before continuing.** Confirm with `git diff src/lib/utils/push.ts` printing nothing.

- [ ] **Step 4: Run the full suite**

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run
```

Expected: 744 tests passing across 62 files.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/push-test-notification.test.ts
git commit -m "test(push): pin the test notification tag's literal value"
```

---

### Task 2: The tag registry

Create the owning module with the tag half of the contract only. Nothing consumes it yet, so this task is purely additive — no production behaviour can change.

**Files:**

- Create: `src/lib/utils/push-payload.ts`
- Create: `tests/unit/push-payload.test.ts`

**Interfaces:**

- Consumes: nothing
- Produces:
  - `type PushPayload = { title: string; body: string; url: string; tag: string }`
  - `const TEST_PUSH_TAG: string` (value `"medtracker-test"`)
  - `function overdueTag(medicationId: string): string`
  - `function lowInventoryTag(medicationId: string): string`
  - `function isTestTag(tag: string | undefined): boolean`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/push-payload.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TEST_PUSH_TAG, isTestTag, lowInventoryTag, overdueTag } from "$lib/utils/push-payload";

// Every tag builder in the registry. Add new builders here — the
// collision tests below iterate this list, so a tag added without a
// thought for the existing namespaces fails immediately.
const BUILDERS: Array<[string, (medicationId: string) => string]> = [
  ["overdue", overdueTag],
  ["lowInventory", lowInventoryTag],
  ["test", () => TEST_PUSH_TAG],
];

describe("tag builders", () => {
  it("builds the overdue tag already deployed", () => {
    expect(overdueTag("med-A")).toBe("overdue-med-A");
  });

  it("builds the low-inventory tag already deployed", () => {
    expect(lowInventoryTag("med-LI")).toBe("low-inventory-med-LI");
  });

  it("exposes the test tag already deployed", () => {
    expect(TEST_PUSH_TAG).toBe("medtracker-test");
  });
});

describe("tag namespace disjointness", () => {
  // Tags are a replace-key: two notifications sharing one leave only the
  // last. A collision between namespaces would silently erase a real
  // reminder, so it is a correctness property, not tidiness.
  it("issues a distinct tag from every builder for the same medication", () => {
    const tags = BUILDERS.map(([, build]) => build("med-1"));
    expect(new Set(tags).size).toBe(BUILDERS.length);
  });

  it("cannot be made to collide by an id that mimics another namespace", () => {
    const hostile = ["low-inventory-med-1", "overdue-med-1", "medtracker-test", ""];
    for (const id of hostile) {
      expect(overdueTag(id)).not.toBe(lowInventoryTag(id));
      expect(overdueTag(id)).not.toBe(TEST_PUSH_TAG);
      expect(lowInventoryTag(id)).not.toBe(TEST_PUSH_TAG);
    }
  });
});

describe("isTestTag", () => {
  it("recognises the test tag", () => {
    expect(isTestTag(TEST_PUSH_TAG)).toBe(true);
  });

  it("rejects reminder tags", () => {
    expect(isTestTag(overdueTag("med-1"))).toBe(false);
    expect(isTestTag(lowInventoryTag("med-1"))).toBe(false);
  });

  it("rejects an absent tag", () => {
    expect(isTestTag(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run tests/unit/push-payload.test.ts
```

Expected: FAIL — the module does not exist, so the import cannot resolve.

- [ ] **Step 3: Write the module**

Create `src/lib/utils/push-payload.ts`:

```ts
/**
 * Sole owner of the push notification wire contract.
 *
 * Both ends live here: senders build a `PushPayload`, the service worker
 * turns received JSON back into notification arguments. Neither writes a
 * tag nor reads a field by hand.
 *
 * This is in `utils/` rather than `server/` because the service worker
 * imports it, and the worker may never reach `$lib/server`.
 *
 * The wire format is frozen. Service workers update lazily, so a push can
 * reach a device whose worker predates the current deploy — renaming or
 * restructuring a field degrades silently for exactly the users who open
 * the app least. New structure goes on the authoring side only.
 */

/** What every sender must produce. All four fields are required. */
export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

/**
 * Tag carried by the user-initiated test notification.
 *
 * Never equal to a reminder tag: notifications sharing a tag replace one
 * another, so a collision would let a test silently clear a real reminder
 * out of the tray. Installed service workers compare against the value
 * compiled into them, so changing this string breaks the render
 * confirmation on every device that has not updated yet.
 */
export const TEST_PUSH_TAG = "medtracker-test";

/** Replace-key for one medication's overdue reminder. */
export function overdueTag(medicationId: string): string {
  return `overdue-${medicationId}`;
}

/** Replace-key for one medication's low-inventory alert. */
export function lowInventoryTag(medicationId: string): string {
  return `low-inventory-${medicationId}`;
}

/**
 * True when a tag was issued as the test tag. The service worker gates
 * its render-confirmation message on this; real reminders stay silent.
 */
export function isTestTag(tag: string | undefined): boolean {
  return tag === TEST_PUSH_TAG;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run tests/unit/push-payload.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Prove every test can fail**

Apply each break one at a time, re-run the command from Step 4, confirm the named test fails, then revert before the next break.

| Break                                                             | Test that must fail                                 |
| ----------------------------------------------------------------- | --------------------------------------------------- |
| `overdueTag` returns `` `overdue_${medicationId}` `` (underscore) | "builds the overdue tag already deployed"           |
| `lowInventoryTag` returns `` `low-inventory-${medicationId}x` ``  | "builds the low-inventory tag already deployed"     |
| `lowInventoryTag` returns `` `overdue-${medicationId}` ``         | both disjointness tests                             |
| `TEST_PUSH_TAG = "medtracker-test-x"`                             | "exposes the test tag already deployed"             |
| `isTestTag` returns `true` unconditionally                        | "rejects reminder tags" and "rejects an absent tag" |

A test that stays green against its own break is not testing what it claims — rewrite it before moving on. Confirm `git diff src/lib/utils/push-payload.ts` prints nothing once all five are reverted.

- [ ] **Step 6: Typecheck and lint**

```bash
npm run check && npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils/push-payload.ts tests/unit/push-payload.test.ts
git commit -m "feat(push): add a tag registry that owns the notification namespace"
```

---

### Task 3: The pure reader

Add the reading half to the same module: the payload → `showNotification` arguments transform, plus the open-redirect guard extracted from the service worker. Still additive — the worker does not consume these until Task 5.

**Files:**

- Modify: `src/lib/utils/push-payload.ts` (append)
- Modify: `tests/unit/push-payload.test.ts` (append)

**Interfaces:**

- Consumes: `TEST_PUSH_TAG`, `overdueTag` from Task 2 (same module)
- Produces:
  - `function safeNotificationUrl(raw: unknown): string`
  - `function toNotification(raw: unknown): { title: string; options: NotificationOptions }`

- [ ] **Step 1: Write the failing tests**

First replace the import block at the top of `tests/unit/push-payload.test.ts` with:

```ts
import {
  TEST_PUSH_TAG,
  isTestTag,
  lowInventoryTag,
  overdueTag,
  safeNotificationUrl,
  toNotification,
} from "$lib/utils/push-payload";
```

Then append to the same file:

```ts
describe("safeNotificationUrl", () => {
  it("admits a rooted same-origin path", () => {
    expect(safeNotificationUrl("/medications")).toBe("/medications");
  });

  it("rejects a protocol-relative path that would leave the app", () => {
    expect(safeNotificationUrl("//evil.example/x")).toBe("/dashboard");
  });

  it("rejects an absolute url", () => {
    expect(safeNotificationUrl("https://evil.example/x")).toBe("/dashboard");
  });

  it("rejects anything that is not a string", () => {
    expect(safeNotificationUrl(undefined)).toBe("/dashboard");
    expect(safeNotificationUrl(null)).toBe("/dashboard");
    expect(safeNotificationUrl(42)).toBe("/dashboard");
    expect(safeNotificationUrl({ url: "/x" })).toBe("/dashboard");
  });

  // The guard runs twice: once when the url is stored on the
  // notification, once when it is read back on click. Idempotence is
  // what makes the second run a no-op rather than a behaviour change.
  it("is idempotent", () => {
    for (const raw of ["/medications", "//evil.example", "https://evil.example", 42]) {
      expect(safeNotificationUrl(safeNotificationUrl(raw))).toBe(safeNotificationUrl(raw));
    }
  });
});

describe("toNotification", () => {
  it("passes a complete payload straight through", () => {
    const { title, options } = toNotification({
      title: "Ibuprofen overdue",
      body: "Last logged 3 hours ago",
      url: "/dashboard",
      tag: overdueTag("med-A"),
    });
    expect(title).toBe("Ibuprofen overdue");
    expect(options.body).toBe("Last logged 3 hours ago");
    expect(options.tag).toBe("overdue-med-A");
    expect(options.data).toEqual({ url: "/dashboard" });
  });

  it("keeps the icon and badge the installed workers already use", () => {
    const { options } = toNotification({});
    expect(options.icon).toBe("/icons/icon-192.png");
    expect(options.badge).toBe("/icons/icon-192.png");
  });

  it("falls back per field when fields are missing", () => {
    const { title, options } = toNotification({});
    expect(title).toBe("MedTracker");
    expect(options.body).toBe("You have a medication reminder");
    expect(options.data).toEqual({ url: "/dashboard" });
  });

  it("falls back per field when fields are the wrong type", () => {
    const { title, options } = toNotification({ title: 1, body: [], url: {}, tag: 7 });
    expect(title).toBe("MedTracker");
    expect(options.body).toBe("You have a medication reminder");
    expect(options.data).toEqual({ url: "/dashboard" });
  });

  it("sanitises a hostile url before storing it on the notification", () => {
    const { options } = toNotification({ url: "//evil.example/x" });
    expect(options.data).toEqual({ url: "/dashboard" });
  });

  // A shared default tag would be worse than none: tags are a
  // replace-key, so two untagged notifications for different medications
  // would collapse onto it and the second would silently erase the
  // first. Omitting the key lets them stack instead.
  it("omits the tag entirely when the payload has none", () => {
    const { options } = toNotification({ title: "x", body: "y", url: "/dashboard" });
    expect("tag" in options).toBe(false);
  });

  it("omits the tag when it is an empty string", () => {
    const { options } = toNotification({ tag: "" });
    expect("tag" in options).toBe(false);
  });

  // The explicit tuple type is required: without it TypeScript infers a
  // narrow union from the heterogeneous rows and rejects the table.
  it.each<[unknown]>([[null], [undefined], ["a string"], [42], [[1, 2, 3]]])(
    "does not throw on non-object payload %p",
    (raw) => {
      expect(() => toNotification(raw)).not.toThrow();
      expect(toNotification(raw).title).toBe("MedTracker");
    },
  );
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run tests/unit/push-payload.test.ts
```

Expected: FAIL — `safeNotificationUrl` and `toNotification` are not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/utils/push-payload.ts`:

```ts
const DEFAULT_TITLE = "MedTracker";
const DEFAULT_BODY = "You have a medication reminder";
const DEFAULT_URL = "/dashboard";
const ICON = "/icons/icon-192.png";

/**
 * Reduce an arbitrary value to a same-origin relative path.
 *
 * `"//host"` is protocol-relative and would leave the app, so a leading
 * double slash is rejected along with anything that is not a rooted path.
 *
 * Idempotent, which is what lets it run at both ends — once when the url
 * is stored on the notification, once when it is read back on click — so
 * that a future reader is safe by default rather than by remembering.
 */
export function safeNotificationUrl(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_URL;
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : DEFAULT_URL;
}

/**
 * Turn a received push body into arguments for `showNotification()`.
 *
 * Total by construction: the argument is whatever JSON arrived over the
 * wire, so every field falls back independently rather than throwing.
 *
 * A payload with no usable tag gets NO tag rather than a shared default.
 * Tags are a replace-key, so a shared default would let notifications for
 * two different medications overwrite one another and silently lose the
 * first. Untagged notifications merely stack, which is the safe failure.
 */
export function toNotification(raw: unknown): {
  title: string;
  options: NotificationOptions;
} {
  const data: Record<string, unknown> =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  const options: NotificationOptions = {
    body: typeof data.body === "string" ? data.body : DEFAULT_BODY,
    icon: ICON,
    badge: ICON,
    data: { url: safeNotificationUrl(data.url) },
  };
  if (typeof data.tag === "string" && data.tag !== "") options.tag = data.tag;

  return {
    title: typeof data.title === "string" ? data.title : DEFAULT_TITLE,
    options,
  };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run tests/unit/push-payload.test.ts
```

Expected: PASS, 25 tests in this file — 8 from Task 2 plus 17 here (5 for `safeNotificationUrl`, 12 for `toNotification`, the `it.each` expanding to 5 of them).

- [ ] **Step 5: Prove every test can fail**

Apply each break one at a time, re-run Step 4, confirm the named test fails, revert before the next.

| Break                                                                   | Test that must fail                                      |
| ----------------------------------------------------------------------- | -------------------------------------------------------- |
| Drop `&& !raw.startsWith("//")` from `safeNotificationUrl`              | "rejects a protocol-relative path…"                      |
| `safeNotificationUrl` returns `raw` as-is when it is a string           | "rejects an absolute url"                                |
| `toNotification` sets `options.tag = data.tag ?? "medication-reminder"` | "omits the tag entirely…" and "omits the tag when…empty" |
| `toNotification` stores `data: { url: data.url }` unsanitised           | "sanitises a hostile url…"                               |
| `ICON = "/icons/icon-512.png"`                                          | "keeps the icon and badge…"                              |
| `toNotification` drops the `typeof raw === "object"` guard              | "does not throw on non-object payload" cases             |

Confirm `git diff src/lib/utils/push-payload.ts` prints nothing once all six are reverted.

- [ ] **Step 6: Typecheck and lint**

```bash
npm run check && npm run lint
```

Expected: no errors. If `NotificationOptions` does not resolve, stop and report — the generated `.svelte-kit/tsconfig.json` should list `DOM` in `lib`, and a missing entry is a config problem, not something to work around with a hand-rolled type.

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils/push-payload.ts tests/unit/push-payload.test.ts
git commit -m "feat(push): add a pure reader for received push payloads"
```

---

### Task 4: Route the senders through the contract

Point the three senders at the owning module and make `PushPayload` the parameter type. This is where the test-diff budget applies: exactly four existing test lines change, none of them an assertion.

**Files:**

- Modify: `src/lib/utils/push.ts` (remove `TEST_PUSH_TAG` and its doc comment)
- Modify: `src/lib/server/push.ts:4` and `:60-63` and `:148-155`
- Modify: `src/lib/server/reminders.ts` (imports, `:155`, `:261`)
- Modify: `tests/unit/push-test-notification.test.ts:50`, `:110`, `:124`, `:139`

**Interfaces:**

- Consumes: `PushPayload`, `TEST_PUSH_TAG`, `overdueTag`, `lowInventoryTag` from Task 2
- Produces: `sendPushNotification(userId: string, payload: PushPayload): Promise<PushResult>` — the second parameter now requires all four fields

- [ ] **Step 1: Move `TEST_PUSH_TAG` out of `utils/push.ts`**

Delete lines 1–10 of `src/lib/utils/push.ts` — the block comment and the `export const TEST_PUSH_TAG = "medtracker-test";` line. The file now begins with the `TEST_PUSH_SHOWN_MESSAGE` comment.

No re-export shim is left behind: two import paths to one constant is the problem being solved. `TEST_PUSH_SHOWN_MESSAGE` stays because it is a worker↔page channel, not a push wire field, and `urlBase64ToUint8Array` stays because it is a browser subscribe helper.

- [ ] **Step 2: Update `src/lib/server/push.ts`**

Replace line 4:

```ts
import { TEST_PUSH_TAG, type PushPayload } from "$lib/utils/push-payload";
```

Replace the signature at lines 60–63:

```ts
export async function sendPushNotification(
  userId: string,
  payload: PushPayload,
): Promise<PushResult> {
```

`sendTestPush` at line 148 needs no body change — it already sets all four fields and `TEST_PUSH_TAG` now resolves from the new import.

- [ ] **Step 3: Update `src/lib/server/reminders.ts`**

Add to the imports, after the `$lib/utils/time` line:

```ts
import { lowInventoryTag, overdueTag } from "$lib/utils/push-payload";
```

At line 155, replace ``tag: `overdue-${row.medicationId}`,`` with:

```ts
            tag: overdueTag(row.medicationId),
```

At line 261, replace ``tag: `low-inventory-${med.medicationId}`,`` with:

```ts
            tag: lowInventoryTag(med.medicationId),
```

- [ ] **Step 4: Update the four test lines**

In `tests/unit/push-test-notification.test.ts`, line 50:

```ts
const { TEST_PUSH_TAG } = await import("../../src/lib/utils/push-payload");
```

At lines 110, 124 and 139, the payload argument gains the two now-required fields. `TEST_PUSH_TAG` is already in scope from line 50, so no new import is needed. Each becomes:

```ts
const result = await sendPushNotification("user-1", {
  title: "t",
  body: "b",
  url: "/dashboard",
  tag: TEST_PUSH_TAG,
});
```

Change nothing else in this file. The `expect(payload.tag).toBe(TEST_PUSH_TAG)` at line 83 and every other assertion stay exactly as they are.

- [ ] **Step 5: Run the full suite**

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run
```

Expected: 769 tests passing across 63 files. In particular `reminders.test.ts:213` (`overdue-med-A`) and `:532` (`low-inventory-med-LI`) must pass **untouched** — they are the proof the emitted tags did not change.

- [ ] **Step 6: Check the test-diff budget**

```bash
git diff origin/main..HEAD -- tests/ | grep '^-' | grep -v '^---'
```

Expected: exactly **four** removed lines, all from `push-test-notification.test.ts` — the old `$lib/utils/push` import at line 50, and the three single-line `await sendPushNotification("user-1", { title: "t", body: "b" });` calls that become multi-line. **Zero** removed lines containing `expect(`.

If any `expect(` line appears, behaviour changed. Stop and report rather than adjusting the test.

- [ ] **Step 7: Typecheck and lint**

```bash
npm run check && npm run lint
```

Expected: no errors. A type error at a `sendPushNotification` call site means a sender is missing `url` or `tag` — add the real value, do not loosen `PushPayload`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/utils/push.ts src/lib/server/push.ts src/lib/server/reminders.ts tests/unit/push-test-notification.test.ts
git commit -m "refactor(push): build every payload and tag through the owning module"
```

---

### Task 5: The service worker becomes a shell

Replace the worker's inline field reads with calls into the pure module, leaving only what genuinely needs the worker's global scope. This deletes the `medication-reminder` default.

**Files:**

- Modify: `src/service-worker.ts:8` (imports), `:57-83` (push handler), `:129-143` (notificationclick)

**Interfaces:**

- Consumes: `isTestTag`, `safeNotificationUrl`, `toNotification` from Task 3; `TEST_PUSH_SHOWN_MESSAGE` from `$lib/utils/push`
- Produces: nothing

- [ ] **Step 1: Update the imports**

Replace line 8 with:

```ts
import { TEST_PUSH_SHOWN_MESSAGE } from "$lib/utils/push";
import { isTestTag, safeNotificationUrl, toNotification } from "$lib/utils/push-payload";
```

- [ ] **Step 2: Replace the push handler**

Replace the whole `self.addEventListener("push", ...)` block at lines 57–83 with:

```ts
self.addEventListener("push", (event) => {
  // Every decision that can be made from the payload alone lives in
  // `toNotification`, where vitest can reach it — jsdom has no
  // ServiceWorkerGlobalScope, so anything left in this file is untestable.
  const { title, options } = toNotification(event.data?.json());
  event.waitUntil(
    self.registration
      .showNotification(title, options)
      // "The push service accepted it" is not the same as "the user saw
      // it" — the OS can suppress a notification after delivery, which
      // is exactly the case someone reaches for the test button to
      // diagnose. Telling the open page that showNotification actually
      // resolved closes that gap. Only test notifications report back,
      // so real reminders stay silent to the page.
      .then(async () => {
        if (!isTestTag(options.tag)) return;
        const clients = await self.clients.matchAll({ type: "window" });
        for (const client of clients) {
          client.postMessage({ type: TEST_PUSH_SHOWN_MESSAGE });
        }
      }),
  );
});
```

The `?? {}` that used to follow `event.data?.json()` is gone because `toNotification` accepts `undefined` and every other shape.

- [ ] **Step 3: Replace the notificationclick url guard**

In the `notificationclick` handler, replace the two lines that compute `raw` and `url` (lines 131–134) with:

```ts
// Re-guarded on read as well as on write: the url was sanitised when
// the notification was created, but a reader that trusts stored data
// is one refactor away from an open redirect. The guard is idempotent.
const url = safeNotificationUrl(event.notification.data?.url);
```

- [ ] **Step 4: Typecheck, lint, and build**

```bash
npm run check && npm run lint && npm run build
```

Expected: no errors. The build must be run here specifically — the service worker is compiled by `vite build` and not exercised by any test, so this is the only automated check it gets.

- [ ] **Step 5: Confirm the deleted default is really gone**

```bash
grep -rn "medication-reminder" src/ || echo "gone"
```

Expected: `gone`.

- [ ] **Step 6: Run the full suite**

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run
```

Expected: 769 tests passing across 63 files, unchanged from Task 4 — this task touches no test.

- [ ] **Step 7: Commit**

```bash
git add src/service-worker.ts
git commit -m "refactor(push): reduce the service worker to a shell over the payload module"
```

---

### Task 6: Record the invariant and produce the evidence

Write down the rule so the next person does not re-scatter it, and assemble the mechanical evidence the review depends on.

**Files:**

- Modify: `CLAUDE.md` (the Gotchas section)

**Interfaces:**

- Consumes: everything from Tasks 2–5
- Produces: nothing

- [ ] **Step 1: Update CLAUDE.md**

In the Gotchas section, replace the existing bullet that begins "Notification `tag`s are a replace-key" with:

```markdown
- **`src/lib/utils/push-payload.ts` owns the push wire contract.** Senders
  build a `PushPayload` (all four fields required) and take their tag from
  the registry — `overdueTag`, `lowInventoryTag`, `TEST_PUSH_TAG` — never a
  hand-written string. The service worker reads via `toNotification` and
  `safeNotificationUrl`, so the fallback logic is unit-testable; the worker
  itself has no test attach point (jsdom has no `ServiceWorkerGlobalScope`).
  It lives in `utils/` and not `server/` because the worker imports it.
- Notification `tag`s are a replace-key: showing two notifications with the
  same tag leaves only the last one. That is why the registry's namespaces
  must stay disjoint (there is a test), why the test tag must never equal a
  reminder tag, and why `toNotification` **omits** the tag for a payload
  that has none rather than substituting a shared default — a shared
  default would let two medications' notifications erase one another.
- **The push wire format is frozen.** Service workers update lazily, so a
  push can reach a device whose worker predates the deploy. Renaming or
  restructuring `title`/`body`/`url`/`tag` degrades silently for exactly
  the users who open the app least. Add fields, never rename them.
```

- [ ] **Step 2: Run every check**

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run && npm run check && npm run lint && npm run build
```

Expected: 769 tests across 63 files, no type errors, no lint errors, clean build.

- [ ] **Step 3: Produce the review evidence**

```bash
echo "--- existing-test deletions (budget: 4, none may contain expect) ---"
git diff origin/main..HEAD -- tests/unit/push-test-notification.test.ts | grep '^-' | grep -v '^---'
echo "--- any assertion removed anywhere in tests/? (must be empty) ---"
git diff origin/main..HEAD -- tests/ | grep '^-' | grep -v '^---' | grep 'expect('
echo "--- emitted tag literals still pinned ---"
grep -n "overdue-med-A\|low-inventory-med-LI\|medtracker-test" tests/unit/reminders.test.ts tests/unit/push-payload.test.ts tests/unit/push-test-notification.test.ts
```

Expected: four deletions in the first block, **empty** second block, and the tag literals present.

If the second block is non-empty, an assertion was edited — the refactor changed behaviour. Stop and report; do not proceed to the PR.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the push payload contract ownership invariant"
```

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin refactor/push-payload-namespace
```

Open a PR against `main`. The body must state: the four-line test-diff budget and that it held; that emitted wire bytes are unchanged for all three senders; and the three behaviour changes named in the spec (required `url`/`tag`, `medication-reminder` deleted, url sanitised on write). No AI or Claude attribution anywhere in the message or body.

Note that CodeRabbit was rate-limited on both #113 and #114, so a green check is not a review — check whether it actually ran.

---

## Follow-ups deliberately deferred

Record these on the PR rather than fixing them here:

- **Malformed-JSON guarding.** `event.data?.json()` can still throw before `toNotification` is reached, which escapes the handler and leaves `waitUntil` uncalled — producing the browser's generic "site updated in the background" notification. Its own change.
- **The service worker still has no tests at any depth.** The extraction shrinks the untested residue to `showNotification`, `clients.matchAll`, `postMessage` and `openWindow`, but does not eliminate it.
- **Push polish from #107** — `urgency`/`TTL` on sends, `VAPID_EMAIL`, 401-not-500 on a missing `CRON_SECRET`, cron heartbeat alerting.
