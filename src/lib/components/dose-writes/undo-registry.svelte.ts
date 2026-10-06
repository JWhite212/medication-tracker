import { tick } from "svelte";
import type { ActionResult } from "@sveltejs/kit";
import { browser } from "$app/environment";
import { deserialize } from "$app/forms";
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";
import { actionErrorMessage } from "$lib/utils/form-errors";
import {
  DELETE_ACTION,
  RESTORE_ACTION,
  RESTORED_TOAST,
  UNDO_NETWORK_MESSAGE,
  UNDO_OFFLINE_MESSAGE,
  UNDONE_TOAST,
} from "./copy";
import type { DoseWriteLock } from "./dose-write-lock.svelte";
import { focusIfLost } from "./focus-after";
import { reloadAfterWrite } from "./reload-after-write";

/**
 * The ONE Undo offer on screen, and how pressing it runs.
 *
 * Module state, like Toast's list, because an offer outlives the page that
 * made it: log a dose on the dashboard, go to /log, and the Undo is still
 * there. Every mutator is a no-op when `!browser`: this module is evaluated
 * during SSR on every authenticated page, and module state is per-process on
 * the server, so an offer made during SSR would be shown to whichever user
 * rendered next.
 *
 * At most one offer exists. The next successful dose write replaces it, which
 * is what removes "which Undo?" when several toasts each carried one, and the
 * double click that landed on an older toast's Undo once the newer one went.
 * It stays until it is pressed and settles, dismissed, replaced, withdrawn by
 * a write to the same dose, or its deadline passes. A running offer is never
 * replaced or withdrawn: an Undo holds the layout's write lock, so no other
 * write can even start, and every mutator below refuses a running offer too.
 *
 * An offer never captures a lock. `runUndo` is handed the lock of the layout
 * that is on screen when the button is pressed (Toast reads it from context),
 * which is what makes an Undo pressed after navigating hold the lock the new
 * page's controls read.
 */

export type UndoKind = "delete" | "restore";

export interface UndoOfferInput {
  message: string;
  doseId: string;
  /** "delete": a create's Undo, which deletes the new dose. "restore": a delete's Undo. */
  kind: UndoKind;
  /** A restore's key, exactly as the delete action returned it. */
  deletedAt?: string;
  /** How long the server keeps the dose restorable, from the delete's response. */
  expiresInMs?: number;
  /** Epoch ms the response that made this offer arrived; the deadline counts from here. Defaults to now. */
  respondedAt?: number;
  /** Where focus goes once the Undo's reload has rendered the page. */
  focusTarget: () => HTMLElement | null;
}

export interface UndoOffer extends UndoOfferInput {
  id: string;
  /** Epoch ms after which the offer is gone. */
  deadline: number;
  /** An Undo for this offer is in flight: its button reads "Undoing…". */
  running: boolean;
  /** A line under the message: why the offer is still here after a press. */
  note: string | null;
}

export type UndoOutcome =
  | { kind: "settled"; message: string; type: "success" | "error" }
  | { kind: "kept"; note: string }
  | { kind: "refused" };

/**
 * A restore's offer goes this long before the server's window closes, so a
 * press in the last seconds is not refused as "too late" while in flight.
 */
const RESTORE_DEADLINE_MARGIN_MS = 30_000;

let offer = $state.raw<UndoOffer | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
/** Where focus was before it entered the toast stack; Toast records it. */
let focusBeforeStack: HTMLElement | null = null;

function stopTimer(): void {
  clearTimeout(timer);
  timer = undefined;
}

/** Remove the offer with this id, if it is still the current one. */
function drop(id: string): void {
  if (offer?.id !== id) return;
  stopTimer();
  offer = null;
}

/** Update the offer with this id, if it is still the current one. */
function patch(id: string, changes: Partial<Pick<UndoOffer, "running" | "note">>): void {
  const current = offer;
  if (current?.id !== id) return;
  offer = { ...current, ...changes };
}

function arm(target: UndoOffer): void {
  stopTimer();
  timer = setTimeout(
    () => {
      timer = undefined;
      // A running Undo owns its offer until it settles; `keep` drops one
      // whose deadline passed in flight.
      if (offer?.id === target.id && !offer.running) offer = null;
    },
    Math.max(0, target.deadline - Date.now()),
  );
}

/**
 * Replace the current offer, unless an Undo for it is running.
 *
 * The lifetime counts from `respondedAt`, when the response arrived, not from
 * this call: the caller offers only after its reload has rendered, and that
 * reload can wait out a navigation or an unreachable server. Counted from
 * here, a restore's offer could outlive the server's window and a late press
 * would be refused as "too late". `arm` clamps a deadline already past to 0.
 */
export function offerUndo(input: UndoOfferInput): void {
  if (!browser || offer?.running) return;
  const lifetime =
    input.kind === "restore"
      ? (input.expiresInMs ?? DOSE_UNDO_WINDOW_MS) - RESTORE_DEADLINE_MARGIN_MS
      : DOSE_UNDO_WINDOW_MS;
  const next: UndoOffer = {
    ...input,
    id: crypto.randomUUID(),
    deadline: (input.respondedAt ?? Date.now()) + lifetime,
    running: false,
    note: null,
  };
  offer = next;
  arm(next);
}

