/**
 * Every protected door in the app, and the budget it spends.
 *
 * DATA ONLY — no `db` import, and none may be added. `rate-limit.ts` is the
 * enforcement half and reaches Postgres; this half is a table anyone can
 * read, including the twelve test suites that mock the enforcement module
 * and would otherwise have to stand up a database just to name a policy.
 * Same split as `appearance/registry.ts` against `appearance/schema.ts`.
 *
 * The implementation below is genuinely deep — one atomic upsert that both
 * increments and reads. The INTERFACE hid none of the policy: twenty-five
 * call sites each hand-wrote a key namespace, a maximum and a window, so
 * nothing could enumerate the doors, nothing could compare two doors
 * guarding the same asset, and a typo in a namespace silently created a new
 * unlimited bucket rather than failing.
 *
 * That is not a tidiness complaint. It is how the web login door came to be
 * throttled by IP alone while `/api/v1/auth/login` throttled by IP *and*
 * email — two doors, one credential, no test able to notice, and an attacker
 * with a pool of addresses getting unlimited guesses at any known account
 * through the browser form. Same shape as the tag registry in
 * `utils/push-payload.ts`, and for the same reason.
 *
 * ## `identity` is declared, not implied
 *
 * The field carries no behaviour — `enforceLimit` treats every policy the
 * same. It exists so that "what is this budget scoped to?" is answerable by
 * reading the table instead of by tracing a template literal at the door,
 * because the answer being invisible is precisely what let the login doors
 * diverge. Two policies guarding one asset with different identities is now
 * a visible fact rather than an archaeology exercise.
 */
export type LimitIdentity =
  /** The client address. Bounds volume; cheap for an attacker to rotate. */
  | "ip"
  /** A user id or email. Bounds guessing AT an account — see loginAccount. */
  | "account"
  /** A single-use token id. The budget IS the single-use guarantee. */
  | "token";

export interface LimitPolicy {
  /** Key prefix. Must be disjoint from every other policy's — see the test. */
  readonly namespace: string;
  readonly max: number;
  readonly windowMs: number;
  readonly identity: LimitIdentity;
}

const MINUTE = 60_000;
export const QUARTER_HOUR = 15 * MINUTE;

export const REAUTH_MAX_ATTEMPTS = 10;
export const REAUTH_WINDOW_MS = QUARTER_HOUR;

export const LIMITS = {
  // --- Credential doors -------------------------------------------------
  /**
   * Volume control on sign-in, shared by the browser form and
   * `/api/v1/auth/login`.
   *
   * These were separate policies with different budgets (5 for the browser,
   * 10 for the API) for no reason anybody recorded. Unified at 10: with
   * `loginAccount` below now bounding the thing that actually matters, an
   * IP budget is a throttle on noise, and the stricter of the two only ever
   * punished offices behind one NAT.
   */
  loginIp: { namespace: "login-ip", max: 10, windowMs: QUARTER_HOUR, identity: "ip" },

  /**
   * Guessing budget for ONE account, counted on FAILURE only.
   *
   * The browser door had no account-scoped limit at all, so rotating
   * addresses bought unlimited guesses at a known email. The API door had
   * one, but counted it before verifying — which bounds the attacker and
   * also hands anyone who knows an email address a 15-minute lockout of the
   * real owner, refreshable indefinitely.
   *
   * Counting failures rather than attempts closes both: an attacker still
   * gets `max` wrong guesses per window, and a legitimate user typing the
   * right password is never counted, so there is no lockout to hand out.
   * That asymmetry is the whole point, and it is why this policy must be
   * spent with `recordFailure` after the check rather than `enforceLimit`
   * before it.
   */
  loginAccount: { namespace: "login-account", max: 5, windowMs: QUARTER_HOUR, identity: "account" },

  /**
   * Sign in with Apple. Had NO limiter of any kind — the one credential
   * door in the app that was entirely unbounded.
   */
  appleSignIn: { namespace: "apple-signin", max: 10, windowMs: QUARTER_HOUR, identity: "ip" },

  /**
   * TOTP verification, shared by `/auth/2fa` and `/api/v1/auth/2fa`.
   *
   * Deliberately ONE namespace across both doors: they consume the same
   * signed pre-auth claim, so a per-door budget would let an attacker spend
   * the allowance twice by switching transport. Per-account rather than
   * per-IP because five tries per address against a six-digit space, with
   * addresses free, is not a throttle (NIST SP 800-63B §5.2.2).
   */
  twoFactor: { namespace: "2fa", max: 5, windowMs: QUARTER_HOUR, identity: "account" },

  /**
   * Single-use burn of a pre-auth claim's `jti`. `max: 1` means the second
   * redemption is refused — this row IS the replay guard, not a throttle.
   *
   * The only policy whose window is supplied per call: it is the claim's own
   * remaining lifetime, so the ledger row expires exactly when the token
   * does. See `enforceLimit`'s `windowMs` override.
   */
  preauthBurn: { namespace: "preauth", max: 1, windowMs: 5 * MINUTE, identity: "token" },

  /** Password re-confirmation before a sensitive action. */
  reauth: {
    namespace: "reauth",
    max: REAUTH_MAX_ATTEMPTS,
    windowMs: REAUTH_WINDOW_MS,
    identity: "account",
  },

  register: { namespace: "register", max: 5, windowMs: QUARTER_HOUR, identity: "ip" },
  passwordReset: { namespace: "reset", max: 3, windowMs: QUARTER_HOUR, identity: "ip" },
  emailVerify: { namespace: "email-verify", max: 20, windowMs: QUARTER_HOUR, identity: "ip" },

  // --- Account surfaces -------------------------------------------------
  appearanceSave: { namespace: "appearance", max: 60, windowMs: MINUTE, identity: "account" },
  emailResend: { namespace: "email-resend", max: 3, windowMs: QUARTER_HOUR, identity: "account" },
  pushTest: { namespace: "push-test", max: 5, windowMs: QUARTER_HOUR, identity: "account" },
  pushSubscribe: { namespace: "push-sub", max: 10, windowMs: MINUTE, identity: "account" },

  // --- Import -----------------------------------------------------------
  importPreview: {
    namespace: "import-preview",
    max: 10,
    windowMs: QUARTER_HOUR,
    identity: "account",
  },
  importAttempt: {
    namespace: "import-attempt",
    max: 20,
    windowMs: QUARTER_HOUR,
    identity: "account",
  },
  importCommit: { namespace: "import-commit", max: 5, windowMs: 60 * MINUTE, identity: "account" },

  // --- Exports (each is an expensive query, hence its own budget) --------
  exportReport: { namespace: "export", max: 10, windowMs: QUARTER_HOUR, identity: "account" },
  exportFull: { namespace: "export-full", max: 10, windowMs: QUARTER_HOUR, identity: "account" },
  auditExport: { namespace: "audit-export", max: 10, windowMs: QUARTER_HOUR, identity: "account" },
  apiExportFull: { namespace: "api-export", max: 10, windowMs: QUARTER_HOUR, identity: "account" },

  // --- /api/v1 ----------------------------------------------------------
  apiCommands: { namespace: "api-commands", max: 60, windowMs: MINUTE, identity: "account" },
  apiSync: { namespace: "api-sync", max: 120, windowMs: MINUTE, identity: "account" },
  interactions: { namespace: "interactions", max: 30, windowMs: QUARTER_HOUR, identity: "account" },
} as const satisfies Record<string, LimitPolicy>;

export type LimitName = keyof typeof LIMITS;
