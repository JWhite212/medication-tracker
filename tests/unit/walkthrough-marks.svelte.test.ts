// The suite's default jsdom environment: use:mark is an action, and actions run
// only in a mounted client component, once effects flush.
import { afterEach, describe, it, expect } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { MARKS_CONTEXT, createMarkRegistry } from "$lib/components/walkthrough/marks";
import FieldBox from "$lib/components/walkthrough/parts/FieldBox.svelte";

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
