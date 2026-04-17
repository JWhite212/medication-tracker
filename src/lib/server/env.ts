import { env } from "$env/dynamic/private";

const required = ["DATABASE_URL"] as const;

const missing = required.filter((key) => !env[key]);
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}. ` +
      `Check .env.example for the full list.`,
  );
}

export const validatedEnv = {
  DATABASE_URL: env.DATABASE_URL!,
  hasOAuth: !!(env.GOOGLE_CLIENT_ID || env.GITHUB_CLIENT_ID),
  hasEmail: !!env.RESEND_API_KEY,
  hasPush: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
};
