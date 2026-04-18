import { env } from "$env/dynamic/private";

const required = ["DATABASE_URL"] as const;

const missing = required.filter((key) => !env[key]);
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}. ` +
      `Check .env.example for the full list.`,
  );
}
