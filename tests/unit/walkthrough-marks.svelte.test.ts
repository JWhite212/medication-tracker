// The suite's default jsdom environment: use:mark is an action, and actions run
// only in a mounted client component, once effects flush.
import { afterEach, describe, it, expect } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { MARKS_CONTEXT, PHONE_ROOT, createMarkRegistry } from "$lib/components/walkthrough/marks";
import { PHONE_BEFORE } from "$lib/components/walkthrough/demo-dashboard";
import { computeFrame } from "$lib/components/walkthrough/timeline";
import FieldBox from "$lib/components/walkthrough/parts/FieldBox.svelte";
import PhoneScene from "$lib/components/walkthrough/scenes/PhoneScene.svelte";

let target: HTMLElement | undefined;
let app: ReturnType<typeof mount> | undefined;

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target?.remove();
  target = undefined;
});

describe("MARKS_CONTEXT", () => {
  // Exported so a test can mount part of the stage with its own registry, as
  // this one does. FieldBox takes its key as a prop, so the test picks a key no
  // scene uses.
  it("is the context key use:mark registers under, and unmounting unregisters", () => {
    const registry = createMarkRegistry();
    target = document.body.appendChild(document.createElement("div"));
    app = mount(FieldBox, {
      target,
      props: { label: "Name", markKey: "probe.field" },
      context: new Map([[MARKS_CONTEXT, registry]]),
    });
    flushSync();
    expect([...registry.keys()]).toEqual(["probe.field"]);
    expect(target.contains(registry.get("probe.field") ?? null)).toBe(true);

    unmount(app);
    app = undefined;
    expect(registry.size).toBe(0);
  });
});

describe("the phone's marks", () => {
  // timeline.ts puts the fingertip at the centre of p.vitdLog's rect, so the
  // key must sit on the button the tap presses: the overdue card's 48px
  // Log now, never the card, its row or another button. A shared part takes
  // its keys as props, so the phone registers nothing else but its root.
  it("marks the overdue card's Log now as p.vitdLog, and nothing else but the phone root", () => {
    const registry = createMarkRegistry();
    target = document.body.appendChild(document.createElement("div"));
    app = mount(PhoneScene, {
      target,
      props: { state: computeFrame(0, {}).phone, timeFormat: "24h" },
      context: new Map([[MARKS_CONTEXT, registry]]),
    });
    flushSync();
    expect([...registry.keys()].sort()).toEqual([PHONE_ROOT, "p.vitdLog"].sort());

    const logNow = registry.get("p.vitdLog")!;
    expect(registry.get(PHONE_ROOT)!.contains(logNow)).toBe(true);
    // The button itself: it reads exactly "Log now" once DoseActionForm's
    // invisible "Logging…" layer is left out.
    const shown = logNow.cloneNode(true) as HTMLElement;
    for (const layer of [...shown.querySelectorAll(".invisible")]) layer.remove();
    expect(shown.textContent?.replace(/\s+/g, " ").trim()).toBe("Log now");
    // On the card of the medication the phone shows as overdue.
    const [card] = PHONE_BEFORE.today;
    expect(logNow.closest(".rounded-xl")?.textContent ?? "").toContain(card.name);
  });
});
