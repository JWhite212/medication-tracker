import { test, expect } from "@playwright/test";

test.describe("exports", () => {
  test("CSV export returns a non-empty CSV with the canonical header", async ({ page }) => {
    // Hit the API directly; the UI just links to /api/export. Calling
    // it directly avoids navigating through preference-save races.
    const response = await page.request.get("/api/export?format=csv");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");

    const body = await response.text();
    expect(body.length).toBeGreaterThan(0);
    // generateCsvReport prefixes the file with column headers; the
    // exact wording must match what the dose-history exporter emits.
    expect(body.split("\n")[0]).toMatch(/Date.*Time.*Medication/i);
  });

  test("PDF export returns a non-empty PDF", async ({ page }) => {
    const response = await page.request.get("/api/export?format=pdf");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/pdf");

    const buffer = await response.body();
    expect(buffer.byteLength).toBeGreaterThan(100);
    // PDF magic header is "%PDF-".
    expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
