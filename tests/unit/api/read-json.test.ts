import { describe, it, expect } from "vitest";
import { readJson } from "$lib/server/api/read-json";

describe("readJson", () => {
  it("returns the parsed body for valid JSON", async () => {
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    await expect(readJson(req)).resolves.toEqual({ a: 1 });
  });

  it("throws a 400 HttpError for malformed JSON", async () => {
    const req = new Request("http://x", { method: "POST", body: "{not json" });
    await expect(readJson(req)).rejects.toMatchObject({ status: 400 });
  });

  it("throws a 400 HttpError for an empty body", async () => {
    const req = new Request("http://x", { method: "POST" });
    await expect(readJson(req)).rejects.toMatchObject({ status: 400 });
  });
});
