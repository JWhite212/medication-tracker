// `DoseWriteLock.active` must be reactive: a control that renders it has to
// re-render when a write starts and when the last holder lets go. The file
// is `.svelte.test.ts` so that `$effect.root` compiles (the same reason as
// accessible-pickers-focus.svelte.test.ts).
import { describe, it, expect } from "vitest";
import { flushSync } from "svelte";
import { createDoseWriteLock } from "$lib/components/dose-writes/dose-write-lock.svelte";

describe("DoseWriteLock.active", () => {
  it("is reactive: an effect that reads it re-runs when a holder arrives and when the last one leaves", () => {
    const lock = createDoseWriteLock({ cooldownMs: 0 });
    const seen: boolean[] = [];
    const stop = $effect.root(() => {
      $effect(() => {
        seen.push(lock.active);
      });
    });
    try {
      flushSync();
      lock.acquire();
      flushSync();
      lock.release();
      flushSync();
      expect(seen).toEqual([false, true, false]);
    } finally {
      stop();
    }
  });
});
