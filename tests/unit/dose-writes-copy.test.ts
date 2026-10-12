// @vitest-environment node
//
// Every dose write on every page takes its endpoints and copy from
// dose-writes/copy.ts, and later tasks import them rather than restate them.
// The strings are the spec's and the plan's, verbatim. They are pinned here so
// that changing one is a decision, not a drift. `toEqual` on the namespace
// also pins the export list: a constant added without a decision fails too.
import { describe, it, expect } from "vitest";
import * as copy from "$lib/components/dose-writes/copy";

describe("dose-writes copy", () => {
  it("says exactly what the spec says, and nothing else", () => {
    expect({ ...copy }).toEqual({
      DELETE_ACTION: "/dashboard?/deleteDose",
      RESTORE_ACTION: "/dashboard?/restoreDose",
      STALE_TAP_MESSAGE: "The list just updated — check it and tap again",
      SUCCESS_FALLBACK_TOAST: "Saved",
      UNDONE_TOAST: "Undone",
      RESTORED_TOAST: "Dose restored",
      OFFLINE_WRITE_TOAST: "You're offline — nothing was saved.",
      UNKNOWN_OUTCOME_TOAST:
        "Couldn't confirm that saved — this page will update when the connection is back.",
      STILL_SAVING_TOAST: "Still saving your last change…",
      CREATE_UNDO_GONE_MESSAGE: "Too late to undo. The dose is still in your log.",
      UNDO_OFFLINE_MESSAGE: "You're offline — Undo will still be here when you're back.",
      UNDO_NETWORK_MESSAGE: "Couldn't reach the server. The undo may not have gone through.",
    });
  });
});
