/**
 * One shape for every server-side log line.
 *
 * Before this there were fifteen `console.warn`/`console.error` calls across
 * seven files, each formatting itself differently — some with a `[prefix]`,
 * some interpolating into the message, some passing an object as a second
 * argument. Nothing could be grepped, filtered by level, or correlated with a
 * request, which is how a broken cron endpoint stayed invisible for four
 * months.
 *
 * A single JSON line per event, because Vercel's log drain parses JSON and
 * treats anything else as opaque text.
 *
 * WHAT MUST NEVER GO IN HERE: request bodies, cookies, headers, email
 * addresses, medication names, dose notes. `userId` is the only identifier
 * worth carrying — it is already in every audit row, and it is enough to find
 * the account without putting health data in a log aggregator.
 *
 * THREE `console.warn` CALLS DELIBERATELY REMAIN, and they are not strays:
 * two in `utils/contrast.ts` and one in `routes/+layout.ts`. Both modules are
 * client-reachable — contrast runs inside `.svelte` components and the layout
 * load runs in the browser — so neither can import `$lib/server/*` without
 * dragging server code into the bundle. Their output lands in the user's
 * devtools, not in a log drain, so there is nothing to correlate anyway.
 * Everything that runs on the server goes through here.
 */

export type LogLevel = "warn" | "error";

export interface LogFields {
  /** Dot-separated origin, e.g. `reminders.dispatch`. Groups related lines. */
  scope: string;
  /** Correlation id, when the event is tied to a request the user can quote. */
  errorId?: string;
  userId?: string;
  routeId?: string | null;
  method?: string;
  status?: number;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, fields: LogFields, error?: unknown): void {
  const record: Record<string, unknown> = {
    level,
    message,
    ...fields,
    timestamp: new Date().toISOString(),
  };

  if (error instanceof Error) {
    record.error = error.message;
    record.stack = error.stack;
  } else if (error !== undefined) {
    // A thrown non-Error still has to be legible. Stringify defensively —
    // this path exists because something already went wrong, and a logger
    // that throws while reporting an error hides the error it was reporting.
    try {
      record.error = typeof error === "string" ? error : JSON.stringify(error);
    } catch {
      record.error = String(error);
    }
  }

  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else console.warn(line);
}

/** Something recoverable: a degraded path the user did not necessarily see. */
export function logWarn(message: string, fields: LogFields, error?: unknown): void {
  emit("warn", message, fields, error);
}

/** Something that failed: the user saw an error, or an operation did not run. */
export function logError(message: string, fields: LogFields, error?: unknown): void {
  emit("error", message, fields, error);
}
