import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "$env/dynamic/private";

const JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export async function verifyAppleIdentityToken(idToken: string): Promise<{
  appleUserId: string;
  email: string | null;
  emailVerified: boolean;
}> {
  if (!env.APPLE_CLIENT_ID) throw new Error("APPLE_CLIENT_ID is not set");
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: "https://appleid.apple.com",
    audience: env.APPLE_CLIENT_ID,
  });
  const ev = payload.email_verified;
  return {
    appleUserId: String(payload.sub),
    email: typeof payload.email === "string" ? payload.email : null,
    emailVerified: ev === true || ev === "true",
  };
}
