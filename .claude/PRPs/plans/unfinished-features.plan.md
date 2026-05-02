# Plan: Unfinished Features — Inventory Alerts, Sort Order, Email Verification, 2FA

## Summary

Complete four features that have DB schema/fields but no wired-up logic: (1) low inventory email alerts in the cron job, (2) medication sort order UI with up/down buttons, (3) email verification on registration with token-based flow, and (4) TOTP 2FA setup/verify/disable in security settings. Ordered from smallest to largest to minimize risk.

## User Story

As a MedTracker user,
I want inventory alerts, medication reordering, verified email, and two-factor authentication,
So that I'm warned before running out, can organize my list, trust my account's email, and secure it with 2FA.

## Problem → Solution

Inventory alerts preference exists but cron never checks inventory → Cron sends email when stock is low. Sort order column exists but no UI → Up/down buttons on medications page. emailVerified field is always false → Verification email sent on register, token endpoint to confirm. TOTP columns exist but no setup flow → QR code setup, code verification, enable/disable in settings.

## Metadata

- **Complexity**: Large
- **Source PRD**: N/A (from opportunity map Theme E)
- **PRD Phase**: N/A
- **Estimated Files**: 18

---

## UX Design

### Interaction Changes

| Touchpoint        | Before                           | After                                          | Notes                                 |
| ----------------- | -------------------------------- | ---------------------------------------------- | ------------------------------------- |
| Low inventory     | Visual badge on card only        | Badge + email alert when below threshold       | Cron checks daily                     |
| Medications list  | Static order, can't rearrange    | Up/down arrow buttons per medication           | Persists via form action              |
| Registration      | Account created, no verification | Verification email sent, banner until verified | Non-blocking — user can still use app |
| Security settings | Password change + sessions only  | + 2FA section: setup QR, verify code, disable  | TOTP via @oslojs/otp                  |
| Login             | Email + password only            | + TOTP code step if 2FA enabled                | Redirects to /auth/2fa after password |

---

## Mandatory Reading

| Priority | File                                                 | Lines | Why                                                    |
| -------- | ---------------------------------------------------- | ----- | ------------------------------------------------------ |
| P0       | `src/lib/server/reminders.ts`                        | all   | Where inventory alert check goes                       |
| P0       | `src/lib/server/email.ts`                            | all   | Email patterns (sendVerificationEmail already exists!) |
| P0       | `src/routes/(app)/settings/security/+page.server.ts` | all   | Where 2FA actions go                                   |
| P0       | `src/routes/(app)/medications/+page.svelte`          | all   | Where sort UI goes                                     |
| P1       | `src/routes/auth/register/+page.server.ts`           | all   | Where verification trigger goes                        |
| P1       | `src/routes/auth/login/+page.server.ts`              | all   | Where 2FA check goes                                   |
| P1       | `src/lib/server/medications.ts`                      | all   | updateMedication + getActiveMedications                |
| P1       | `src/lib/server/db/schema.ts`                        | all   | All table definitions                                  |
| P2       | `src/lib/utils/validation.ts`                        | all   | Zod schema patterns                                    |

---

## Patterns to Mirror

### SERVER_ACTION_WITH_VALIDATION

```typescript
// SOURCE: src/routes/(app)/settings/security/+page.server.ts:24-57
changePassword: async ({ request, locals }) => {
  const formData = Object.fromEntries(await request.formData());
  const parsed = passwordChangeSchema.safeParse(formData);
  if (!parsed.success)
    return fail(400, { passwordErrors: parsed.error.flatten().fieldErrors });
  // ... verify, update, audit
  return { passwordSuccess: true };
},
```

### EMAIL_SEND_PATTERN

```typescript
// SOURCE: src/lib/server/email.ts:20-33
export async function sendVerificationEmail(
  email: string, token: string, requestOrigin: string,
) {
  const verifyUrl = `${getBaseUrl(requestOrigin)}/auth/verify?token=${encodeURIComponent(token)}`;
  await getResend().emails.send({ from: ..., to: email, subject: "Verify your email", html: `...` });
}
```

### CRON_CHECK_PATTERN

```typescript
// SOURCE: src/lib/server/reminders.ts:13-63
export async function checkOverdueMedications() {
  const medsWithLastDose = await db.select({...}).from(medications)
    .innerJoin(users, ...).innerJoin(userPreferences, ...)
    .where(and(...));
  for (const med of medsWithLastDose) { ... await sendReminderEmail(...); }
}
```

### TOKEN_TABLE_PATTERN

