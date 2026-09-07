import "$lib/server/env";
import type { Handle, HandleServerError } from "@sveltejs/kit";
import { randomBytes } from "node:crypto";
import { dev } from "$app/environment";
import { lucia } from "$lib/server/auth/lucia";
import { logError } from "$lib/server/log";

const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "ambient-light-sensor=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

export const handle: Handle = async ({ event, resolve }) => {
  const sessionId = event.cookies.get(lucia.sessionCookieName);

  if (!sessionId) {
    event.locals.user = null;
    event.locals.session = null;
    return applySecurityHeaders(await resolve(event));
  }

  const { session, user } = await lucia.validateSession(sessionId);

  if (session && session.fresh) {
    const sessionCookie = lucia.createSessionCookie(session.id);
    event.cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });
  }

  if (!session) {
    const sessionCookie = lucia.createBlankSessionCookie();
    event.cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });
  }

  event.locals.user = user;
  event.locals.session = session;

  return applySecurityHeaders(await resolve(event));
};

function applySecurityHeaders(response: Response): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", PERMISSIONS_POLICY);
  if (!dev) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

/**
 * The one place an unexpected server failure is observed.
 *
 * SvelteKit calls this only for errors nobody threw on purpose — an
 * `error(400, …)` from a form action or a load bypasses it entirely. So
 * everything arriving here is a genuine crash, and the two jobs are: record
 * it once, in a shape that can be found again; and give the user something to
 * quote that is not a stack trace.
 *
 * Before this there was no `handleError` at all. An unexpected throw produced
 * SvelteKit's default "Internal Error" page, a raw stderr line with no route,
 * no user and no id, and nothing tying the two together — so a defect could
 * burn for months while every log line looked like every other one. That is
 * not hypothetical here: it is exactly how the CRON_SECRET outage stayed
 * invisible (see CLAUDE.md).
 *
 * The returned object becomes `$page.error`, so it must carry NOTHING from
 * the exception. `message` is a fixed string; the id is random and meaningless
 * on its own. Everything diagnostic stays server-side.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
  // Short enough to read down a phone line, long enough not to collide within
  // a log retention window. Not derived from anything about the request, so
  // it leaks nothing by existing.
  const errorId = randomBytes(4).toString("hex");

  logError(
    "unhandled server error",
    {
      scope: "http",
      errorId,
      status,
      method: event.request.method,
      routeId: event.route.id,
      path: event.url.pathname,
      userId: event.locals.user?.id,
      // SvelteKit's own description of the failure ("Internal Error"), kept
      // distinct from the exception's message so both are searchable.
      kitMessage: message,
    },
    error,
  );

  return {
    message: "Something went wrong on our end.",
    errorId,
  };
};
