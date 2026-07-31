import { json } from "@sveltejs/kit";

// Shape B of the /api/v1 error contract (see docs/api-v1-contract.md §6):
// a 429 with an `error` key (not `message`) plus a `Retry-After` header.
// Shared by the login, sync, and commands routes.
export function rateLimitedResponse(retryAfterMs: number): Response {
  const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
  return json(
    { error: "rate_limited", retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
