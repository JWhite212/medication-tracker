// createLayoutDraft — the edit mode's draft of the six dashboard layout
// preferences, and the writer that saves each change as it is made (spec §5c,
// §5e). Driven with a stubbed `post` whose results the test resolves by hand,
// so "in flight" is a state the test holds rather than a race it hopes for.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ActionResult } from "@sveltejs/kit";

const h = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("$app/forms", () => ({ deserialize: (text: string) => JSON.parse(text) }));
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));

import {
  createLayoutDraft,
  OFFLINE_LAYOUT_TOAST,
  type LayoutValues,
} from "$lib/components/dashboard/dashboard-editor.svelte";
import { DEFAULT_ORDER, normaliseSectionOrder, orderValue } from "$lib/dashboard/layout";
import { PREFERENCE_KEY_OF, PRESETS, type PresetId } from "$lib/dashboard/presets";

type Call = {
  action: string;
  fields: Record<string, string>;
  resolve: (result: ActionResult) => void;
};

const SUCCESS: ActionResult = { type: "success", status: 200, data: { success: true } };

function stubPost() {
  const calls: Call[] = [];
  const post = vi.fn(
    (action: string, body: FormData) =>
      new Promise<ActionResult>((resolve) => {
        calls.push({
          action,
          fields: Object.fromEntries([...body.entries()].map(([k, v]) => [k, String(v)])),
          resolve,
        });
      }),
  );
  return { calls, post };
}

/** Lets a resolved post's continuation (and the pump after it) run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const DEFAULTS: LayoutValues = {
  order: [...DEFAULT_ORDER.scheduled],
  showLater: true,
  showQuickLog: true,
  showRefills: true,
  laterMode: "next",
  doneTime: "both",
};

/** A preset's patch read through the short names, with its order normalised as the draft holds it. */
function presetValues(id: PresetId): LayoutValues {
  const patch = PRESETS[id].patch;
  return {
    order: normaliseSectionOrder(patch[PREFERENCE_KEY_OF.order], "scheduled"),
    showLater: patch[PREFERENCE_KEY_OF.showLater],
    showQuickLog: patch[PREFERENCE_KEY_OF.showQuickLog],
    showRefills: patch[PREFERENCE_KEY_OF.showRefills],
    laterMode: patch[PREFERENCE_KEY_OF.laterMode] as LayoutValues["laterMode"],
    doneTime: patch[PREFERENCE_KEY_OF.doneTime] as LayoutValues["doneTime"],
  };
}

const plain = (values: LayoutValues) => ({ ...values, order: [...values.order] });

beforeEach(() => {
  h.showToast.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createLayoutDraft: the draft", () => {
  it("normalises a stored order against the scheduled defaults", () => {
    const draft = createLayoutDraft({
      ...DEFAULTS,
      order: null as unknown as LayoutValues["order"],
    });
    expect([...draft.values.order]).toEqual([...DEFAULT_ORDER.scheduled]);
    expect(draft.pending()).toBe(false);
  });
});

describe("createLayoutDraft: what each change posts", () => {
  it("move posts dashboardSectionOrder with orderValue(...) and updates the draft at once", () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.move("later", "up", "scheduled");

    const expected = ["later", "done", "quickLog", "refills"] as const;
    expect([...draft.values.order]).toEqual(expected);
    expect(calls).toHaveLength(1);
    expect(calls[0].action).toBe("/settings/dashboard?/dashboardSectionOrder");
    expect(calls[0].fields).toEqual({ dashboardSectionOrder: orderValue(expected) });
    expect(draft.pending()).toBe(true);
  });

  it("on an as-needed-only account the posted order keeps the stored places of later and quickLog", () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(
      { ...DEFAULTS, order: ["quickLog", "refills", "later", "done"] },
      { post, online: () => true },
    );

    // The account sees refills, done; moving done up swaps only those two.
    draft.move("done", "up", "as-needed-only");

    expect(calls[0].fields).toEqual({ dashboardSectionOrder: "quickLog,done,later,refills" });
    expect([...draft.values.order]).toEqual(["quickLog", "done", "later", "refills"]);
  });

  it("a move at an end changes nothing and posts nothing", () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });
    draft.move("done", "up", "scheduled");
    expect(calls).toHaveLength(0);
    expect(draft.pending()).toBe(false);
  });

  it('setShown("later", false) posts dashboardShowLater with off', () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.setShown("later", false);

    expect(draft.values.showLater).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].action).toBe("/settings/dashboard?/dashboardShowLater");
    expect(calls[0].fields).toEqual({ dashboardShowLater: "off" });
  });

  it('setShown("refills", true) posts dashboardShowRefills with on', () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(
      { ...DEFAULTS, showRefills: false },
      { post, online: () => true },
    );

    draft.setShown("refills", true);

    expect(calls[0].action).toBe("/settings/dashboard?/dashboardShowRefills");
    expect(calls[0].fields).toEqual({ dashboardShowRefills: "on" });
  });

  it('applyPreset("focused") posts preset=focused, and the draft equals Focused\'s patch at once', () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(
      { ...DEFAULTS, order: ["refills", "done", "later", "quickLog"], showRefills: false },
      { post, online: () => true },
    );

    draft.applyPreset("focused");

    expect(plain(draft.values)).toEqual(presetValues("focused"));
    expect(calls).toHaveLength(1);
    expect(calls[0].action).toBe("/settings/dashboard?/applyPreset");
    expect(calls[0].fields).toEqual({ preset: "focused" });
  });
});

