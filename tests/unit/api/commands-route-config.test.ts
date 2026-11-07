import { describe, it, expect, vi } from "vitest";

vi.mock("$lib/server/api/auth", () => ({ requireApiUser: vi.fn() }));
vi.mock("$lib/server/api/commands", () => ({ runCommands: vi.fn() }));
vi.mock("$lib/server/auth/rate-limit", () => ({ LIMITS: {}, enforceLimit: vi.fn() }));

const route = await import("../../../src/routes/api/v1/commands/+server");

/**
 * `runCommands` drains up to 200 commands one after another. Killed at the
 * platform's default limit, the command in flight keeps a null-result
 * reservation and replays as `in_progress` for good, so this route carries an
 * explicit budget like the other long routes.
 */
describe("POST /api/v1/commands — function time budget", () => {
  it("declares maxDuration, at the Hobby ceiling the cron and import routes use", () => {
    const config = (route as { config?: { maxDuration?: number } }).config;
    expect(config?.maxDuration).toBe(60);
  });
});
