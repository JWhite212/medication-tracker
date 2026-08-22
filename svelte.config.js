import adapter from "@sveltejs/adapter-vercel";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // `regions` pins execution to London. Neon lives in eu-west-2 (London)
    // and every page load is several sequential round-trips to it, so a
    // function in the default us-east-1 would pay ~70-80ms of transatlantic
    // latency per query. This was already effectively true — deployed
    // functions report `lhr1` — but it was set in the Vercel dashboard, not
    // here, so re-creating the project would have silently lost it.
    // Hobby allows exactly one region; keep this a single entry.
    adapter: adapter({ runtime: "nodejs22.x", regions: ["lhr1"] }),
    alias: {
      $components: "src/lib/components",
      $server: "src/lib/server",
    },
    csp: {
      directives: {
        "default-src": ["self"],
        // `base-uri` is not covered by default-src. Without it, an injected
        // <base href="//evil"> re-points every relative URL on the page,
        // which turns an otherwise-contained HTML injection into script
        // execution against an attacker origin.
        "base-uri": ["self"],
        // Likewise `form-action`. This app posts credentials, TOTP codes and
        // password-reset tokens through form actions, so pinning where a
        // form may submit is worth more here than on a typical site.
        "form-action": ["self"],
        // Header-delivered CSP only; browsers ignore frame-ancestors in the
        // <meta> tag SvelteKit emits for prerendered pages. X-Frame-Options
        // DENY is what actually covers those, which is why both exist.
        "frame-ancestors": ["none"],
        "script-src": ["self"],
        "style-src": ["self", "unsafe-inline"],
        "img-src": ["self", "data:", "https:"],
        "connect-src": ["self"],
        "font-src": ["self"],
        "worker-src": ["self"],
        "manifest-src": ["self"],
        "object-src": ["none"],
        "frame-src": ["none"],
      },
    },
  },
};
export default config;
