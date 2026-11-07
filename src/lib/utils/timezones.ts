/**
 * The one answer to "is this a timezone an account may hold?", and the list
 * the Settings select offers.
 *
 * `Intl.supportedValuesOf("timeZone")` is not that answer on its own: it
 * lists canonical IANA zones, and current runtimes leave out "UTC", which is
 * `users.timezone`'s column default and so the zone of every account that has
 * never changed it. Validating against the raw list refused an account's own
 * value: Settings could not be saved without moving zone, a backup exported by
 * that account could not be imported back, and the select, having no "UTC"
 * option, silently offered its first entry instead. "UTC" is added here
 * whatever the runtime's list says, so the answer no longer depends on which
 * ICU the server or the viewer's browser happens to ship.
 */
const RUNTIME_ZONES = Intl.supportedValuesOf("timeZone");

export const SUPPORTED_TIMEZONES: readonly string[] = RUNTIME_ZONES.includes("UTC")
  ? RUNTIME_ZONES
  : ["UTC", ...RUNTIME_ZONES];

const SUPPORTED = new Set(SUPPORTED_TIMEZONES);

export function isSupportedTimezone(timezone: string): boolean {
  return SUPPORTED.has(timezone);
}
