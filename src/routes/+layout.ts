import { dev } from "$app/environment";
import { injectAnalytics, type BeforeSendEvent } from "@vercel/analytics/sveltekit";
import { injectSpeedInsights } from "@vercel/speed-insights/sveltekit";

injectAnalytics({
  mode: dev ? "development" : "production",
  beforeSend(event: BeforeSendEvent) {
    // The /log page accepts a free-text search (`?q=...`) that can contain
    // medication names. Strip the entire query string so it never reaches
    // the recorded URL.
    if (event.url.includes("/log")) {
      const u = new URL(event.url);
      u.search = "";
      return { ...event, url: u.toString() };
    }
    return event;
  },
});

injectSpeedInsights();
