/**
 * The dashboard edit mode's draft of the six layout preferences, and the
 * writer that saves each change as it is made (spec §5c, §5e).
 *
 * Every change updates the draft synchronously and then POSTs the EXISTING
 * `/settings/dashboard` field action with the body the settings page sends,
 * so there is no new write path and no Save button: everything is saved
 * already, and reversible.
 *
 * This module never names a preference key. It speaks the six short names and
 * reaches each key through `PREFERENCE_KEY_OF`, so the dashboard page stays
 * the only reader of the stored values on the dashboard and the owner scans
 * need no exemption for it.
 *
 * Writes are serialised per key, last write wins: while a key is in flight a
 * newer value is queued, and only the latest is sent, read from the draft at
 * send time. A preset is in flight for all six keys. A preset waits for every
 * key in flight, supersedes whatever was queued before it, and any key edited
 * after it waits for it, so the server always ends on the LAST thing the user
 * did. A new payload re-syncs the draft except for keys with a write in
 * flight or queued: without that, the dashboard clock's refresh landing
 * mid-edit would snap a just-moved section back. A key just saved is guarded
 * one step further: a payload that was already on its way before the write
 * committed still carries the old value, so after a success the draft
 * remembers what it confirmed, ignores ONE payload that disagrees with it,
 * and accepts the next (or stops guarding as soon as a payload agrees).
 *
 * Not a dose write: no dose-write lock is taken, and the page content is inert
 * while editing.
 */
import type { ActionResult } from "@sveltejs/kit";
import { SvelteSet } from "svelte/reactivity";
import { deserialize } from "$app/forms";
import { showToast } from "$components/ui/Toast.svelte";
import {
  mergeVisibleOrder,
  moveSection,
  normaliseOption,
  normaliseSectionOrder,
  orderValue,
  type DashboardSectionId,
  type DashboardVariant,
  type HIDEABLE_SECTIONS,
} from "$lib/dashboard/layout";
import {
  activePreset,
  PREFERENCE_KEY_OF,
  PRESETS,
  type PresetId,
  type PresetPatch,
} from "$lib/dashboard/presets";
import {
  DASHBOARD_LATER_MODES,
  DONE_TIME_DISPLAYS,
  type DashboardLaterMode,
  type DoneTimeDisplay,
} from "$lib/preferences/domains";
import { actionErrorMessage } from "$lib/utils/form-errors";

/**
 * Refused before anything is sent, because the device is offline. Its own
 * words: the dose-write offline toast belongs to `beginDoseWrite` alone.
 */
export const OFFLINE_LAYOUT_TOAST = "You're offline — that change wasn't saved.";

/** Absolute: the editor lives on the dashboard, and the actions on the settings page. */
const SETTINGS_ACTIONS = "/settings/dashboard";

export type LayoutValues = {
  /** Normalised against the scheduled defaults, so every stored place survives. */
  order: DashboardSectionId[];
  showLater: boolean;
  showQuickLog: boolean;
  showRefills: boolean;
  laterMode: DashboardLaterMode;
  doneTime: DoneTimeDisplay;
};

/** What a payload carries: the order may be null or a stored subset, and the options are read tolerantly. */
export type StoredLayout = Omit<LayoutValues, "order" | "laterMode" | "doneTime"> & {
  order: unknown;
  laterMode: unknown;
  doneTime: unknown;
};

export type LayoutKey = keyof typeof PREFERENCE_KEY_OF;

type HideableSection = (typeof HIDEABLE_SECTIONS)[number];

export type LayoutDraftDeps = {
  post?: (action: string, body: FormData) => Promise<ActionResult>;
  online?: () => boolean;
};

export type LayoutDraft = {
  readonly values: LayoutValues;
  move(id: DashboardSectionId, direction: "up" | "down", variant: DashboardVariant): void;
  setShown(id: HideableSection, value: boolean): void;
  applyPreset(id: PresetId): void;
  sync(stored: StoredLayout): void;
  pending(): boolean;
};

const LAYOUT_KEYS = Object.keys(PREFERENCE_KEY_OF) as LayoutKey[];

const SHOWN_KEY = {
  later: "showLater",
  quickLog: "showQuickLog",
  refills: "showRefills",
} as const satisfies Record<HideableSection, LayoutKey>;

