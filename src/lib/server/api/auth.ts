import { error } from "@sveltejs/kit";
import { lucia } from "$lib/server/auth/lucia";
import type { SessionUser } from "$lib/types";

export async function resolveApiUser(
  request: Request,
): Promise<{ user: SessionUser; sessionId: string } | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const sessionId = header.slice("Bearer ".length).trim();
  if (!sessionId) return null;
  const { session, user } = await lucia.validateSession(sessionId);
  if (!session || !user) return null;
  return { user, sessionId };
}

export async function requireApiUser(request: Request) {
  const resolved = await resolveApiUser(request);
  if (!resolved) throw error(401, "Unauthorized");
  return resolved;
}
