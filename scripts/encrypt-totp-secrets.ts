// One-shot migration: re-encrypt every plaintext users.totp_secret with
// AES-256-GCM. Run once after deploying the encryption helper.
//
//   tsx scripts/encrypt-totp-secrets.ts
//
// Idempotent — already-encrypted rows (v1: prefix) are skipped, so it's
// safe to re-run.

import { eq, isNotNull } from "drizzle-orm";
import { db } from "../src/lib/server/db";
import { users } from "../src/lib/server/db/schema";
import { encryptSecret, isEncrypted } from "../src/lib/server/auth/crypto";

async function main() {
  const rows = await db
    .select({ id: users.id, totpSecret: users.totpSecret })
    .from(users)
    .where(isNotNull(users.totpSecret));

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.totpSecret) continue;
    if (isEncrypted(row.totpSecret)) {
      skipped++;
      continue;
    }
    const encrypted = encryptSecret(row.totpSecret);
    await db
      .update(users)
      .set({ totpSecret: encrypted })
      .where(eq(users.id, row.id));
    migrated++;
  }

  console.log(
    `TOTP encryption migration: ${migrated} migrated, ${skipped} already encrypted, ${rows.length} total.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