describe("createLayoutDraft: per key, last write wins", () => {
  it("three quick moves while the first is in flight send exactly two posts, the first and the latest", async () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.move("refills", "up", "scheduled"); // done, later, refills, quickLog
    draft.move("refills", "up", "scheduled"); // done, refills, later, quickLog
    draft.move("refills", "up", "scheduled"); // refills, done, later, quickLog

    expect(calls).toHaveLength(1);
    expect(calls[0].fields.dashboardSectionOrder).toBe("done,later,refills,quickLog");

    calls[0].resolve(SUCCESS);
    await settle();

    expect(calls).toHaveLength(2);
    expect(calls[1].fields.dashboardSectionOrder).toBe("refills,done,later,quickLog");
    expect(draft.pending()).toBe(true);

    calls[1].resolve(SUCCESS);
    await settle();

    expect(calls).toHaveLength(2);
    expect(draft.pending()).toBe(false);
    expect([...draft.values.order]).toEqual(["refills", "done", "later", "quickLog"]);
  });

  it("different keys are not serialised behind each other", () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.move("later", "up", "scheduled");
    draft.setShown("quickLog", false);

    expect(calls.map((c) => c.action)).toEqual([
      "/settings/dashboard?/dashboardSectionOrder",
      "/settings/dashboard?/dashboardShowQuickLog",
    ]);
  });
});

describe("createLayoutDraft: failures revert", () => {
  it("a failure reverts the key to the last server value and toasts actionErrorMessage(result)", async () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.move("later", "up", "scheduled");
    calls[0].resolve({ type: "failure", status: 400, data: { error: "That order isn't valid." } });
    await settle();

    expect([...draft.values.order]).toEqual([...DEFAULT_ORDER.scheduled]);
    expect(h.showToast).toHaveBeenCalledWith("That order isn't valid.", "error");
    expect(draft.pending()).toBe(false);
  });

  it("a 429 reverts and toasts like any failure", async () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.setShown("refills", false);
    calls[0].resolve({
      type: "failure",
      status: 429,
      data: {
        key: "dashboardShowRefills",
        saveError: "Too many changes. Try again in 12 seconds.",
      },
    });
    await settle();

    expect(draft.values.showRefills).toBe(true);
    expect(h.showToast).toHaveBeenCalledWith("Too many changes. Try again in 12 seconds.", "error");
  });

  it("the revert goes to the last value the server confirmed, not the original", async () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.move("later", "up", "scheduled"); // later, done, quickLog, refills
    calls[0].resolve(SUCCESS);
    await settle();
    draft.move("refills", "up", "scheduled"); // later, done, refills, quickLog
    calls[1].resolve({ type: "failure", status: 400 });
    await settle();

    expect([...draft.values.order]).toEqual(["later", "done", "quickLog", "refills"]);
    expect(h.showToast).toHaveBeenCalledWith("Something went wrong — please try again.", "error");
  });

  it("a preset that fails reverts all six keys", async () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.applyPreset("justLog");
    calls[0].resolve({ type: "failure", status: 400 });
    await settle();

    expect(plain(draft.values)).toEqual(DEFAULTS);
    expect(h.showToast).toHaveBeenCalledTimes(1);
  });
});

