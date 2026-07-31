import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended interactive-login parameters. Bump these when
// hardware advice changes — needsRehash() compares stored hashes
// against them and the login action transparently re-hashes any
// password whose stored parameters no longer match.
export const ARGON2_PARAMS = {
  memoryCost: 19456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_PARAMS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return verify(hash, password);
}

// A real Argon2id hash (current parameters) of a discarded random
// secret. Login paths verify against it when the account is unknown or
// password-less so response timing cannot enumerate registered emails.
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$r78Qi7iIJiKSmX/onwosfw$5ZGEdBHdbOncXnMKq/hIJNjNZLIddEd6+DkVR0GPtWo";

export async function verifyDummyPassword(password: string): Promise<false> {
  await verify(DUMMY_PASSWORD_HASH, password).catch(() => false);
  return false;
}

// Argon2 PHC strings already embed their parameters
// ($argon2id$v=19$m=19456,t=2,p=1$salt$digest), so no custom version
// prefix is needed — parse them and compare against ARGON2_PARAMS.
// Unrecognised formats return true so legacy hashes get upgraded on
// the next successful login too.
export function needsRehash(storedHash: string): boolean {
  const match = storedHash.match(/^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/);
  if (!match) return true;
  const [memoryCost, timeCost, parallelism] = match.slice(1).map(Number);
  return (
    memoryCost !== ARGON2_PARAMS.memoryCost ||
    timeCost !== ARGON2_PARAMS.timeCost ||
    parallelism !== ARGON2_PARAMS.parallelism
  );
}
