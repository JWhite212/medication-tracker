// WalkthroughVideo, mounted for real (jsdom, client svelte), for the one
// behaviour no other test can reach: a visitor who prefers reduced motion
// gets the title frame and a Play button, and nothing moves until they press
// it (WCAG 2.2.2). The player decides that in onMount from matchMedia, so it
// cannot be seen in SSR output.
//
// jsdom has no matchMedia, IntersectionObserver or ResizeObserver, and no
// layout, so each is stubbed:
//   - matchMedia answers the reduced-motion query;
//   - the one IntersectionObserver the player creates is fired by hand, so
//     the player is on screen (`inView`) with the full stage mounted (`full`),
//     and the page is visible. The preference is then the ONLY thing left
//     that could stop playback;
//   - ResizeObserver exists only because `bind:clientWidth` constructs one,
//     and clientWidth reads 1024, the landing page's container, because jsdom
//     reports 0 and that would scale the stage to nothing.
// requestAnimationFrame is a spy that never calls back: "playing" is whether
// the player asked for a frame at all.
//
// The second case is the control. Without it, a harness that could never
// play anything would pass the first case for the wrong reason.
import { describe, it, expect, vi, afterEach } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import WalkthroughVideo from "$lib/components/walkthrough/WalkthroughVideo.svelte";

const teardown: Array<() => void> = [];

afterEach(() => {
  while (teardown.length) teardown.pop()!();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountPlayer({ reducedMotion }: { reducedMotion: boolean }) {
  const observers: IntersectionObserverCallback[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  const requestFrame = vi.fn(() => 1);
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1024);

  const target = document.body.appendChild(document.createElement("div"));
  const app = mount(WalkthroughVideo, { target, props: {} });
  teardown.push(() => {
    unmount(app);
    target.remove();
  });
  // onMount, which reads the preference and creates the observer, runs here.
  flushSync();

  // Scrolled into view, on a visible page: neither is what stops playback.
  expect(document.visibilityState).toBe("visible");
  expect(observers).toHaveLength(1);
  observers[0]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  flushSync();

  return { target, requestFrame };
}

/** The one element whose own text is exactly `text`. */
function byText(root: ParentNode, text: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>("p, span")].filter(
    (el) => el.textContent?.replace(/\s+/g, " ").trim() === text,
  );
  expect(found, `elements reading "${text}"`).toHaveLength(1);
  return found[0];
}

/**
 * Whether `el` would be painted, by CSS `visibility` alone: the nearest
 * ancestor-or-self that sets it to anything but `inherit` decides, as in CSS.
 * The stage hides whole layers this way rather than unmounting them.
 */
function isShown(el: HTMLElement, root: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node && node !== root; node = node.parentElement) {
    const visibility = node.style.visibility;
    if (visibility && visibility !== "inherit") return visibility !== "hidden";
  }
  return true;
}

function playButton(root: ParentNode): HTMLButtonElement {
  const buttons = root.querySelectorAll("button");
  expect(buttons).toHaveLength(1);
  return buttons[0];
}

/** The progress fill along the bottom of the player. */
function progress(root: ParentNode): string {
  const bar = root.querySelector<HTMLElement>("figure > div > div.h-1 > div");
  expect(bar).not.toBeNull();
  return bar!.style.width;
}

describe("WalkthroughVideo and reduced motion", () => {
  it("shows the title frame, does not play, and offers to play when the viewer prefers reduced motion", async () => {
    const { target, requestFrame } = mountPlayer({ reducedMotion: true });
    // A player that started one microtask late would still be caught.
    await tick();

    expect(playButton(target).getAttribute("aria-label")).toBe("Play walkthrough");
    expect(requestFrame).not.toHaveBeenCalled();
    expect(progress(target)).toBe("0%");
    // The title frame is the one painted: its line shows, and the desktop
    // app (mounted, since the player is on screen) does not.
    expect(isShown(byText(target, "Track your medications effortlessly"), target)).toBe(true);
    expect(isShown(byText(target, "Demo User"), target)).toBe(false);

    // The button does what it offers.
    playButton(target).click();
    flushSync();
    expect(playButton(target).getAttribute("aria-label")).toBe("Pause walkthrough");
    expect(requestFrame).toHaveBeenCalled();
  });

  it("plays on its own when the viewer has no motion preference (the control)", async () => {
    const { target, requestFrame } = mountPlayer({ reducedMotion: false });
    await tick();

    expect(playButton(target).getAttribute("aria-label")).toBe("Pause walkthrough");
    expect(requestFrame).toHaveBeenCalled();
  });

  it("hides the whole stage from assistive tech, but not the caption or the pause button", () => {
    // The stage test mounts WalkthroughStage below the wrapper that carries
    // aria-hidden, so only this mount can see it. Without it a screen reader
    // reads both dashboard copies, every StatusMarker and Sparkline label and
    // the lower thirds, on top of the figcaption that already says it all.
    const { target } = mountPlayer({ reducedMotion: false });
    const figure = target.querySelector("figure")!;
    const sections = figure.querySelectorAll("[data-stage-section]");
    // Not vacuous: the full stage is mounted.
    expect(sections.length).toBeGreaterThan(0);
    for (const el of [...sections, ...figure.querySelectorAll('[role="img"]')]) {
      expect(el.closest('[aria-hidden="true"]'), el.outerHTML.slice(0, 80)).not.toBeNull();
    }
    expect(figure.querySelector("figcaption")!.closest('[aria-hidden="true"]')).toBeNull();
    expect(playButton(target).closest('[aria-hidden="true"]')).toBeNull();
  });
});
