// Shared password-reset token hashing helper.
//
// We never store the raw token; only the SHA-256 hex digest of the
// emailed token is persisted in `password_reset_tokens.token_hash`.
// Both the request and confirm flows must produce the same digest, so
// keep this function as the single source of truth.

export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
