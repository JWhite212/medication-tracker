declare global {
  namespace App {
    /**
     * The shape `handleError` returns, and therefore what `$page.error` holds.
     *
     * `message` is always safe to render — it is a fixed string, never the
     * exception's own. `errorId` is present only for unexpected failures (an
     * `error(404, …)` never reaches `handleError`), which is why the error
     * pages render the reference conditionally.
     */
    interface Error {
      message: string;
      errorId?: string;
    }

    interface Locals {
      user: import("$lib/types").SessionUser | null;
      session: import("$lib/server/auth/lucia").SessionRecord | null;
    }
  }
}
export {};
