import type { Cookies } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { returnPathOrNull, type ReturnPath } from "$lib/utils/destructive-confirm";

/**
 * Carries "Sign in again to confirm" back to the page that asked. The OAuth
 * start leg remembers the page (`rememberReturnPath`); whichever step then
 * mints the session takes it (`takeReturnPath`): the callback for an account
 * without a second factor, `/auth/2fa` for one with, which is why it lives in
 * a cookie and not in the provider's `state`.
 */
export const RETURN_PATH_COOKIE = "auth_return_to";

/** The `oauth_state` cookie's options: the two cookies span the same round trip. */
const OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: !dev,
  maxAge: 600,
  sameSite: "lax",
} as const;

/** Remember an allowed page, or forget any earlier one so an abandoned attempt cannot steer this one. */
export function rememberReturnPath(cookies: Cookies, candidate: string | null): void {
  const path = returnPathOrNull(candidate);
  if (path) cookies.set(RETURN_PATH_COOKIE, path, OPTIONS);
  else cookies.delete(RETURN_PATH_COOKIE, { path: "/" });
}

/** The remembered page, used once. Re-checked, because a cookie is the user's to edit. */
export function takeReturnPath(cookies: Cookies): ReturnPath | null {
  const path = returnPathOrNull(cookies.get(RETURN_PATH_COOKIE));
  cookies.delete(RETURN_PATH_COOKIE, { path: "/" });
  return path;
}
