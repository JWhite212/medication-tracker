# Push Payload & Tag Namespace — Design

The push notification contract has two ends and no owner.

At the sending end it is an anonymous type annotation on a parameter
(`src/lib/server/push.ts:62`):

```ts
payload: { title: string; body: string; url?: string; tag?: string },
```

At the receiving end it is four untyped property reads off an `any`
(`src/service-worker.ts:58-67`):

```ts
const data = event.data?.json() ?? {};
const tag = data.tag ?? "medication-reminder";
// data.title ?? "MedTracker", data.body ?? "...", data.url ?? "/dashboard"
```

Neither end can see the other. Rename `url` to `href` on the sender and nothing
fails to compile — every notification silently opens `/dashboard`, forever, and
the first signal is a user saying the buttons go to the wrong page.

Give the contract one owner, and give the tags a namespace that cannot collide.

## The four tag formats

| Tag                            | Written at                               | Naming scheme    |
| ------------------------------ | ---------------------------------------- | ---------------- |
| `medtracker-test`              | `utils/push.ts:10` (const)               | product-prefixed |
| `overdue-<medicationId>`       | `reminders.ts:155` (inline)              | type-prefixed    |
| `low-inventory-<medicationId>` | `reminders.ts:261` (inline)              | type-prefixed    |
| `medication-reminder`          | `service-worker.ts:59` (reader fallback) | neither          |

Three schemes across four values, two of them built by string interpolation at
the call site. The fourth is the interesting one: **no sender ever emits it.**
It exists only as the reader's default for a payload with no tag.

Tags are a replace-key — two notifications sharing a tag leave only the last.
So the reader's fallback is a trap with a fuse in it: `tag` is optional on the
sender, and the day any sender omits it, two different medications collapse
onto `medication-reminder` and the second silently erases the first. That is
the exact failure `CLAUDE.md` already warns about for `TEST_PUSH_TAG`, except
nothing guards this one.

## The constraint: the wire format is frozen

Service workers update lazily. `skipWaiting()` makes a new worker activate
promptly, but only once a page load has fetched it — and a push can arrive at a
device that has not opened the app since the deploy. The server updates
atomically on Vercel; the worker does not.

The live combination during any rollout is therefore **new server → old service
worker**, and that old worker is still reading `data.title`, `data.body`,
`data.url`, `data.tag`. Any field renamed, removed or restructured on the wire
degrades silently for exactly the users who open the app least, and stays
degraded until they next open it.

So every field the current reader consumes keeps arriving under the same name
with the same meaning. All new structure goes on the authoring side.

## Decisions

1. **One module owns the contract: `src/lib/utils/push-payload.ts`.** It lives
   in `utils/` and not `server/` for the reason `TEST_PUSH_TAG` already does —
   the service worker must import it and may never reach `$lib/server`.
2. **A tag registry, not a `kind` discriminator on the wire.** The module owns
   tag construction _and_ recognition, so the test-confirmation hop stops being
   a bare string comparison and becomes a named predicate sitting next to the
   builder that produced it. Adding a `kind` field was considered and rejected:
   it puts the notification's type on the wire twice, in two fields, with
   nothing keeping them honest.
3. **Strict out, lenient in.** `PushPayload` requires all four fields, so
   authors get compile errors. `toNotification` accepts `unknown` and is total,
   so the reader never throws.
4. **A tagless payload omits the tag; it does not get a default one.** See
   below.
5. **Emitted wire bytes are byte-identical.** All three senders already set all
   four fields, so requiring them changes no runtime output.

## Architecture

```ts
// src/lib/utils/push-payload.ts

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

export const TEST_PUSH_TAG = "medtracker-test";

export function overdueTag(medicationId: string): string;
export function lowInventoryTag(medicationId: string): string;
export function isTestTag(tag: string | undefined): boolean;

export function safeNotificationUrl(raw: unknown): string;
export function toNotification(raw: unknown): {
  title: string;
  options: NotificationOptions;
};
```

`NotificationOptions` resolves from `lib.dom`, which the generated
`.svelte-kit/tsconfig.json` includes. The type is erased at build, so the server
importing this module pulls in no DOM runtime dependency.