describe("createLayoutDraft: offline", () => {
  it("sends nothing, reverts, and toasts exactly the offline words", () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => false });

    draft.move("later", "up", "scheduled");
    draft.setShown("later", false);
    draft.applyPreset("fullDay");

    expect(calls).toHaveLength(0);
    expect(plain(draft.values)).toEqual(DEFAULTS);
    expect(OFFLINE_LAYOUT_TOAST).toBe("You're offline — that change wasn't saved.");
    expect(h.showToast).toHaveBeenCalledWith("You're offline — that change wasn't saved.", "error");
    expect(draft.pending()).toBe(false);
  });

  it("a queued write that comes due while offline is not sent, and reverts", async () => {
    let online = true;
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => online });

    draft.move("refills", "up", "scheduled");
    draft.move("refills", "up", "scheduled");
    online = false;
    calls[0].resolve(SUCCESS);
    await settle();

    expect(calls).toHaveLength(1);
    expect([...draft.values.order]).toEqual(["done", "later", "refills", "quickLog"]);
    expect(h.showToast).toHaveBeenCalledWith(OFFLINE_LAYOUT_TOAST, "error");
    expect(draft.pending()).toBe(false);
  });
});

describe("createLayoutDraft: offline when several queued keys come due", () => {
  it("refuses each key once, however the refusals re-enter the queue", async () => {
    let online = true;
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => online });

    draft.applyPreset("focused");
    draft.setShown("quickLog", false);
    draft.setShown("refills", false);
    online = false;
    calls[0].resolve(SUCCESS);
    await settle();

    expect(calls).toHaveLength(1);
    expect(h.showToast).toHaveBeenCalledTimes(2);
    expect(plain(draft.values)).toEqual(presetValues("focused"));
    expect(draft.pending()).toBe(false);
  });
});

describe("createLayoutDraft: sync from a new payload", () => {
  it("keeps an in-flight key and updates an idle one", async () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.move("later", "up", "scheduled");
    // The dashboard clock's invalidateAll lands mid-write: the payload still
    // has the old order, and another device has hidden Refills.
    draft.sync({ ...DEFAULTS, showRefills: false });

    expect([...draft.values.order]).toEqual(["later", "done", "quickLog", "refills"]);
    expect(draft.values.showRefills).toBe(false);

    calls[0].resolve(SUCCESS);
    await settle();
    // Idle again: the next payload is the truth for this key too.
    draft.sync({ ...DEFAULTS, order: ["refills", "done", "later", "quickLog"] });
    expect([...draft.values.order]).toEqual(["refills", "done", "later", "quickLog"]);
  });

  it("an invalidate while a key is in flight keeps that key and stays editing (a queued value too)", async () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.move("refills", "up", "scheduled");
    draft.move("refills", "up", "scheduled"); // queued
    draft.sync(DEFAULTS);
    expect([...draft.values.order]).toEqual(["done", "refills", "later", "quickLog"]);

    calls[0].resolve(SUCCESS);
    await settle();
    draft.sync({ ...DEFAULTS, order: ["done", "later", "refills", "quickLog"] }); // the first write's echo
    expect([...draft.values.order]).toEqual(["done", "refills", "later", "quickLog"]);
    expect(calls[1].fields.dashboardSectionOrder).toBe("done,refills,later,quickLog");
  });

  it("a failure after a sync reverts to the synced server value", async () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.move("later", "up", "scheduled");
    draft.sync({ ...DEFAULTS, order: ["quickLog", "done", "later", "refills"] });
    calls[0].resolve({ type: "failure", status: 400 });
    await settle();

    expect([...draft.values.order]).toEqual(["quickLog", "done", "later", "refills"]);
  });
});

