/**
 * Decides whether a control's pending value is worth POSTing.
 *
 * Extracted as a pure function so the decision has a coverage path that
 * does not depend on mounting `+page.svelte` — this repo has no
 * client-mount harness for that page's interactive behaviour (debounce
 * coalescing, the single-flight queue, the revert-on-failure path), so a
 * real interactive test of `submitField` cannot run here. The decision
 * itself has no such dependency and can be unit-tested directly.
 *
 * `acked` is "the last value the SERVER confirmed". While a save for this
 * key is in flight, `acked` still holds the PRE-save value — so during
 * that window `value === acked` is not a reliable signal that "nothing
 * changed". Concretely: user picks compact (save begins, `acked` is still
 * "comfortable"), then picks comfortable again before the response lands.
 * Comparing the new value against the stale `acked` wrongly concludes "no
 * change" and skips the POST that would keep the pending change tracked —
 * so once the in-flight save resolves, its result gets stamped back onto
 * the control even though the user's last action asked for something
 * else. The `inFlight` check must run first, and its presence here is not
 * redundant with the equality check: it is what makes the equality check
 * trustworthy in the first place.
 */
export function shouldSubmitField(value: unknown, acked: unknown, inFlight: boolean): boolean {
  return inFlight || value !== acked;
}
