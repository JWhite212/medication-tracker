// The landing page is fully static — prerendering it means first-time
// visitors are served HTML from the CDN edge instead of waiting on a
// serverless cold start (measured at ~1.3s of TTFB when cold). The old
// server-side "logged in? -> /dashboard" redirect is covered by the
// auth pages: /auth/login and /auth/register both redirect authenticated
// users to the dashboard, and the PWA start_url is /dashboard.
export const prerender = true;
