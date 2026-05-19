import { dev } from "$app/environment";
import { injectAnalytics, type BeforeSendEvent } from "@vercel/analytics/sveltekit";
import { injectSpeedInsights } from "@vercel/speed-insights/sveltekit";

injectAnalytics({
  mode: dev ? "development" : "production",
  beforeSend(event: BeforeSendEvent) {
    // The /log page accepts a free-text search (`?q=...`) that can contain
    // medication names. Strip the entire query string so it never reaches
    // the recorded URL. Match the pathname exactly so we don't also catch
    // routes like /auth/login or /auth/logout.
    try {
      const u = new URL(event.url);
      if (u.pathname === "/log" || u.pathname === "/log/") {
        u.search = "";
        return { ...event, url: u.toString() };
      }
      return event;
    } catch (err) {
      console.warn("[analytics beforeSend] URL parse failed", err, event.url);
      return event;
    }
  },
});
injectSpeedInsights();