function normalise(stored: StoredLayout): LayoutValues {
  return {
    order: normaliseSectionOrder(stored.order, "scheduled"),
    showLater: stored.showLater,
    showQuickLog: stored.showQuickLog,
    showRefills: stored.showRefills,
    laterMode: normaliseOption(stored.laterMode, DASHBOARD_LATER_MODES, "next"),
    doneTime: normaliseOption(stored.doneTime, DONE_TIME_DISPLAYS, "both"),
  };
}

function fromPatch(patch: PresetPatch): LayoutValues {
  return normalise({
    order: patch[PREFERENCE_KEY_OF.order],
    showLater: patch[PREFERENCE_KEY_OF.showLater],
    showQuickLog: patch[PREFERENCE_KEY_OF.showQuickLog],
    showRefills: patch[PREFERENCE_KEY_OF.showRefills],
    laterMode: patch[PREFERENCE_KEY_OF.laterMode],
    doneTime: patch[PREFERENCE_KEY_OF.doneTime],
  });
}

/**
 * The preset the draft matches, else null ("Custom"), by `activePreset`'s
 * rule. Keyed through `PREFERENCE_KEY_OF`, so the dashboard page asks this
 * rather than naming the preference keys a second time.
 */
export function draftPreset(values: LayoutValues): PresetId | null {
  return activePreset({
    [PREFERENCE_KEY_OF.order]: values.order,
    [PREFERENCE_KEY_OF.showLater]: values.showLater,
    [PREFERENCE_KEY_OF.showQuickLog]: values.showQuickLog,
    [PREFERENCE_KEY_OF.showRefills]: values.showRefills,
    [PREFERENCE_KEY_OF.laterMode]: values.laterMode,
    [PREFERENCE_KEY_OF.doneTime]: values.doneTime,
  });
}

/** A plain copy: the draft is a `$state` proxy, and what is sent or confirmed must not alias it. */
function copy(values: LayoutValues): LayoutValues {
  return { ...values, order: [...values.order] };
}

/** The field's value as the settings page's form posts it. */
function encode(key: LayoutKey, values: LayoutValues): string {
  const value = values[key];
  if (key === "order") return orderValue(values.order);
  if (typeof value === "boolean") return value ? "on" : "off";
  return String(value);
}

/** `fetch` plus `deserialize`, as `use:enhance` would, without a form. */
async function submitPreference(action: string, body: FormData): Promise<ActionResult> {
  const response = await fetch(action, {
    method: "POST",
    body,
    headers: { "x-sveltekit-action": "true", accept: "application/json" },
  });
  const result = deserialize(await response.text()) as ActionResult;
  if (result.type === "error") result.status = response.status;
  return result;
}

function browserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function createLayoutDraft(initial: StoredLayout, deps: LayoutDraftDeps = {}): LayoutDraft {
  const post = deps.post ?? submitPreference;
  const online = deps.online ?? browserOnline;

  const values = $state<LayoutValues>(normalise(initial));
  /** The last value the server confirmed, or a payload delivered. A failure reverts to this. */
  let server = copy(values);
  /** Keys a request in flight covers. */
  const inFlight = new SvelteSet<LayoutKey>();
  /** Keys whose draft value still has to be sent, after whatever covers them now. */
  const queued = new SvelteSet<LayoutKey>();
  /** A preset waiting for the keys in flight. While set, every queued key was edited after it. */
  let queuedPreset = $state<PresetId | null>(null);
  /**
   * What a successful write confirmed, per key, as the field's encoded value,
   * until a payload agrees with it or one payload disagreeing has been
   * ignored. Not reactive: only `sync` reads it.
   */
  const confirmed = new Map<LayoutKey, string>();

  function setValue<K extends LayoutKey>(key: K, value: LayoutValues[K]) {
    values[key] = (Array.isArray(value) ? [...value] : value) as LayoutValues[K];
  }

  /** Whether a write the user made later than the one settling still covers this key. */
  function supersededLater(key: LayoutKey): boolean {
    return queuedPreset !== null || queued.has(key);
  }

  function settle(keys: LayoutKey[], sent: LayoutValues, result: ActionResult | string) {
    for (const key of keys) inFlight.delete(key);
    if (typeof result !== "string" && result.type === "success") {
      for (const key of keys) {
        setServer(key, sent[key]);
        confirmed.set(key, encode(key, sent));
      }
    } else {
      // A newer value for the key is queued: it carries the user's latest
      // intent and goes next, so it is left on screen rather than reverted.
      for (const key of keys) if (!supersededLater(key)) setValue(key, server[key]);
      showToast(typeof result === "string" ? result : actionErrorMessage(result), "error");
    }
    pump();
  }

  function setServer<K extends LayoutKey>(key: K, value: LayoutValues[K]) {
    server = { ...server, [key]: Array.isArray(value) ? [...value] : value };
  }

  function send(keys: LayoutKey[], action: string, body: FormData, sent: LayoutValues) {
    for (const key of keys) {
      inFlight.add(key);
      // A newer write is under way: its own success re-arms the guard, and
      // until it settles the key is in flight, which `sync` respects anyway.
      confirmed.delete(key);
    }
    if (!online()) {
      settle(keys, sent, OFFLINE_LAYOUT_TOAST);
      return;
    }
    post(action, body).then(
      (result) => settle(keys, sent, result),
      (error: unknown) => settle(keys, sent, { type: "error", error }),
    );
  }

  function sendKey(key: LayoutKey) {
    const sent = copy(values);
    const body = new FormData();
    body.set(PREFERENCE_KEY_OF[key], encode(key, sent));
    send([key], `${SETTINGS_ACTIONS}?/${PREFERENCE_KEY_OF[key]}`, body, sent);
  }

  function sendPreset(id: PresetId) {
    const body = new FormData();
    body.set("preset", id);
    send(LAYOUT_KEYS, `${SETTINGS_ACTIONS}?/applyPreset`, body, fromPatch(PRESETS[id].patch));
  }

  /** Sends whatever may go now: a preset once nothing is in flight; otherwise each idle queued key. */
  function pump() {
    if (queuedPreset !== null) {
      if (inFlight.size > 0) return;
      const id = queuedPreset;
      queuedPreset = null;
      sendPreset(id);
      return;
    }
    for (const key of [...queued]) {
      // A refusal settles synchronously and pumps again, so a key in this
      // snapshot may already have been sent by that inner pass.
      if (!queued.has(key) || inFlight.has(key)) continue;
      queued.delete(key);
      sendKey(key);
    }
  }

  function edit(key: LayoutKey, apply: () => void) {
    if (!online()) {
      showToast(OFFLINE_LAYOUT_TOAST, "error");
      return;
    }
    apply();
    queued.add(key);
    pump();
  }

  return {
    get values() {
      return values;
    },

    move(id, direction, variant) {
      // Exactly the settings page's composition: reorder what the variant
      // shows, then write it back into the full order, so an as-needed-only
      // account keeps its stored places for Later and Quick log.
      const next = mergeVisibleOrder(
        moveSection(normaliseSectionOrder(values.order, variant), id, direction),
        normaliseSectionOrder(values.order, "scheduled"),
      );
      if (orderValue(next) === orderValue(values.order)) return;
      edit("order", () => setValue("order", next));
    },

    setShown(id, value) {
      const key = SHOWN_KEY[id];
      if (values[key] === value) return;
      edit(key, () => setValue(key, value));
    },

    applyPreset(id) {
      if (!online()) {
        showToast(OFFLINE_LAYOUT_TOAST, "error");
        return;
      }
      const patch = fromPatch(PRESETS[id].patch);
      for (const key of LAYOUT_KEYS) setValue(key, patch[key]);
      // The preset covers every key, so anything queued before it is moot.
      queued.clear();
      queuedPreset = id;
      pump();
    },

    sync(stored) {
      const next = normalise(stored);
      for (const key of LAYOUT_KEYS) {
        const saved = confirmed.get(key);
        if (saved !== undefined) {
          // Either way the guard is spent: an agreeing payload proves the
          // write is visible, and a disagreeing one is ignored only once, so
          // a genuine change from another device arrives on the next payload.
          confirmed.delete(key);
          if (encode(key, next) !== saved) continue; // stale: keep values and server
        }
        setServer(key, next[key]);
        if (inFlight.has(key) || supersededLater(key)) continue;
        setValue(key, next[key]);
      }
    },

    pending() {
      return inFlight.size > 0 || queued.size > 0 || queuedPreset !== null;
    },
  };
}
