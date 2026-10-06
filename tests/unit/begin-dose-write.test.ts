// beginDoseWrite — the gate every dose write passes at submit, owned in one
// place so createDoseWrite and DoseEditForm's Save cannot drift apart. What
// each caller does around it (the stale guard, withdrawing the Undo offer,
// the release) is proven in dose-write.svelte.test.ts and
// dose-edit-form-lock.test.ts; this file proves the gate itself, and that it
// really is the only code that takes the lock for a write.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));

import { beginDoseWrite } from "$lib/components/dose-writes/begin-dose-write";
import { OFFLINE_WRITE_TOAST, STILL_SAVING_TOAST } from "$lib/components/dose-writes/copy";
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
} from "$lib/components/dose-writes/dose-write-lock.svelte";

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}

beforeEach(() => {
  vi.useFakeTimers();
  h.showToast.mockReset();
  setOnline(true);
});

afterEach(() => {
  vi.useRealTimers();
  setOnline(true);
});

describe("beginDoseWrite", () => {
  it("lets a write through when online and idle: it holds the lock, cancels nothing and says nothing", () => {
    const lock = createDoseWriteLock();
    const cancel = vi.fn();

    expect(beginDoseWrite(cancel, lock)).toBe(true);

    expect(lock.active).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("offline: cancels, says nothing was saved, and takes no lock", () => {
    const lock = createDoseWriteLock();
    const cancel = vi.fn();
    setOnline(false);

    expect(beginDoseWrite(cancel, lock)).toBe(false);

    expect(cancel).toHaveBeenCalledOnce();
    expect(h.showToast).toHaveBeenCalledOnce();
    expect(h.showToast).toHaveBeenCalledWith(OFFLINE_WRITE_TOAST, "error");
    // No holder and no cooldown: an offline tap must not lock every dose control.
    expect(lock.active).toBe(false);
    expect(lock.busy).toBe(false);
  });

  it("offline is decided before the lock: offline with a write in flight says offline, not still saving", () => {
    const lock = createDoseWriteLock();
    lock.acquire(); // another write is in flight
    const cancel = vi.fn();
    setOnline(false);

    expect(beginDoseWrite(cancel, lock)).toBe(false);

    expect(cancel).toHaveBeenCalledOnce();
    expect(h.showToast).toHaveBeenCalledOnce();
    expect(h.showToast).toHaveBeenCalledWith(OFFLINE_WRITE_TOAST, "error");
  });

  it("refused while another write is in flight: cancels and says it is still saving", () => {
    const lock = createDoseWriteLock();
    lock.acquire();
    const cancel = vi.fn();

    expect(beginDoseWrite(cancel, lock)).toBe(false);

    expect(cancel).toHaveBeenCalledOnce();
    expect(h.showToast).toHaveBeenCalledOnce();
    expect(h.showToast).toHaveBeenCalledWith(STILL_SAVING_TOAST, "error");
  });

  it("refused in the cooldown alone: cancels, and stays silent", () => {
    const lock = createDoseWriteLock();
    lock.acquire();
    lock.release(); // it settled; only the cooldown remains
    expect(lock.busy).toBe(true);
    expect(lock.active).toBe(false);
    const cancel = vi.fn();

    expect(beginDoseWrite(cancel, lock)).toBe(false);

    expect(cancel).toHaveBeenCalledOnce();
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("a refusal acquires nothing: the holder count is unchanged, so one release frees the lock", async () => {
    const lock = createDoseWriteLock();
    lock.acquire();
    beginDoseWrite(vi.fn(), lock); // refused
    beginDoseWrite(vi.fn(), lock); // refused again

    lock.release();
    expect(lock.active).toBe(false);
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    expect(beginDoseWrite(vi.fn(), lock)).toBe(true);
  });
});

/**
 * The single-owner property, written as a scan because the state it replaced
 * — the same offline gate, acquire refusal and "still saving" rule written out
 * twice, each copy proven only by its own caller's tests — is what
 * re-accumulates when the rule is only written down. A caller that calls
 * `lock.acquire()` or refuses an offline write itself has a second owner of
 * "may this write start?".
 */
describe("beginDoseWrite is the only door to a dose write's lock", () => {
  const OWNER = join("src", "lib", "components", "dose-writes", "begin-dose-write.ts");
  const COPY = join("src", "lib", "components", "dose-writes", "copy.ts");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|svelte)$/.test(entry)) out.push(full);
    }
    return out;
  }

  const sources = walk("src").map((file) => ({ file, text: readFileSync(file, "utf8") }));
  const filesMatching = (pattern: RegExp) =>
    sources.filter((s) => pattern.test(s.text)).map((s) => s.file);

  it("takes the lock for a write in exactly one place", () => {
    expect(filesMatching(/\block\.acquire\(/)).toEqual([OWNER]);
  });

  it("refuses an offline write in exactly one place (its copy is defined in copy.ts)", () => {
    expect(filesMatching(/\bOFFLINE_WRITE_TOAST\b/).sort()).toEqual([COPY, OWNER].sort());
  });

  it("every caller of the gate calls it, so none can have quietly gone its own way", () => {
    // createDoseWrite and Edit Save write doses; the medications list's reorder
    // is not a dose write, but it moves the cards a Log tap lands on, so it
    // takes the same lock through the same gate rather than a copy of it.
    expect(filesMatching(/\bbeginDoseWrite\(/).sort()).toEqual(
      [
        OWNER,
        join("src", "lib", "components", "DoseEditForm.svelte"),
        join("src", "lib", "components", "dose-writes", "dose-write.svelte.ts"),
        join("src", "routes", "(app)", "medications", "+page.svelte"),
      ].sort(),
    );
  });
});
