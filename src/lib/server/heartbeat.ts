import { env } from "$env/dynamic/private";

/**
 * Dead-man switch for the reminder tick.
 *
 * The failure mode this exists for is *absence*, not error. A cron that
 * stops running raises nothing — no 500, no log line, no failed workflow
 * if the workflow itself is what stopped. CRON_SECRET being unset in
 * Vercel went unnoticed for four months for exactly this reason. An
 * uptime check cannot see it either: it can only observe requests that
 * happen, and the whole problem is that none do.
 *
 * So the signal is inverted. A monitoring service is told to expect a
 * ping on a schedule and alerts when one does not arrive. This module
 * sends that ping, and only after the tick has finished its real work —
 * a ping sent up front would report health for a request that then threw.
 *
 * Provider-agnostic on purpose: Healthchecks.io, Better Stack, Cronitor
 * and Uptime Kuma all expose a dead-man switch as "GET this opaque URL",
 * so HEARTBEAT_URL works with any of them and switching providers is an
 * env var change rather than a code change.
 */

/**
 * Bounded because the reminder loop is sequential and shares one
 * serverless budget — see the note on SEND_TIMEOUT_MS in reminders/
 * dispatch.ts. The same reasoning applies here with less tolerance: a
 * monitoring ping must never be the reason a medication reminder is not
 * sent, so this is deliberately far tighter than a send timeout.
 */
export const HEARTBEAT_TIMEOUT_MS = 2000;

/**
 * The abort raised by AbortSignal.timeout is a DOMException, which is
 * not an `instanceof Error` on every runtime this code sees. Reading
 * `name` structurally keeps the most likely real failure — a timeout —
 * from being flattened into "unknown", which is the one case where the
 * reason string actually has to distinguish a slow provider from an
 * unreachable one.
 */
function errorName(err: unknown): string {
  if (typeof err === "object" && err !== null && "name" in err) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string" && name.length > 0) return name;
  }
  return "unknown";
}

export type HeartbeatResult =
  | { status: "disabled" }
  | { status: "sent" }
  | { status: "invalid-url"; reason: string }
  | { status: "failed"; reason: string };

/**
 * Pings the configured heartbeat URL. Never throws, and never rejects.
 *
 * Returning a result rather than void keeps the outcome assertable in
 * tests without reaching into console output, but no caller is expected
 * to branch on it — there is nothing useful a cron handler could do
 * about a monitoring failure that would not itself need monitoring.
 */
export async function pingHeartbeat(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<HeartbeatResult> {
  const raw = env.HEARTBEAT_URL?.trim();

  // Absence is the normal case in dev, in preview and before the monitor
  // is set up. It must stay a silent no-op, or every local cron run and
  // every preview deployment would ping production's switch and mask a
  // real outage by keeping it green.
  if (!raw) return { status: "disabled" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Deliberately not thrown. Taking the app down over a monitoring
    // typo would be a worse outcome than the misconfiguration itself,
    // and this particular mistake is self-correcting: a heartbeat that
    // never fires is precisely what the receiving end alerts on.
    console.error("[heartbeat] HEARTBEAT_URL is not a valid URL — no ping will be sent.");
    return { status: "invalid-url", reason: "unparseable" };
  }

  if (url.protocol !== "https:") {
    console.error(`[heartbeat] HEARTBEAT_URL must use https, got ${url.protocol} — not pinging.`);
    return { status: "invalid-url", reason: "not-https" };
  }

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
      // The URL is itself the credential on every provider that offers
      // this, so keep it out of Referer if the endpoint ever redirects.
      referrerPolicy: "no-referrer",
    });

    if (!response.ok) {
      console.warn(`[heartbeat] ping returned HTTP ${response.status}`);
      return { status: "failed", reason: `http-${response.status}` };
    }

    return { status: "sent" };
  } catch (err) {
    // Covers the timeout abort and any transport error. Swallowed for
    // the same reason as above: the tick's job is medication reminders,
    // and it has already done it by the time this runs.
    console.warn("[heartbeat] ping failed", err);
    return { status: "failed", reason: errorName(err) };
  }
}
