import { describe, it, expect } from "vitest";
import { urlBase64ToUint8Array } from "$lib/utils/push";

describe("urlBase64ToUint8Array", () => {
  it("decodes a padded base64 string to the right bytes", () => {
    // "AQAB" is the classic base64 for the byte sequence [1, 0, 1].
    expect(Array.from(urlBase64ToUint8Array("AQAB"))).toEqual([1, 0, 1]);
  });

  it("returns a Uint8Array", () => {
    expect(urlBase64ToUint8Array("AQAB")).toBeInstanceOf(Uint8Array);
  });

  it("round-trips arbitrary bytes from an unpadded, URL-safe (base64url) string", () => {
    // Bytes chosen to force both URL-safe substitutions (- and _) and
    // missing padding when base64url-encoded.
    const bytes = Uint8Array.from([251, 255, 191, 0, 4, 200, 9, 62, 63]);
    const b64url = Buffer.from(bytes).toString("base64url");
    expect(b64url).toMatch(/[-_]/); // guards that the fixture actually exercises URL-safe chars
    expect(Array.from(urlBase64ToUint8Array(b64url))).toEqual(Array.from(bytes));
  });

  it("decodes a realistic 65-byte uncompressed P-256 VAPID key length", () => {
    const bytes = new Uint8Array(65);
    bytes[0] = 0x04;
    for (let i = 1; i < 65; i++) bytes[i] = (i * 7) % 256;
    const b64url = Buffer.from(bytes).toString("base64url");
    expect(urlBase64ToUint8Array(b64url)).toHaveLength(65);
    expect(Array.from(urlBase64ToUint8Array(b64url))).toEqual(Array.from(bytes));
  });
});