describe("createLayoutDraft: presets and keys queue behind each other", () => {
  it("a preset queued behind an in-flight key ends on the preset", async () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.move("later", "up", "scheduled");
    draft.applyPreset("standard");

    expect(plain(draft.values)).toEqual(presetValues("standard"));
    expect(calls).toHaveLength(1); // the preset waits for the order write

    calls[0].resolve(SUCCESS);
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1].fields).toEqual({ preset: "standard" });
    // A payload landing before the preset settles cannot undo it.
    draft.sync({ ...DEFAULTS, order: ["later", "done", "quickLog", "refills"] });
    expect(plain(draft.values)).toEqual(presetValues("standard"));

    calls[1].resolve(SUCCESS);
    await settle();
    expect(calls).toHaveLength(2);
    expect(plain(draft.values)).toEqual(presetValues("standard"));
    expect(draft.pending()).toBe(false);
  });

  it("the queued key write the preset supersedes is never sent", async () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.move("refills", "up", "scheduled");
    draft.move("refills", "up", "scheduled"); // queued
    draft.applyPreset("focused");
    calls[0].resolve(SUCCESS);
    await settle();
    calls[1].resolve(SUCCESS);
    await settle();

    expect(calls.map((c) => c.fields)).toEqual([
      { dashboardSectionOrder: "done,later,refills,quickLog" },
      { preset: "focused" },
    ]);
    expect(plain(draft.values)).toEqual(presetValues("focused"));
  });

  it("a key write queued behind an in-flight preset ends on the key write", async () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.applyPreset("justLog"); // quickLog, done, refills, later; Later hidden
    draft.setShown("later", true);
    draft.move("later", "up", "scheduled"); // quickLog, done, later, refills

    expect(calls).toHaveLength(1);
    calls[0].resolve(SUCCESS);
    await settle();

    // Two independent keys, so the order between them does not matter.
    expect(calls).toHaveLength(3);
    expect(calls.slice(1).map((c) => c.fields)).toEqual(
      expect.arrayContaining([
        { dashboardSectionOrder: "quickLog,done,later,refills" },
        { dashboardShowLater: "on" },
      ]),
    );
    calls[1].resolve(SUCCESS);
    calls[2].resolve(SUCCESS);
    await settle();

    expect(plain(draft.values)).toEqual({
      ...presetValues("justLog"),
      order: ["quickLog", "done", "later", "refills"],
      showLater: true,
    });
    expect(draft.pending()).toBe(false);
  });

  it("a key write after a queued preset is sent after the preset, with the latest value", async () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.setShown("later", false);
    draft.applyPreset("standard"); // queued behind showLater
    draft.setShown("refills", false); // queued behind the preset
    expect(calls).toHaveLength(1);

    calls[0].resolve(SUCCESS);
    await settle();
    expect(calls[1].fields).toEqual({ preset: "standard" });
    expect(calls).toHaveLength(2);

    calls[1].resolve(SUCCESS);
    await settle();
    expect(calls[2].fields).toEqual({ dashboardShowRefills: "off" });
    calls[2].resolve(SUCCESS);
    await settle();

    expect(plain(draft.values)).toEqual({ ...presetValues("standard"), showRefills: false });
  });

  it("a failed write with a newer value queued for the same key keeps the newer value and sends it", async () => {
    const { calls, post } = stubPost();
    const draft = createLayoutDraft(DEFAULTS, { post, online: () => true });

    draft.move("later", "up", "scheduled");
    draft.applyPreset("justLog");
    calls[0].resolve({ type: "failure", status: 400 });
    await settle();

    expect(plain(draft.values)).toEqual(presetValues("justLog"));
    expect(calls[1].fields).toEqual({ preset: "justLog" });
    expect(h.showToast).toHaveBeenCalledTimes(1);
  });
});

describe("createLayoutDraft: the default post", () => {
  it("posts the action with SvelteKit's action headers and deserialises the answer", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(SUCCESS)));
    vi.stubGlobal("fetch", fetchMock);
    const draft = createLayoutDraft(DEFAULTS, { online: () => true });

    draft.setShown("quickLog", false);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/settings/dashboard?/dashboardShowQuickLog");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "x-sveltekit-action": "true", accept: "application/json" });
    expect((init.body as FormData).get("dashboardShowQuickLog")).toBe("off");
    expect(draft.values.showQuickLog).toBe(false);
    expect(draft.pending()).toBe(false);
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("a fetch that throws is a failure: it reverts and toasts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const draft = createLayoutDraft(DEFAULTS, { online: () => true });

    draft.setShown("quickLog", false);
    await settle();

    expect(draft.values.showQuickLog).toBe(true);
    expect(h.showToast).toHaveBeenCalledWith("Something went wrong — please try again.", "error");
    expect(draft.pending()).toBe(false);
  });
});
