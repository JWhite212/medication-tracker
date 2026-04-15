declare global {
  namespace App {
    interface Locals {
      user: import("$lib/types").SessionUser | null;
      session: import("$lib/server/auth/lucia").SessionRecord | null;
    }
  }
}
export {};
