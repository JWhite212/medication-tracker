// @vitest-environment node
//
// `@vitest-environment node` is load-bearing: the suite's default is jsdom,
// and under jsdom vite resolves `svelte` to its client entry, so `render()`
// from `svelte/server` throws `effect_orphan` before an assertion runs. Same
// reason as tests/unit/appearance-page-ssr.test.ts.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import Register from "../../src/routes/auth/register/+page.svelte";
import Login from "../../src/routes/auth/login/+page.svelte";
import ResetPassword from "../../src/routes/auth/reset-password/+page.svelte";
import ResetConfirm from "../../src/routes/auth/reset-password/confirm/+page.svelte";
import TwoFactor from "../../src/routes/auth/2fa/+page.svelte";
import Settings from "../../src/routes/(app)/settings/+page.svelte";
import Security from "../../src/routes/(app)/settings/security/+page.svelte";

/**
 * WCAG 3.3.1 and 1.3.1: an error message has to be tied to the field it is
 * about, not merely drawn near it. Before this, register drew its field
 * errors under each input with nothing pointing at them, the settings
 * timezone error had an id that no control referenced, login rendered no
 * field errors at all, and the reset-password pages drew their message with
 * no live region, so an enhanced submit announced nothing.
 *
 * These are server renders on purpose. With no JavaScript the action's
 * `form` is the only feedback channel, and every one of these pages renders
 * its errors from `form`, so the SSR markup is exactly what a screen reader
 * meets after a failed submit on either path.
 *
 * The rule under test, stated once in `ariaDescribedBy`'s doc comment: a
 * field is DESCRIBED by its own keyed error and by the form-level message,
 * but only its own keyed error makes it INVALID, because a form-level
 * message may be a rate limit or an expired link about a value that is fine.
 */