`TEST_PUSH_TAG` **moves** here from `utils/push.ts`. No re-export shim is left
behind: two import paths to one constant is the disease being cured.
`utils/push.ts` keeps `urlBase64ToUint8Array` and `TEST_PUSH_SHOWN_MESSAGE` —
the latter is a worker↔page channel, not a push wire field, so it does not
belong in the payload module.

### Why the tagless case omits the tag

`toNotification` must handle a payload with no usable tag, because it accepts
`unknown`. It has two options and they are not symmetric:

- **Substitute a shared constant** (today's `medication-reminder`). Every
  tagless notification lands on one replace-key. Two of them, and the first is
  gone from the tray with no trace.
- **Omit `tag` from the options.** The notification does not participate in
  replace-keying at all. Several of them stack up separately.

A stacked duplicate is a cosmetic annoyance. A silently erased medication
reminder is the bug class this whole candidate exists to close. The degenerate
case takes the safe branch, and `medication-reminder` is deleted rather than
relocated.

This is unreachable from our own senders — all three set a tag, and `tag` is
now required — so it changes nothing in production. It makes the trap
untriggerable by construction rather than by care.

### Why the redirect guard moves

`service-worker.ts:134` carries a security control:

```ts
const url = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
```

It has zero tests, and cannot have any while it lives in the worker — jsdom has
no `ServiceWorkerGlobalScope`, so vitest has no attach point. That is the same
gap #108 shipped with. Extracting it as `safeNotificationUrl` puts an
open-redirect guard under test for the first time.

Once extracted it is called at **both** ends: `toNotification` sanitises before
storing the url in `notification.data`, and `notificationclick` sanitises again
on read. Sanitising on write means any future reader is safe by default rather
than by remembering.

The click-time result is unchanged because the guard is idempotent —
`safeNotificationUrl(safeNotificationUrl(x)) === safeNotificationUrl(x)` for all
`x`. That property is pinned by a test rather than asserted in prose.

## Migration

| File                              | Change                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `src/lib/utils/push-payload.ts`   | **new** — the whole contract                                                      |
| `src/lib/utils/push.ts`           | `TEST_PUSH_TAG` removed; keeps `urlBase64ToUint8Array`, `TEST_PUSH_SHOWN_MESSAGE` |
| `src/lib/server/push.ts:62`       | inline param type → `PushPayload`                                                 |
| `src/lib/server/push.ts:153`      | `TEST_PUSH_TAG` import path                                                       |
| `src/lib/server/reminders.ts:155` | `` `overdue-${row.medicationId}` `` → `overdueTag(row.medicationId)`              |
| `src/lib/server/reminders.ts:261` | `` `low-inventory-${med.medicationId}` `` → `lowInventoryTag(med.medicationId)`   |
| `src/service-worker.ts:57-83`     | push handler becomes a shell over `toNotification` + `isTestTag`                  |
| `src/service-worker.ts:129-143`   | `notificationclick` calls `safeNotificationUrl`                                   |
| `CLAUDE.md`                       | record the ownership invariant                                                    |

The worker retains exactly what needs the global scope: `showNotification`,
`clients.matchAll`, `postMessage`, `openWindow`, and the `waitUntil` wiring.
Everything decidable from the payload alone moves out.

`verbatimModuleSyntax` is on, so `PushPayload` must be imported with
`import type`.

### Unchanged

`sendPushNotification`'s body, `PushResult`, `PushErrorReason`,
`hasPushSubscriptions`, `getPushHealth`, `describeTestPushResult`, the VAPID
lazy-load, the 410/404 pruning, both reminder SQL queries, both dedupe-key
builders, `withReminderClaim`, the `install`/`activate`/`fetch` handlers, and
`pushsubscriptionchange`.

## Error handling

`toNotification` is total. `null`, `undefined`, a string, a number, an array, an
object with wrong-typed fields — all resolve to defaults rather than throwing.
The defaults are the current ones: `"MedTracker"`, `"You have a medication
reminder"`, `"/dashboard"`.

**Explicitly out of scope:** `event.data?.json()` can still throw on a malformed
JSON body, before `toNotification` is ever reached. That throw escapes the push
handler and `waitUntil` is never called, which is what produces the browser's
generic "site updated in the background" notification. Guarding it is a separate
change — recorded as a follow-up, not fixed here.

## Testing

Harness before behaviour, per the #110 lesson.

**Wave 1 — pin the current contract, against current code.** Two of the three
emitted tags are already pinned as literals and must keep passing untouched:
`reminders.test.ts:213` (`overdue-med-A`) and `:532` (`low-inventory-med-LI`).

The gap is the third. `push-test-notification.test.ts:83` asserts
`payload.tag === TEST_PUSH_TAG`, comparing the constant to itself — so changing
the constant's _value_ breaks no test. That value is baked into every installed
service worker at build time, so a rename kills the confirmation hop on every
device that has not updated. Wave 1 adds the literal pin:
`expect(TEST_PUSH_TAG).toBe("medtracker-test")`.

**Wave 2 — the new module, in `tests/unit/push-payload.test.ts`:**

1. each builder emits its exact current string for a known id
2. the three tag namespaces are pairwise disjoint for the same id — a property
   test over the registry, so it covers tags added later, not just today's three
3. `isTestTag` accepts the test tag and rejects both reminder tags and
   `undefined`
4. `toNotification` passes through all four fields when they are all present
5. each field falls back independently when missing or wrong-typed
6. a payload with no tag yields options with **no** `tag` key — not
   `medication-reminder`, not `undefined`
7. `toNotification` does not throw on `null`, a string, a number or an array
8. `safeNotificationUrl` admits `/dashboard`, rejects `//evil.example`,
   `https://evil.example` and non-strings
9. `safeNotificationUrl` is idempotent
10. `icon` and `badge` are still `/icons/icon-192.png`

**Wave 3 — verify each test can fail.** Every assertion is re-run against a
deliberately broken copy of the module. The breaks: flip each builder's prefix;
make the tagless branch substitute a constant; make `isTestTag` return `true`
unconditionally; drop the `//` clause from the redirect guard; change an icon
path. A test that stays green against its own break is not testing what it
claims and gets rewritten. This step caught a real defect in #114 and is not
optional.

### The review signal, stated honestly

#114's signal was "every existing test passes byte-identical". This PR cannot
claim that, and pretending otherwise would hide the one thing worth reviewing.

Requiring `url` and `tag` on `PushPayload` breaks three existing call sites that
pass `{ title: "t", body: "b" }` — `push-test-notification.test.ts:110`, `:124`
and `:139`. They are delivery-count tests; the payload is incidental to what
they assert. They gain the two now-required fields.

So the signal is narrower and must hold exactly:

- **No existing assertion changes.** Not one `expect(...)` line is edited.
- **Exactly four existing test lines change**: three payload arguments, plus the
  `TEST_PUSH_TAG` import path at `push-test-notification.test.ts:50`.
- Anything beyond those four means the refactor changed behaviour, and the work
  stops there.

Verified mechanically with `git diff origin/main..HEAD -- tests/`.

Baseline is 743 tests across 62 files. Expect 769 across 63.
Verification: `npm run test`, `npm run check`, `npm run lint`.

## Behaviour changes

Unlike #114 this is not a pure no-op, and the changes are worth naming:

1. **`url` and `tag` become required** on the sender's type. Compile-time only —
   all three senders already set both, so no emitted payload differs.
2. **`medication-reminder` is deleted.** A tagless payload now omits the tag
   rather than defaulting to a shared one. Unreachable from our senders, so no
   production behaviour differs; it is a genuine semantic change in the reader.
3. **`notification.data.url` is now sanitised on write** as well as on read.
   Click-time behaviour is unchanged because the guard is idempotent.

Emitted wire bytes for all three real senders: identical.

## Out of scope

- **Malformed-JSON guarding** around `event.data.json()`, per the scope decision
  above. Its own follow-up.
- **A `kind` discriminator on the wire** — rejected in Decision 2.
- **Testing the service worker itself.** It stays untested; the point of the
  extraction is that almost nothing testable is left in it. The residue is
  `showNotification`, `clients.matchAll`, `postMessage` and `openWindow`.
- **`urgency`/`TTL` on sends and `VAPID_EMAIL`** — push polish deferred from
  #107, unrelated to the contract.