```typescript
// SOURCE: src/lib/server/db/schema.ts:161-171
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

---

## Files to Change

| File                                                 | Action | Justification                             |
| ---------------------------------------------------- | ------ | ----------------------------------------- |
| `src/lib/server/reminders.ts`                        | UPDATE | Add checkLowInventoryMedications function |
| `src/lib/server/email.ts`                            | UPDATE | Add sendLowInventoryEmail function        |
| `src/routes/api/cron/reminders/+server.ts`           | UPDATE | Call checkLowInventoryMedications         |
| `src/routes/(app)/medications/+page.svelte`          | UPDATE | Add up/down sort buttons                  |
| `src/routes/(app)/medications/+page.server.ts`       | UPDATE | Add reorder form action                   |
| `src/lib/server/medications.ts`                      | UPDATE | Add updateSortOrder function              |
| `src/lib/server/db/schema.ts`                        | UPDATE | Add emailVerificationTokens table         |
| `src/routes/auth/register/+page.server.ts`           | UPDATE | Send verification email after register    |
| `src/routes/auth/verify/+page.server.ts`             | CREATE | Token verification endpoint               |
| `src/routes/auth/verify/+page.svelte`                | CREATE | Verification result page                  |
| `src/routes/(app)/settings/security/+page.server.ts` | UPDATE | Add 2FA setup/verify/disable actions      |
| `src/routes/(app)/settings/security/+page.svelte`    | UPDATE | Add 2FA UI section                        |
| `src/lib/server/auth/totp.ts`                        | CREATE | TOTP utility functions                    |
| `src/routes/auth/2fa/+page.server.ts`                | CREATE | 2FA verification on login                 |
| `src/routes/auth/2fa/+page.svelte`                   | CREATE | 2FA code input page                       |
| `src/routes/auth/login/+page.server.ts`              | UPDATE | Redirect to /auth/2fa if 2FA enabled      |
| `src/lib/utils/validation.ts`                        | UPDATE | Add totpCodeSchema                        |
| `package.json`                                       | UPDATE | Add @oslojs/otp, qrcode dependencies      |

## NOT Building

- Recovery/backup codes for 2FA (complex, separate feature)
- Mandatory email verification (non-blocking — user can still use app)
- SMS-based 2FA (TOTP only)
- Drag-and-drop reordering (up/down buttons are simpler and accessible)
- Email verification resend flow (can be added later)
- 2FA enforcement for specific actions (just login for now)

---

## Step-by-Step Tasks

### Task 1: Low Inventory Email Alerts

- **ACTION**: Add `sendLowInventoryEmail` to email.ts and `checkLowInventoryMedications` to reminders.ts. Update cron endpoint to call it.
- **IMPLEMENT**:
  `email.ts` — add:

  ```typescript
  export async function sendLowInventoryEmail(
    email: string,
    medicationName: string,
    count: number,
    threshold: number,
  ) {
    await getResend().emails.send({
      from: env.EMAIL_FROM ?? "MedTracker <noreply@yourdomain.com>",
      to: email,
      subject: `Low inventory: ${medicationName}`,
      html: `<p><strong>${escHtml(medicationName)}</strong> has ${count} doses remaining (threshold: ${threshold}).</p>
             <p>Consider refilling soon.</p>`,
    });
  }
  ```

  `reminders.ts` — add:

  ```typescript
  export async function checkLowInventoryMedications() {
    const lowMeds = await db
      .select({
        medicationName: medications.name,
        inventoryCount: medications.inventoryCount,
        inventoryAlertThreshold: medications.inventoryAlertThreshold,
        userEmail: users.email,
      })
      .from(medications)
      .innerJoin(users, eq(medications.userId, users.id))
      .innerJoin(userPreferences, eq(users.id, userPreferences.userId))
      .where(
        and(
          eq(medications.isArchived, false),
          isNotNull(medications.inventoryCount),
          isNotNull(medications.inventoryAlertThreshold),
          eq(userPreferences.lowInventoryAlerts, true),
          sql`${medications.inventoryCount} <= ${medications.inventoryAlertThreshold}`,
        ),
      );

    for (const med of lowMeds) {
      await sendLowInventoryEmail(
        med.userEmail,
        med.medicationName,
        med.inventoryCount!,
        med.inventoryAlertThreshold!,
      );
    }
  }
  ```

  Cron endpoint — add `await checkLowInventoryMedications()` after overdue check.

- **MIRROR**: CRON_CHECK_PATTERN + EMAIL_SEND_PATTERN
- **IMPORTS**: `sendLowInventoryEmail` from `./email`, `sql` from `drizzle-orm`
- **GOTCHA**: The SQL comparison `inventoryCount <= inventoryAlertThreshold` must use raw SQL since Drizzle doesn't have a `lte` that compares two columns directly. This will send on every cron run while inventory is low — consider adding a "last alerted" timestamp later to avoid spam.
- **VALIDATE**: Type-check clean. Manually trigger cron with a medication at threshold.

### Task 2: Medication Sort Order UI

- **ACTION**: Add up/down arrow buttons to medications list page. Add `reorder` form action that swaps adjacent sort orders.
- **IMPLEMENT**:
  `medications.ts` — add:
  ```typescript
  export async function swapSortOrder(userId: string, medId1: string, medId2: string) {
    const [m1] = await db
      .select({ sortOrder: medications.sortOrder })
      .from(medications)
      .where(and(eq(medications.id, medId1), eq(medications.userId, userId)))
      .limit(1);
    const [m2] = await db
      .select({ sortOrder: medications.sortOrder })
      .from(medications)
      .where(and(eq(medications.id, medId2), eq(medications.userId, userId)))
      .limit(1);
    if (!m1 || !m2) return;
    await db.update(medications).set({ sortOrder: m2.sortOrder }).where(eq(medications.id, medId1));
    await db.update(medications).set({ sortOrder: m1.sortOrder }).where(eq(medications.id, medId2));
  }
  ```
  `medications/+page.server.ts` — add reorder action:
  ```typescript
  reorder: async ({ request, locals }) => {
    const formData = await request.formData();
    const medId = formData.get('medicationId') as string;
    const direction = formData.get('direction') as string;
    const meds = await getMedicationsWithStats(locals.user!.id);
    const idx = meds.findIndex(m => m.id === medId);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= meds.length) return;
    await swapSortOrder(locals.user!.id, meds[idx].id, meds[swapIdx].id);
  },
  ```
  `medications/+page.svelte` — wrap each card with sort buttons.
- **MIRROR**: SERVER_ACTION_WITH_VALIDATION
- **IMPORTS**: `swapSortOrder`, `getMedicationsWithStats` from `$lib/server/medications`
- **GOTCHA**: Disable up for first item, down for last. Use `enhance` to prevent full page reload.
- **VALIDATE**: Reorder medications → refresh → order persists.

### Task 3: Email Verification — Schema + Send on Register

- **ACTION**: Add `emailVerificationTokens` table. Send verification email in register action.
- **IMPLEMENT**: Add table mirroring `passwordResetTokens` pattern. In register action, generate token, hash with sha256, store, send email via existing `sendVerificationEmail`.
- **MIRROR**: TOKEN_TABLE_PATTERN
- **IMPORTS**: `@oslojs/crypto/sha2`, `@oslojs/encoding`, `sendVerificationEmail`
- **GOTCHA**: Hash token before storing. Wrap sendVerificationEmail in try/catch so email failure doesn't block registration. Run drizzle migration after.
- **VALIDATE**: Register → verification email sent.

### Task 4: Email Verification — Verify Endpoint

- **ACTION**: Create `/auth/verify` route with load function that validates token and sets emailVerified=true.
- **IMPLEMENT**: Hash incoming token, look up in DB, check expiry, update user, delete token. Show success/failure page.
- **MIRROR**: Password reset confirm flow pattern
- **IMPORTS**: `@oslojs/crypto/sha2`, `@oslojs/encoding`, drizzle modules
- **GOTCHA**: Always hash for comparison. Delete token after use. Check expiry.
- **VALIDATE**: Click verification link → email marked verified in DB.

### Task 5: Install 2FA Dependencies

- **ACTION**: `npm install @oslojs/otp qrcode && npm install -D @types/qrcode`
- **VALIDATE**: Packages install cleanly.

### Task 6: TOTP Utility Module

- **ACTION**: Create `src/lib/server/auth/totp.ts` with generateTOTPSecret, getTOTPUri, generateQRDataUrl, verifyTOTPCode.
- **IMPLEMENT**: Use `@oslojs/otp` for TOTP generation/verification, `@oslojs/encoding` for base32, `qrcode` for QR data URL.
- **GOTCHA**: Secrets stored as base32. `createTOTPKeyURI` needs decoded bytes. Verify API signatures match @oslojs/otp version.
- **VALIDATE**: Type-check clean.

### Task 7: 2FA Server Actions

- **ACTION**: Add setupTwoFactor, verifyTwoFactor, disableTwoFactor actions to security settings server.
- **IMPLEMENT**: Setup stores secret + returns QR. Verify checks code + enables 2FA. Disable requires valid code + clears secret.
- **MIRROR**: SERVER_ACTION_WITH_VALIDATION (changePassword pattern)
- **GOTCHA**: Setup stores secret but doesn't enable — must verify first. Disable requires valid TOTP code.
- **VALIDATE**: Full setup/verify/disable flow works.

### Task 8: 2FA Settings UI

- **ACTION**: Add 2FA section to security settings page with setup button, QR display, code input, enable/disable.
- **MIRROR**: Existing GlassCard sections in same page.
- **VALIDATE**: Visual flow: setup → QR → verify → enabled indicator.

### Task 9: 2FA Login Verification

- **ACTION**: Modify login to redirect to /auth/2fa when 2FA enabled. Create 2FA page with code input.
- **IMPLEMENT**: After password verification, check twoFactorEnabled. If true, set short-lived httpOnly cookie and redirect. 2FA page validates code and creates session.
- **GOTCHA**: Use httpOnly cookie (5-min TTL) for pending user ID. Clear after verification. Don't create session until TOTP verified.
- **VALIDATE**: Login with 2FA → code page → enter code → dashboard.

---

## Testing Strategy

### Unit Tests

| Test                          | Input                        | Expected Output | Edge Case? |
| ----------------------------- | ---------------------------- | --------------- | ---------- |
| TOTP verify with correct code | valid secret + matching code | true            | No         |
| TOTP verify with wrong code   | valid secret + wrong code    | false           | No         |
| generateTOTPSecret            | none                         | base32 string   | No         |
| getTOTPUri                    | secret + email               | otpauth:// URI  | No         |

### Edge Cases Checklist

- [ ] Register with email send failure (should not block registration)
- [ ] Verify with expired token
- [ ] Verify with already-used token
- [ ] 2FA setup without verifying (should not enable)
- [ ] 2FA disable with wrong code (should reject)
- [ ] Login with 2FA when pending_2fa cookie expired
- [ ] Sort order with single medication (buttons disabled)
- [ ] Inventory alert with null threshold (should skip)

---

## Validation Commands

### Static Analysis

```bash
npx svelte-check --tsconfig ./tsconfig.json
```

EXPECT: Zero new type errors

### Unit Tests

```bash
npm test
```

EXPECT: All tests pass

### Database Migration

```bash
npx drizzle-kit generate && npx drizzle-kit push
```

EXPECT: emailVerificationTokens table created

### Manual Validation

- [ ] Register → check email for verification link
- [ ] Click verification link → email marked verified
- [ ] Settings > Security > Set up 2FA → QR code appears
- [ ] Scan QR with authenticator → enter code → 2FA enabled
- [ ] Log out → log in → 2FA code required
- [ ] Enter correct code → dashboard
- [ ] Settings > Security > Disable 2FA → enter code → disabled
- [ ] Medications page → reorder with arrows → persists on refresh
- [ ] Set medication inventory to threshold → next cron sends email

---

## Acceptance Criteria

- [ ] Low inventory alerts sent by cron when stock <= threshold
- [ ] Medications reorderable via up/down buttons
- [ ] Verification email sent on registration
- [ ] /auth/verify endpoint confirms email
- [ ] 2FA setup generates QR code
- [ ] 2FA verification enables protection
- [ ] Login requires TOTP when 2FA enabled
- [ ] 2FA disable requires valid code
- [ ] All type-check clean
- [ ] No regressions in existing tests

## Risks

| Risk                                         | Likelihood | Impact | Mitigation                                                   |
| -------------------------------------------- | ---------- | ------ | ------------------------------------------------------------ |
| TOTP time sync issues                        | Low        | Medium | verifyTOTP handles +-1 window by default                     |
| Inventory alerts spam (sends every cron run) | Medium     | Low    | Document as known limitation; add "last alerted" field later |
| pending_2fa cookie timing                    | Low        | Low    | 5-minute TTL is generous; user can retry login               |
| @oslojs/otp API differences                  | Low        | Medium | Verify API matches plan during implementation                |

## Notes

- `sendVerificationEmail` already exists in email.ts — no need to create the function, just the token flow
- The password reset token pattern is the exact blueprint for email verification tokens
- The 2FA login flow uses a short-lived cookie rather than URL params to avoid token leakage in browser history
- Inventory alerts will fire on every cron run while inventory is low — a "last notified" timestamp could throttle this, but that's a separate improvement
- Sort order uses simple up/down swap rather than drag-and-drop for better accessibility and simpler implementation
