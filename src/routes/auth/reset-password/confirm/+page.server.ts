import { error, fail, redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { users, passwordResetTokens, sessions } from "$lib/server/db/schema";
import { hashPassword } from "$lib/server/auth/password";
import { eq } from "drizzle-orm";
import type { Actions, PageServerLoad } from "./$types";

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const load: PageServerLoad = async ({ url }) => {
  const token = url.searchParams.get("token");
  if (!token) {
    error(
      400,
      "Missing password reset token. Please request a new reset link.",
    );
  }
  return { token };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const formData = await request.formData();
    const token = String(formData.get("token") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (!token) {
      return fail(400, {
        error: "Missing reset token. Please request a new reset link.",
      });
    }

    if (password.length < 8) {
      return fail(400, {
        error: "Password must be at least 8 characters.",
        token,
      });
    }

    if (password !== confirmPassword) {
      return fail(400, {
        error: "Passwords do not match.",
        token,
      });
    }

    const tokenHash = await hashToken(token);

    const [record] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .limit(1);

    if (!record) {
      return fail(400, {
        error: "Invalid or expired reset link. Please request a new one.",
        token,
      });
    }

    if (record.expiresAt < new Date()) {
      await db
        .delete(passwordResetTokens)
        .where(eq(passwordResetTokens.id, record.id));
      return fail(400, {
        error: "This reset link has expired. Please request a new one.",
        token,
      });
    }

    const passwordHash = await hashPassword(password);

    await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, record.userId));

    // Invalidate every existing session so a compromised cookie can't
    // outlive the password change.
    await db.delete(sessions).where(eq(sessions.userId, record.userId));

    await db
      .delete(passwordResetTokens)
      .where(eq(passwordResetTokens.id, record.id));

    redirect(302, "/auth/login");
  },
};