/** The opening tag of the control with this id. */
function control(html: string, id: string): string {
  const tag = html.match(new RegExp(`<(?:input|select|textarea)\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
  if (!tag) throw new Error(`no control with id="${id}" in the render`);
  return tag;
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

/**
 * Every id any `aria-describedby` names must be on the page. A dangling
 * reference is the failure mode this whole change is about, inverted: a
 * field pointing at a message that is not there.
 */
function expectEveryDescribedByResolves(html: string): void {
  for (const [, value] of html.matchAll(/aria-describedby="([^"]*)"/g)) {
    for (const id of value.split(/\s+/)) {
      expect(html, `aria-describedby names "${id}", which is not rendered`).toContain(`id="${id}"`);
    }
  }
}

/** Nothing on the page claims an error when there is none. */
function expectNoErrorWiring(html: string): void {
  expect(html).not.toContain("aria-invalid");
  expect(html).not.toContain("aria-describedby");
  expect(html).not.toContain('-error"');
}

// Register, reset-password and 2fa destructure only `form` from `$props()`,
// so that is all their typed props accept.
describe("/auth/register", () => {
  it("wires nothing when the form has not failed", () => {
    expectNoErrorWiring(render(Register, { props: { form: null } }).body);
  });

  it("marks the failing field invalid and describes it by its own message", () => {
    const html = render(Register, {
      props: {
        form: {
          errors: { email: ["An account with this email already exists"] },
          email: "taken@example.com",
          name: "Sam",
        },
      },
    }).body;

    const email = control(html, "email");
    expect(attr(email, "aria-invalid")).toBe("true");
    expect(attr(email, "aria-describedby")).toBe("email-error");
    expect(html).toMatch(/<p id="email-error"[^>]*role="alert"[^>]*>\s*An account with this email/);

    // The fields that did not fail stay unmarked.
    for (const id of ["name", "password"]) {
      expect(attr(control(html, id), "aria-invalid")).toBeUndefined();
      expect(attr(control(html, id), "aria-describedby")).toBeUndefined();
    }
    expectEveryDescribedByResolves(html);
  });

  it("renders the rate limit's form-level message, which it used to drop", () => {
    const html = render(Register, {
      props: { form: { errors: { form: ["Too many attempts. Try again in 15 minutes."] } } },
    }).body;

    expect(html).toMatch(/<div id="form-error"[^>]*role="alert"[^>]*>\s*Too many attempts/);
    for (const id of ["name", "email", "password"]) {
      expect(attr(control(html, id), "aria-describedby")).toBe("form-error");
      // A throttle is not a verdict on what was typed.
      expect(attr(control(html, id), "aria-invalid")).toBeUndefined();
    }
    expectEveryDescribedByResolves(html);
  });
});

describe("/auth/login", () => {
  const data = { user: null, hasOAuth: false, oauthError: null };

  it("wires nothing when the form has not failed", () => {
    expectNoErrorWiring(render(Login, { props: { data, form: null } }).body);
  });

  it("renders zod's field errors, which it used to drop, tied to their fields", () => {
    const html = render(Login, {
      props: {
        data,
        form: {
          errors: { email: ["Invalid email address"], password: ["Password is required"] },
          email: "a@b",
        },
      },
    }).body;

    for (const [id, message] of [
      ["email", "Invalid email address"],
      ["password", "Password is required"],
    ]) {
      const tag = control(html, id);
      expect(attr(tag, "aria-invalid")).toBe("true");
      expect(attr(tag, "aria-describedby")).toBe(`${id}-error`);
      expect(html).toMatch(new RegExp(`<p id="${id}-error"[^>]*role="alert"[^>]*>\\s*${message}`));
    }
    expectEveryDescribedByResolves(html);
  });

  it("describes both fields by the form-level message without marking either invalid", () => {
    // The throttle's shape. "Invalid email or password" arrives the same way
    // and deliberately does not say which one either.
    const html = render(Login, {
      props: { data, form: { errors: { form: ["Too many attempts. Try again in 15 minutes."] } } },
    }).body;

    expect(html).toMatch(/<div id="form-error"[^>]*role="alert"/);
    for (const id of ["email", "password"]) {
      expect(attr(control(html, id), "aria-describedby")).toBe("form-error");
      expect(attr(control(html, id), "aria-invalid")).toBeUndefined();
    }
    expectEveryDescribedByResolves(html);
  });
});

describe.each([
  {
    page: "/auth/reset-password",
    render: (form: { error: string } | null) => render(ResetPassword, { props: { form } }).body,
    fields: ["email"],
  },
  {
    page: "/auth/reset-password/confirm",
    render: (form: { error: string } | null) =>
      render(ResetConfirm, { props: { data: { user: null, token: "t" }, form } }).body,
    fields: ["password", "confirmPassword"],
  },
  {
    page: "/auth/2fa",
    render: (form: { error: string } | null) => render(TwoFactor, { props: { form } }).body,
    fields: ["code"],
  },
])("$page (an unkeyed `error` string)", ({ render: renderPage, fields }) => {
  it("wires nothing when the form has not failed", () => {
    expectNoErrorWiring(renderPage(null));
  });

  it("announces the message and describes every field by it, marking none invalid", () => {
    const html = renderPage({ error: "Too many attempts. Try again in 15 minutes." });

    // role="alert" is what makes an enhanced submit's refusal audible at all.
    expect(html).toMatch(/<div id="form-error"[^>]*role="alert"[^>]*>\s*Too many attempts/);
    for (const id of fields) {
      expect(attr(control(html, id), "aria-describedby")).toBe("form-error");
      expect(attr(control(html, id), "aria-invalid")).toBeUndefined();
    }
    expectEveryDescribedByResolves(html);
  });
});

// The (app) layout contributes `user` and `preferences` to both settings
// pages' merged PageData; svelte-check enforces the whole type.
const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "Europe/London",
  twoFactorEnabled: false,
  emailVerified: true,
};

const preferences = {
  userId: "u1",
  accentColor: "#6366f1",
  theme: "system",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: true,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "pdf",
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

describe("/settings", () => {
  const data = { user, preferences };

  it("wires nothing when the form has not failed", () => {
    expectNoErrorWiring(render(Settings, { props: { data, form: null } }).body);
  });

  it("points the timezone select at the message that already carried its id", () => {
    const html = render(Settings, {
      props: { data, form: { errors: { timezone: ["Invalid timezone"] } } },
    }).body;

    const select = control(html, "timezone");
    expect(attr(select, "aria-invalid")).toBe("true");
    expect(attr(select, "aria-describedby")).toBe("timezone-error");
    expect(html).toMatch(/<p id="timezone-error"[^>]*role="alert"/);
    expect(attr(control(html, "name"), "aria-invalid")).toBeUndefined();
    expectEveryDescribedByResolves(html);
  });
});

describe("/settings/security", () => {
  const base = {
    user,
    preferences,
    sessions: [],
    currentSessionId: "s1",
  };

  it("wires nothing when no form has failed", () => {
    for (const twoFactorEnabled of [false, true]) {
      const html = render(Security, {
        props: { data: { ...base, twoFactorEnabled }, form: null },
      }).body;
      expectNoErrorWiring(html);
    }
  });

  it("describes the set-up arm's password field by the 2FA message", () => {
    const html = render(Security, {
      props: {
        data: { ...base, twoFactorEnabled: false },
        form: { totpError: "Incorrect password — re-enter to enable 2FA" },
      },
    }).body;

    expect(html).toMatch(/<p id="totp-error"[^>]*role="alert"/);
    const password = control(html, "setup2faPassword");
    expect(attr(password, "aria-describedby")).toBe("totp-error");
    expect(attr(password, "aria-invalid")).toBeUndefined();
    // The Change Password form above is a different form; its message is not
    // about it.
    expect(attr(control(html, "currentPassword"), "aria-describedby")).toBeUndefined();
    expectEveryDescribedByResolves(html);
  });

  it("describes both of the disable arm's fields, since it cannot say which one failed", () => {
    const html = render(Security, {
      props: { data: { ...base, twoFactorEnabled: true }, form: { totpError: "Invalid code" } },
    }).body;

    for (const id of ["disable2faPassword", "disable2faCode"]) {
      expect(attr(control(html, id), "aria-describedby")).toBe("totp-error");
      expect(attr(control(html, id), "aria-invalid")).toBeUndefined();
    }
    expectEveryDescribedByResolves(html);
  });

  it("keeps the Change Password fields' own error wiring through Input", () => {
    // `Input` now merges a `describedBy` with its own error id; the existing
    // keyed path must come through unchanged.
    const html = render(Security, {
      props: {
        data: { ...base, twoFactorEnabled: false },
        form: { passwordErrors: { confirmPassword: ["Passwords do not match"] } },
      },
    }).body;

    const confirm = control(html, "confirmPassword");
    expect(attr(confirm, "aria-invalid")).toBe("true");
    expect(attr(confirm, "aria-describedby")).toBe("confirmPassword-error");
    expectEveryDescribedByResolves(html);
  });
});
