import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { users } from "$lib/server/db/schema";
import { backupEnvelopeSchema, settingsSchema } from "$lib/utils/validation";
import { SUPPORTED_TIMEZONES, isSupportedTimezone } from "$lib/utils/timezones";

// The column default is what every account holds until it changes zone
// (registration and the OAuth callback never set it). Read it from the real
// schema so this test moves with it.
const DEFAULT_TZ = (() => {
  const col = getTableConfig(users).columns.find((c) => c.name === "timezone");
  return col?.default as string;
})();

describe("the default account timezone passes every timezone door", () => {
  it("the column default is UTC (fixture sanity)", () => {
    expect(DEFAULT_TZ).toBe("UTC");
  });

  it("settingsSchema accepts the default timezone", () => {
    const parsed = settingsSchema.safeParse({ name: "Jamie", timezone: DEFAULT_TZ });
    expect(parsed.success).toBe(true);
  });

  it("a backup exported by a default account re-imports (profile validates)", () => {
    const parsed = backupEnvelopeSchema.safeParse({
      version: 1,
      profile: { name: "Jamie", timezone: DEFAULT_TZ },
    });
    expect(parsed.success).toBe(true);
  });

  it("the Settings select offers the default timezone, exactly once", () => {
    expect(SUPPORTED_TIMEZONES.filter((tz) => tz === DEFAULT_TZ)).toHaveLength(1);
    expect(isSupportedTimezone(DEFAULT_TZ)).toBe(true);
  });

  it("a real zone still validates and junk is still refused", () => {
    expect(settingsSchema.safeParse({ name: "J", timezone: "Europe/London" }).success).toBe(true);
    expect(settingsSchema.safeParse({ name: "J", timezone: "Mars/Olympus" }).success).toBe(false);
    expect(isSupportedTimezone("Mars/Olympus")).toBe(false);
  });
});
