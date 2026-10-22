import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import { actionErrorMessage } from "$lib/utils/form-errors";

/**
 * The state behind one `DestructiveConfirm`, and the order its submit applies
 * a result in.
 *
 * Only a `failure` stays in the dialog: the server refused (wrong word, wrong
 * password, a rate limit), nothing was deleted, and the user can correct it
 * where they are. Every other result (success, redirect, and `error` — a
 * crash, an expired session, no response) is applied with `update()` FIRST
 * and the dialog closed only after, so the danger button stays pending until
 * the page actually shows the outcome. An `error` goes to `+error.svelte`, as
 * it did on these pages before the dialog.
 *
 * The message comes from `actionErrorMessage`, never from `result.data`
 * (CLAUDE.md: a call site never re-reads a failed action's data).
 */
export type DestructiveDialog = {
  readonly open: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  /** Open, with no error. */
  show(): void;
  /** Close. DestructiveConfirm refuses to ask for this while pending. */
  close(): void;
  /** A submit from the dialog started: pending, error cleared. */
  begin(): void;
  /** A failure: keep it in the dialog with its message, and return true. Anything else: false. */
  settle(result: ActionResult): boolean;
  /** Pending off, closed. */
  finish(): void;
  /** begin, then settle or (update, finish), for a form that holds only the dialog. */
  submit: SubmitFunction;
};

export function createDestructiveDialog(): DestructiveDialog {
  let open = $state(false);
  let pending = $state(false);
  let error = $state<string | null>(null);

  const dialog: DestructiveDialog = {
    get open() {
      return open;
    },
    get pending() {
      return pending;
    },
    get error() {
      return error;
    },
    show: () => {
      error = null;
      open = true;
    },
    close: () => {
      open = false;
    },
    begin: () => {
      pending = true;
      error = null;
    },
    settle: (result) => {
      if (result.type !== "failure") return false;
      pending = false;
      error = actionErrorMessage(result);
      return true;
    },
    finish: () => {
      pending = false;
      open = false;
    },
    submit: () => {
      dialog.begin();
      return async ({ result, update }) => {
        if (dialog.settle(result)) return;
        try {
          await update();
        } finally {
          dialog.finish();
        }
      };
    },
  };
  return dialog;
}
