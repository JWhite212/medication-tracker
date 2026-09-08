/**
 * Minimal typing for the two members of `jsdom` the test suite actually uses.
 *
 * `jsdom` ships no declarations of its own, and it is only ever imported from
 * a test that has to build a real DOM to hand to axe — the SSR renderer needs
 * the `node` environment, so vitest's own jsdom environment is not available
 * in that file. Declaring the surface used here keeps `npm run check` at zero
 * errors without pulling `@types/jsdom` (and its `@types/tough-cookie` tail)
 * into the dependency set for one assertion.
 *
 * Deliberately narrow: widen it when a test needs more, so the shim never
 * silently claims coverage of an API nothing exercises.
 */
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string);
    readonly window: Window & typeof globalThis;
  }
}
