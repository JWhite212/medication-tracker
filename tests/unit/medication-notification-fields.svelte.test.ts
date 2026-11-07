// MedicationNotificationFields mounted for real (jsdom, client svelte), read
// back through the FormData its enclosing form would post. That is the only
// observation that matters: the server writes all three timing columns on
// every save, and a key missing from FormData is replaced by the schema's
// default (offset 0, no repeat, 3 repeats) with nothing shown to the user.
//
// Two defects are pinned here:
//   - a stored timing outside the short option lists (legal at every door:
//     /api/v1, import, the Mac app) left the select with nothing selected, so
//     it dropped out of FormData and the next save silently reset it;
//   - unticking "Notify me" unmounted the selects, and the hidden inputs and
//     the remounted selects both fell back to the props, discarding choices
//     made in this visit.
import { describe, it, expect, afterEach } from "vitest";
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import MedicationNotificationFields from "$lib/components/medication-form/MedicationNotificationFields.svelte";

type Props = ComponentProps<typeof MedicationNotificationFields>;

const BASE: Props = {
  notificationsEnabled: true,
  overdueEmail: "inherit",
  overduePush: "inherit",
  lowInventoryEmail: "inherit",
  lowInventoryPush: "inherit",
  offsetMinutes: "0",
  repeatEveryMinutes: "",
  maxRepeats: "3",
  errors: {},
};

let app: ReturnType<typeof mount> | undefined;
let form: HTMLFormElement;

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = "";
});

function render(overrides: Partial<Props> = {}) {
  form = document.createElement("form");
  document.body.appendChild(form);
  app = mount(MedicationNotificationFields, { target: form, props: { ...BASE, ...overrides } });
  flushSync();
}

/** What the form posts, with the same last-value-wins rule the action uses. */
const posted = () => Object.fromEntries(new FormData(form)) as Record<string, string>;

const select = (name: string) => form.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
const toggle = () => form.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

function choose(name: string, value: string) {
  const el = select(name);
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
  flushSync();
}

function clickToggle() {
  toggle().click();
  flushSync();
}

describe("MedicationNotificationFields: stored timing outside the option lists", () => {
  const STORED = { offsetMinutes: "120", repeatEveryMinutes: "240", maxRepeats: "10" };

  it("posts the stored values back unchanged", () => {
    render(STORED);
    expect(posted()).toMatchObject({
      notifyOffsetMinutes: "120",
      notifyRepeatEveryMinutes: "240",
      notifyMaxRepeats: "10",
    });
  });

  it("shows each stored value as a selected custom option", () => {
    render({ offsetMinutes: "45", repeatEveryMinutes: "90", maxRepeats: "10" });
    const shown = (name: string) => select(name).selectedOptions[0]?.textContent?.trim();
    expect(shown("notifyOffsetMinutes")).toBe("45 minutes (custom)");
    expect(shown("notifyRepeatEveryMinutes")).toBe("Every 90 minutes (custom)");
    expect(shown("notifyMaxRepeats")).toBe("10 more reminders (custom)");
  });

  it("keeps the custom option offered after the user picks a listed one", () => {
    render(STORED);
    choose("notifyOffsetMinutes", "30");
    expect(posted().notifyOffsetMinutes).toBe("30");
    choose("notifyOffsetMinutes", "120");
    expect(posted().notifyOffsetMinutes).toBe("120");
  });

  it("adds nothing when the stored value is already listed", () => {
    render();
    expect([...select("notifyOffsetMinutes").options].map((o) => o.value)).toEqual([
      "0",
      "30",
      "60",
    ]);
    expect([...select("notifyRepeatEveryMinutes").options].map((o) => o.value)).toEqual([
      "",
      "30",
      "60",
      "120",
    ]);
    expect([...select("notifyMaxRepeats").options].map((o) => o.value)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "5",
    ]);
  });

  it("posts them unchanged while notifications are off, too", () => {
    render({ ...STORED, notificationsEnabled: false });
    expect(posted()).toMatchObject({
      notificationsEnabled: "off",
      notifyOffsetMinutes: "120",
      notifyRepeatEveryMinutes: "240",
      notifyMaxRepeats: "10",
    });
  });
});

describe("MedicationNotificationFields: choices survive unticking Notify me", () => {
  function editEverything() {
    choose("notifyOverduePush", "off");
    choose("notifyLowInventoryEmail", "on");
    choose("notifyOffsetMinutes", "60");
    choose("notifyRepeatEveryMinutes", "30");
    choose("notifyMaxRepeats", "5");
  }
  const EDITED = {
    notifyOverdueEmail: "inherit",
    notifyOverduePush: "off",
    notifyLowInventoryEmail: "on",
    notifyLowInventoryPush: "inherit",
    notifyOffsetMinutes: "60",
    notifyRepeatEveryMinutes: "30",
    notifyMaxRepeats: "5",
  };

  it("posts this visit's choices, not the loaded ones, once unticked", () => {
    render();
    editEverything();
    clickToggle();
    expect(select("notifyOverduePush")).toBeNull();
    expect(posted()).toEqual({ notificationsEnabled: "off", ...EDITED });
  });

  it("shows this visit's choices again when re-ticked", () => {
    render();
    editEverything();
    clickToggle();
    clickToggle();
    for (const [name, value] of Object.entries(EDITED)) {
      expect(select(name).value, name).toBe(value);
    }
    expect(posted()).toEqual({ notificationsEnabled: "on", ...EDITED });
  });
});