/** The current offer. Reactive: read it in a component and it re-renders. */
export function currentUndo(): UndoOffer | null {
  return offer;
}

/** A successful dose write clears whatever offer is left. Never a running one. */
export function clearUndo(): void {
  if (!browser || !offer || offer.running) return;
  drop(offer.id);
}

/**
 * A write about to be SENT for this dose withdraws its offer: an Undo of a
 * dose that is being deleted or edited would reverse the wrong thing.
 */
export function withdrawUndoFor(doseId: string): void {
  if (!browser || !offer || offer.running || offer.doseId !== doseId) return;
  drop(offer.id);
}

/** The offer's Dismiss button. */
export function dismissUndo(): void {
  clearUndo();
}

/** Toast calls this when focus enters its stack from outside. */
export function rememberFocusBeforeStack(el: HTMLElement | null): void {
  if (!browser) return;
  focusBeforeStack = el;
}

/**
 * Everything, running or not. The (app) layout calls this when it unmounts:
 * signing out leaves (app), and on a shared device the next person to sign in
 * must never see, or press, the last person's "Dose removed: <medication>".
 */
export function resetUndoRegistry(): void {
  if (!browser) return;
  stopTimer();
  offer = null;
  focusBeforeStack = null;
}

async function post(target: UndoOffer): Promise<ActionResult> {
  const body = new FormData();
  body.set("doseId", target.doseId);
  if (target.kind === "delete") body.set("forUndo", "1");
  else body.set("deletedAt", target.deletedAt ?? "");
  // Absolute actions: the offer outlives the page, so a relative `?/…`
  // would post to whichever page the user has moved to.
  const response = await fetch(target.kind === "delete" ? DELETE_ACTION : RESTORE_ACTION, {
    method: "POST",
    body,
    headers: { accept: "application/json" },
  });
  const result = deserialize(await response.text()) as ActionResult;
  // As enhance does: an error result carries its HTTP status, which is how a
  // retryable 5xx is told apart from a 401.
  if (result.type === "error") result.status = response.status;
  return result;
}

/**
 * Keep the offer for another press, unless its deadline passed while the
 * request was in flight: the deadline timer skips a running offer, so this is
 * where such an offer goes, and its note becomes a plain toast instead.
 */
function keep(target: UndoOffer, note: string): UndoOutcome {
  if (Date.now() < target.deadline) return { kind: "kept", note };
  drop(target.id);
  return { kind: "settled", message: note, type: "error" };
}

/**
 * Carry out a press of the current offer's Undo, holding `lock` — the
 * layout's — for the request and the reload.
 *
 * "refused": no offer, one already running, or another dose write in flight
 * (the caller says "Still saving…"). "kept": the offer stays, with a note
 * saying why (offline, lost request, a 5xx). "settled": the offer is gone,
 * and the caller shows `message` as a plain toast.
 *
 * Focus moves (only if it was lost) AFTER the reload has rendered the page
 * and BEFORE the offer is removed: until then the pressed button is still
 * mounted, so focus never falls to <body> in between, and the restored row's
 * control exists to receive it.
 */
export async function runUndo(lock: DoseWriteLock): Promise<UndoOutcome> {
  const target = offer;
  if (!browser || !target || target.running) return { kind: "refused" };
  if (lock.active) return { kind: "refused" };
  if (navigator.onLine === false) {
    patch(target.id, { note: UNDO_OFFLINE_MESSAGE });
    return { kind: "kept", note: UNDO_OFFLINE_MESSAGE };
  }

  // hold(), not acquire(): the write being undone may still be cooling down,
  // and an Undo must not be refused by that. extend() then starts a fresh
  // cooldown from this Undo's own reload.
  lock.hold();
  patch(target.id, { running: true, note: null });
  try {
    let result: ActionResult;
    try {
      result = await post(target);
    } catch {
      // The request never completed: it may or may not have landed. Say so
      // at once, but keep the button busy until the server answers and the
      // page has reloaded, so a retry acts on data somebody has checked.
      patch(target.id, { note: UNDO_NETWORK_MESSAGE });
      await reloadAfterWrite({ waitForServer: true });
      patch(target.id, { running: false });
      return keep(target, UNDO_NETWORK_MESSAGE);
    }

    await reloadAfterWrite();
    await tick();

    if (result.type === "error" && (result.status ?? 0) >= 500) {
      // Nothing happened on the server that can be relied on; the offer
      // stays, and focus stays on it.
      const note = actionErrorMessage(result);
      patch(target.id, { running: false, note });
      return keep(target, note);
    }

    focusIfLost(
      target.focusTarget,
      () => focusBeforeStack,
      () => document.querySelector<HTMLElement>("h1"),
    );
    drop(target.id);
    if (result.type === "success") {
      return {
        kind: "settled",
        message: target.kind === "delete" ? UNDONE_TOAST : RESTORED_TOAST,
        type: "success",
      };
    }
    // 410 too late, 409 logged since, 404 not found, a 401: the server's words.
    return { kind: "settled", message: actionErrorMessage(result), type: "error" };
  } finally {
    if (offer?.id === target.id && offer.running) patch(target.id, { running: false });
    lock.extend();
  }
}
