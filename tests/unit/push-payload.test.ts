import { describe, it, expect } from "vitest";
import {
  TEST_PUSH_TAG,
  isTestTag,
  lowInventoryTag,
  overdueTag,
  safeNotificationUrl,
  toNotification,
} from "$lib/utils/push-payload";

// Every tag builder in the registry. Add new builders here — the
// collision tests below iterate this list, so a tag added without a
// thought for the existing namespaces fails immediately.
const BUILDERS: Array<[string, (medicationId: string) => string]> = [
  ["overdue", overdueTag],
  ["lowInventory", lowInventoryTag],
  ["test", () => TEST_PUSH_TAG],
];

describe("tag builders", () => {
  it("builds the overdue tag already deployed", () => {
    expect(overdueTag("med-A")).toBe("overdue-med-A");
  });

  it("builds the low-inventory tag already deployed", () => {
    expect(lowInventoryTag("med-LI")).toBe("low-inventory-med-LI");
  });

  it("exposes the test tag already deployed", () => {
    expect(TEST_PUSH_TAG).toBe("medtracker-test");
  });
});

describe("tag namespace disjointness", () => {
  // Tags are a replace-key: two notifications sharing one leave only the
  // last. A collision between namespaces would silently erase a real
  // reminder, so it is a correctness property, not tidiness.
  it("issues a distinct tag from every builder for the same medication", () => {
    const tags = BUILDERS.map(([, build]) => build("med-1"));
    expect(new Set(tags).size).toBe(BUILDERS.length);
  });

  it("cannot be made to collide by an id that mimics another namespace", () => {
    const hostile = ["low-inventory-med-1", "overdue-med-1", "medtracker-test", ""];
    for (const id of hostile) {
      expect(overdueTag(id)).not.toBe(lowInventoryTag(id));
      expect(overdueTag(id)).not.toBe(TEST_PUSH_TAG);
      expect(lowInventoryTag(id)).not.toBe(TEST_PUSH_TAG);
    }
  });
});

describe("isTestTag", () => {
  it("recognises the test tag", () => {
    expect(isTestTag(TEST_PUSH_TAG)).toBe(true);
  });

  it("rejects reminder tags", () => {
    expect(isTestTag(overdueTag("med-1"))).toBe(false);
    expect(isTestTag(lowInventoryTag("med-1"))).toBe(false);
  });

  it("rejects an absent tag", () => {
    expect(isTestTag(undefined)).toBe(false);
  });
});

describe("safeNotificationUrl", () => {
  it("admits a rooted same-origin path", () => {
    expect(safeNotificationUrl("/medications")).toBe("/medications");
  });

  it("rejects a protocol-relative path that would leave the app", () => {
    expect(safeNotificationUrl("//evil.example/x")).toBe("/dashboard");
  });

  it("rejects an absolute url", () => {
    expect(safeNotificationUrl("https://evil.example/x")).toBe("/dashboard");
  });

  it("rejects anything that is not a string", () => {
    expect(safeNotificationUrl(undefined)).toBe("/dashboard");
    expect(safeNotificationUrl(null)).toBe("/dashboard");
    expect(safeNotificationUrl(42)).toBe("/dashboard");
    expect(safeNotificationUrl({ url: "/x" })).toBe("/dashboard");
  });

  // The guard runs twice: once when the url is stored on the
  // notification, once when it is read back on click. Idempotence is
  // what makes the second run a no-op rather than a behaviour change.
  it("is idempotent", () => {
    for (const raw of ["/medications", "//evil.example", "https://evil.example", 42]) {
      expect(safeNotificationUrl(safeNotificationUrl(raw))).toBe(safeNotificationUrl(raw));
    }
  });
});

describe("toNotification", () => {
  it("passes a complete payload straight through", () => {
    const { title, options } = toNotification({
      title: "Ibuprofen overdue",
      body: "Last logged 3 hours ago",
      url: "/dashboard",
      tag: overdueTag("med-A"),
    });
    expect(title).toBe("Ibuprofen overdue");
    expect(options.body).toBe("Last logged 3 hours ago");
    expect(options.tag).toBe("overdue-med-A");
    expect(options.data).toEqual({ url: "/dashboard" });
  });

  it("keeps the icon and badge the installed workers already use", () => {
    const { options } = toNotification({});
    expect(options.icon).toBe("/icons/icon-192.png");
    expect(options.badge).toBe("/icons/icon-192.png");
  });

  it("falls back per field when fields are missing", () => {
    const { title, options } = toNotification({});
    expect(title).toBe("MedTracker");
    expect(options.body).toBe("You have a medication reminder");
    expect(options.data).toEqual({ url: "/dashboard" });
  });

  it("falls back per field when fields are the wrong type", () => {
    const { title, options } = toNotification({ title: 1, body: [], url: {}, tag: 7 });
    expect(title).toBe("MedTracker");
    expect(options.body).toBe("You have a medication reminder");
    expect(options.data).toEqual({ url: "/dashboard" });
  });

  it("sanitises a hostile url before storing it on the notification", () => {
    const { options } = toNotification({ url: "//evil.example/x" });
    expect(options.data).toEqual({ url: "/dashboard" });
  });

  // A shared default tag would be worse than none: tags are a
  // replace-key, so two untagged notifications for different medications
  // would collapse onto it and the second would silently erase the
  // first. Omitting the key lets them stack instead.
  it("omits the tag entirely when the payload has none", () => {
    const { options } = toNotification({ title: "x", body: "y", url: "/dashboard" });
    expect("tag" in options).toBe(false);
  });

  it("omits the tag when it is an empty string", () => {
    const { options } = toNotification({ tag: "" });
    expect("tag" in options).toBe(false);
  });

  // The explicit tuple type is required: without it TypeScript infers a
  // narrow union from the heterogeneous rows and rejects the table.
  it.each<[unknown]>([[null], [undefined], ["a string"], [42], [[1, 2, 3]]])(
    "does not throw on non-object payload %p",
    (raw) => {
      expect(() => toNotification(raw)).not.toThrow();
      expect(toNotification(raw).title).toBe("MedTracker");
    },
  );
});

describe("toNotification — renotify", () => {
  it("passes renotify through when a tag is present", () => {
    const { options } = toNotification({
      title: "t",
      body: "b",
      url: "/dashboard",
      tag: "overdue-m1",
      renotify: true,
    });
    expect(options.renotify).toBe(true);
  });

  it("omits renotify when the payload does not ask for it", () => {
    const { options } = toNotification({ title: "t", body: "b", url: "/d", tag: "overdue-m1" });
    expect(options.renotify).toBeUndefined();
  });

  it("never sets renotify without a tag", () => {
    // renotify requires a tag; setting one without the other throws a
    // TypeError in some browsers and would kill the whole notification.
    const { options } = toNotification({ title: "t", body: "b", url: "/d", renotify: true });
    expect(options.tag).toBeUndefined();
    expect(options.renotify).toBeUndefined();
  });

  it("ignores a non-boolean renotify from the wire", () => {
    const { options } = toNotification({ title: "t", body: "b", tag: "x", renotify: "yes" });
    expect(options.renotify).toBeUndefined();
  });
});
