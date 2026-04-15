import { Google, GitHub } from "arctic";
import { env } from "$env/dynamic/private";

export const google = new Google(
  env.GOOGLE_CLIENT_ID!,
  env.GOOGLE_CLIENT_SECRET!,
  "/auth/callback/google",
);

export const github = new GitHub(
  env.GITHUB_CLIENT_ID!,
  env.GITHUB_CLIENT_SECRET!,
  "/auth/callback/github",
);
