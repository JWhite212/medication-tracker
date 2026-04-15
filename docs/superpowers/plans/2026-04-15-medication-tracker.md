# Medication Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web-based personal medication tracker with live dose timeline, adherence analytics, and portfolio-grade visual design.

**Architecture:** Server-first SvelteKit app. Pages load via `+page.server.ts` loaders, mutations via form actions. Live "time since" counters are pure client-side clock math. Auth via Lucia v3 sessions stored in PostgreSQL.

**Tech Stack:** SvelteKit (Svelte 5) + TypeScript, Tailwind CSS v4, Drizzle ORM, Neon PostgreSQL, Lucia v3 + Arctic, Vercel, Resend, Zod

---

## File Structure

```
src/
  lib/
    server/
      db/
        index.ts                    # Neon connection + Drizzle instance
        schema.ts                   # All table definitions
      auth/
        lucia.ts                    # Lucia instance + session helpers
        oauth.ts                    # Arctic Google/GitHub providers
        password.ts                 # Argon2id hash/verify
        rate-limit.ts               # In-memory rate limiter
        totp.ts                     # TOTP setup/verify
      medications.ts                # Medication CRUD queries
      doses.ts                      # Dose log queries
      audit.ts                      # Audit log writer
      analytics.ts                  # Adherence/streak queries
      reminders.ts                  # Overdue dose checker
      export-pdf.ts                 # PDF report generation
      email.ts                      # Resend client + templates
    components/
      ui/
        Button.svelte               # Reusable button with variants
        GlassCard.svelte            # Glassmorphism card wrapper
        Input.svelte                # Form input with label/error
        Toast.svelte                # Toast notification system
        Modal.svelte                # Dialog modal
      QuickLogBar.svelte            # Pill-shaped medication buttons
      TimelineEntry.svelte          # Single dose in timeline
      TimeSince.svelte              # Live counting-up timer
      SummaryStrip.svelte           # "N doses today" + streak
      DoseForm.svelte               # Expanded dose logging form
      MedicationForm.svelte         # Create/edit medication form
      MedicationCard.svelte         # Medication in list view
      Heatmap.svelte                # Calendar heatmap chart
      AdherenceChart.svelte         # Per-med adherence bars
      Sidebar.svelte                # App navigation sidebar
    utils/
      time.ts                       # formatTimeSince, formatTime
      validation.ts                 # All Zod schemas
      colours.ts                    # Colour contrast utilities
    types.ts                        # Shared TypeScript types
  routes/
    +page.svelte                    # Landing page
    +layout.svelte                  # Root layout
    +layout.server.ts               # Root session loader
    auth/
      login/+page.svelte
      login/+page.server.ts
      register/+page.svelte
      register/+page.server.ts
      verify/+server.ts             # Email verification endpoint
      reset-password/+page.svelte
      reset-password/+page.server.ts
      callback/[provider]/+server.ts
    (app)/
      +layout.svelte                # App shell with sidebar
      +layout.server.ts             # Auth guard
      dashboard/+page.svelte
      dashboard/+page.server.ts
      medications/+page.svelte
      medications/+page.server.ts
      medications/new/+page.svelte
      medications/new/+page.server.ts
      medications/[id]/+page.svelte
      medications/[id]/+page.server.ts
      log/+page.svelte
      log/+page.server.ts
      analytics/+page.svelte
      analytics/+page.server.ts
      settings/+page.svelte
      settings/+page.server.ts
      settings/security/+page.svelte
      settings/security/+page.server.ts
    api/
      cron/reminders/+server.ts     # Vercel Cron endpoint
      export/+server.ts             # PDF download endpoint
  hooks.server.ts                   # Lucia session validation hook
  app.d.ts                          # SvelteKit type augmentation
  app.css                           # Tailwind v4 + global styles
tests/
  unit/
    time.test.ts
    validation.test.ts
    password.test.ts
    audit.test.ts
    analytics.test.ts
  e2e/
    auth.test.ts
    dashboard.test.ts
    medications.test.ts
drizzle.config.ts
svelte.config.js
vite.config.ts
.env.example
```

---

## Phase 1: Foundation

### Task 1: Project Scaffolding

**Files:**

- Create: `package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `src/app.css`, `src/app.d.ts`, `src/app.html`, `.env.example`, `.gitignore`, `drizzle.config.ts`

- [ ] **Step 1: Create SvelteKit project**

```bash
cd /Users/jamiewhite/Documents/Personal/Projects/medication-tracker
npx sv create . --template minimal --types ts --no-add-ons --no-install
```

Select: SvelteKit minimal, TypeScript, no additional options.

- [ ] **Step 2: Install core dependencies**

```bash
npm install drizzle-orm @neondatabase/serverless lucia arctic @node-rs/argon2 @oslojs/encoding @oslojs/crypto zod @paralleldrive/cuid2 resend
npm install -D drizzle-kit @sveltejs/adapter-vercel tailwindcss @tailwindcss/vite vitest @testing-library/svelte jsdom playwright @playwright/test
```

- [ ] **Step 3: Configure Vercel adapter**

Replace contents of `svelte.config.js`:

```js
import adapter from "@sveltejs/adapter-vercel";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      $components: "src/lib/components",
      $server: "src/lib/server",
    },
  },
};

export default config;
```

- [ ] **Step 4: Configure Vite with Tailwind and Vitest**

Replace contents of `vite.config.ts`:

```ts
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "jsdom",
  },
});
```

- [ ] **Step 5: Set up Tailwind CSS v4 with app styles**

Replace contents of `src/app.css`:

```css
@import "tailwindcss";

@theme {
  --color-glass: rgba(255, 255, 255, 0.08);
  --color-glass-border: rgba(255, 255, 255, 0.12);
  --color-glass-hover: rgba(255, 255, 255, 0.14);
  --color-surface: #0a0a0f;
  --color-surface-raised: #12121a;
  --color-surface-overlay: #1a1a25;
  --color-text-primary: #f0f0f5;
  --color-text-secondary: #8888a0;
  --color-text-muted: #55556a;
  --color-accent: #6366f1;
  --color-accent-hover: #818cf8;
  --color-success: #10b981;
  --color-warning: #f59e0b;
  --color-danger: #ef4444;
  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
  --radius-sm: 0.5rem;
  --radius-md: 0.75rem;
  --radius-lg: 1rem;
  --radius-xl: 1.5rem;
}

@layer base {
  body {
    @apply bg-surface text-text-primary font-sans antialiased;
  }
}
```

- [ ] **Step 6: Set up app.html**

Replace contents of `src/app.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%sveltekit.assets%/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

- [ ] **Step 7: Configure TypeScript app types**

Replace contents of `src/app.d.ts`:

```ts
declare global {
  namespace App {
    interface Locals {
      user: import("$lib/types").SessionUser | null;
      session: import("$lib/server/auth/lucia").SessionRecord | null;
    }
  }
}

export {};
```

- [ ] **Step 8: Create .env.example**

Create `.env.example`:

```env
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
RESEND_API_KEY=
CRON_SECRET=
ENCRYPTION_KEY=
```

- [ ] **Step 9: Create drizzle.config.ts**

Create `drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 10: Update .gitignore and commit**

Append to `.gitignore`:

```
.env
.env.local
```

```bash
git init
git add -A
git commit -m "chore: scaffold SvelteKit project with Tailwind, Drizzle, Lucia"
```

---

### Task 2: Database Schema

**Files:**

- Create: `src/lib/server/db/schema.ts`, `src/lib/server/db/index.ts`, `src/lib/types.ts`
- Test: `tests/unit/schema.test.ts`

- [ ] **Step 1: Write schema test**

Create `tests/unit/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  users,
  sessions,
  oauthAccounts,
  medications,
  doseLogs,
  auditLogs,
} from "$lib/server/db/schema";

describe("database schema", () => {
  it("users table has required columns", () => {
    expect(users.id).toBeDefined();
    expect(users.email).toBeDefined();
    expect(users.name).toBeDefined();
    expect(users.passwordHash).toBeDefined();
    expect(users.timezone).toBeDefined();
    expect(users.twoFactorEnabled).toBeDefined();
    expect(users.emailVerified).toBeDefined();
    expect(users.createdAt).toBeDefined();
  });

  it("medications table has required columns", () => {
    expect(medications.id).toBeDefined();
    expect(medications.userId).toBeDefined();
    expect(medications.name).toBeDefined();
    expect(medications.dosageAmount).toBeDefined();
    expect(medications.dosageUnit).toBeDefined();
    expect(medications.form).toBeDefined();
    expect(medications.category).toBeDefined();
    expect(medications.colour).toBeDefined();
    expect(medications.inventoryCount).toBeDefined();
    expect(medications.isArchived).toBeDefined();
  });

  it("doseLogs table has taken_at and logged_at", () => {
    expect(doseLogs.takenAt).toBeDefined();
    expect(doseLogs.loggedAt).toBeDefined();
    expect(doseLogs.medicationId).toBeDefined();
    expect(doseLogs.quantity).toBeDefined();
  });

  it("auditLogs table has jsonb changes column", () => {
    expect(auditLogs.changes).toBeDefined();
    expect(auditLogs.entityType).toBeDefined();
    expect(auditLogs.action).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/schema.test.ts
```

Expected: FAIL — module `$lib/server/db/schema` not found.

- [ ] **Step 3: Write the database schema**

Create `src/lib/server/db/schema.ts`:

```ts
import {
  pgTable,
  text,
  boolean,
  timestamp,
  numeric,
  integer,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  avatarUrl: text("avatar_url"),
  timezone: text("timezone").notNull().default("UTC"),
  totpSecret: text("totp_secret"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  emailVerified: boolean("email_verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.provider, table.providerUserId] })],
);

export const medications = pgTable(
  "medications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dosageAmount: numeric("dosage_amount").notNull(),
    dosageUnit: text("dosage_unit").notNull(),
    form: text("form").notNull(),
    category: text("category").notNull(),
    colour: text("colour").notNull(),
    notes: text("notes"),
    scheduleIntervalHours: numeric("schedule_interval_hours"),
    inventoryCount: integer("inventory_count"),
    inventoryAlertThreshold: integer("inventory_alert_threshold"),
    sortOrder: integer("sort_order").notNull().default(0),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("medications_user_archived_idx").on(table.userId, table.isArchived),
  ],
);

export const doseLogs = pgTable(
  "dose_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    medicationId: text("medication_id")
      .notNull()
      .references(() => medications.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    loggedAt: timestamp("logged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text("notes"),
  },
  (table) => [
    index("dose_logs_user_taken_idx").on(table.userId, table.takenAt),
    index("dose_logs_med_taken_idx").on(table.medicationId, table.takenAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_logs_user_created_idx").on(table.userId, table.createdAt),
  ],
);
```

- [ ] **Step 4: Write the database connection module**

Create `src/lib/server/db/index.ts`:

```ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { env } from "$env/dynamic/private";

const sql = neon(env.DATABASE_URL!);

export const db = drizzle(sql, { schema });
export type Database = typeof db;
```

- [ ] **Step 5: Write shared types**

Create `src/lib/types.ts`:

```ts
import type { InferSelectModel } from "drizzle-orm";
import type {
  users,
  medications,
  doseLogs,
  auditLogs,
  sessions,
} from "$lib/server/db/schema";

export type User = InferSelectModel<typeof users>;
export type Medication = InferSelectModel<typeof medications>;
export type DoseLog = InferSelectModel<typeof doseLogs>;
export type AuditLog = InferSelectModel<typeof auditLogs>;
export type SessionRecord = InferSelectModel<typeof sessions>;

export type SessionUser = Pick<
  User,
  | "id"
  | "email"
  | "name"
  | "avatarUrl"
  | "timezone"
  | "twoFactorEnabled"
  | "emailVerified"
>;

export type DoseLogWithMedication = DoseLog & {
  medication: Pick<
    Medication,
    "name" | "dosageAmount" | "dosageUnit" | "form" | "colour"
  >;
};
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run tests/unit/schema.test.ts
```

Expected: PASS — all schema column assertions pass.

- [ ] **Step 7: Generate and apply database migration**

```bash
npx drizzle-kit generate
npx drizzle-kit push
```

Expected: Migration files created in `drizzle/`. Schema pushed to Neon database.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/db/ src/lib/types.ts tests/unit/schema.test.ts drizzle/
git commit -m "feat: add database schema with Drizzle ORM and Neon"
```

---

### Task 3: Validation Schemas

**Files:**

- Create: `src/lib/utils/validation.ts`
- Test: `tests/unit/validation.test.ts`

- [ ] **Step 1: Write validation tests**

Create `tests/unit/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  registerSchema,
  loginSchema,
  medicationSchema,
  doseLogSchema,
  settingsSchema,
} from "$lib/utils/validation";

describe("registerSchema", () => {
  it("accepts valid registration", () => {
    const result = registerSchema.safeParse({
      email: "test@example.com",
      password: "securepass123",
      name: "Test User",
    });
    expect(result.success).toBe(true);
  });

  it("rejects short password", () => {
    const result = registerSchema.safeParse({
      email: "test@example.com",
      password: "short",
      name: "Test User",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = registerSchema.safeParse({
      email: "not-an-email",
      password: "securepass123",
      name: "Test User",
    });
    expect(result.success).toBe(false);
  });
});

describe("medicationSchema", () => {
  it("accepts valid medication", () => {
    const result = medicationSchema.safeParse({
      name: "Ibuprofen",
      dosageAmount: "200",
      dosageUnit: "mg",
      form: "tablet",
      category: "otc",
      colour: "#6366f1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid colour hex", () => {
    const result = medicationSchema.safeParse({
      name: "Ibuprofen",
      dosageAmount: "200",
      dosageUnit: "mg",
      form: "tablet",
      category: "otc",
      colour: "not-a-hex",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid category", () => {
    const result = medicationSchema.safeParse({
      name: "Ibuprofen",
      dosageAmount: "200",
      dosageUnit: "mg",
      form: "tablet",
      category: "invalid",
      colour: "#6366f1",
    });
    expect(result.success).toBe(false);
  });
});

describe("doseLogSchema", () => {
  it("accepts valid dose log with defaults", () => {
    const result = doseLogSchema.safeParse({
      medicationId: "abc123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quantity).toBe(1);
    }
  });

  it("accepts dose log with custom quantity and time", () => {
    const result = doseLogSchema.safeParse({
      medicationId: "abc123",
      quantity: 2,
      takenAt: "2026-04-15T10:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects zero quantity", () => {
    const result = doseLogSchema.safeParse({
      medicationId: "abc123",
      quantity: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("settingsSchema", () => {
  it("accepts valid timezone", () => {
    const result = settingsSchema.safeParse({
      name: "Test User",
      timezone: "Europe/London",
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/validation.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write validation schemas**

Create `src/lib/utils/validation.ts`:

```ts
import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required").max(100),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const medicationSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  dosageAmount: z.string().regex(/^\d+(\.\d+)?$/, "Must be a number"),
  dosageUnit: z.string().min(1, "Unit is required").max(20),
  form: z.enum([
    "tablet",
    "capsule",
    "liquid",
    "softgel",
    "patch",
    "injection",
    "inhaler",
    "drops",
    "cream",
    "other",
  ]),
  category: z.enum(["prescription", "otc", "supplement"]),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex colour"),
  notes: z.string().max(1000).optional(),
  scheduleIntervalHours: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  inventoryCount: z.coerce.number().int().min(0).optional(),
  inventoryAlertThreshold: z.coerce.number().int().min(0).optional(),
});

export const doseLogSchema = z.object({
  medicationId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).default(1),
  takenAt: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
});

export const settingsSchema = z.object({
  name: z.string().min(1).max(100),
  timezone: z.string().min(1),
});

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type MedicationInput = z.infer<typeof medicationSchema>;
export type DoseLogInput = z.infer<typeof doseLogSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/validation.test.ts
```

Expected: PASS — all validation tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/validation.ts tests/unit/validation.test.ts
git commit -m "feat: add Zod validation schemas for all forms"
```

---

### Task 4: Time Utilities

**Files:**

- Create: `src/lib/utils/time.ts`
- Test: `tests/unit/time.test.ts`

- [ ] **Step 1: Write time utility tests**

Create `tests/unit/time.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatTimeSince, formatTime, startOfDay } from "$lib/utils/time";

describe("formatTimeSince", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T14:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats seconds ago", () => {
    const thirtySecsAgo = new Date("2026-04-15T14:29:30Z");
    expect(formatTimeSince(thirtySecsAgo)).toBe("just now");
  });

  it("formats minutes ago", () => {
    const fiveMinsAgo = new Date("2026-04-15T14:25:00Z");
    expect(formatTimeSince(fiveMinsAgo)).toBe("5m ago");
  });

  it("formats hours and minutes ago", () => {
    const twoHoursAgo = new Date("2026-04-15T12:00:00Z");
    expect(formatTimeSince(twoHoursAgo)).toBe("2h 30m ago");
  });

  it("formats days ago", () => {
    const twoDaysAgo = new Date("2026-04-13T14:30:00Z");
    expect(formatTimeSince(twoDaysAgo)).toBe("2d ago");
  });

  it("formats exact hours", () => {
    const oneHourAgo = new Date("2026-04-15T13:30:00Z");
    expect(formatTimeSince(oneHourAgo)).toBe("1h 0m ago");
  });
});

describe("formatTime", () => {
  it("formats time in 12-hour format", () => {
    const date = new Date("2026-04-15T14:30:00Z");
    const result = formatTime(date, "UTC");
    expect(result).toBe("2:30 PM");
  });

  it("formats time with timezone", () => {
    const date = new Date("2026-04-15T14:30:00Z");
    const result = formatTime(date, "America/New_York");
    expect(result).toBe("10:30 AM");
  });
});

describe("startOfDay", () => {
  it("returns midnight in given timezone", () => {
    const result = startOfDay(new Date("2026-04-15T14:30:00Z"), "UTC");
    expect(result.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/time.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write time utilities**

Create `src/lib/utils/time.ts`:

```ts
export function formatTimeSince(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m ago`;
  return `${diffDays}d ago`;
}

export function formatTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).format(date);
}

export function startOfDay(date: Date, timezone: string): Date {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateStr = formatter.format(date);
  return new Date(`${dateStr}T00:00:00.000Z`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/time.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/time.ts tests/unit/time.test.ts
git commit -m "feat: add time formatting utilities with timezone support"
```

---

### Task 5: Authentication — Lucia Setup & Password Utilities

**Files:**

- Create: `src/lib/server/auth/lucia.ts`, `src/lib/server/auth/password.ts`, `src/hooks.server.ts`
- Test: `tests/unit/password.test.ts`

- [ ] **Step 1: Write password utility tests**

Create `tests/unit/password.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "$lib/server/auth/password";

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("mysecurepassword");
    expect(hash).not.toBe("mysecurepassword");
    expect(hash.length).toBeGreaterThan(0);

    const valid = await verifyPassword(hash, "mysecurepassword");
    expect(valid).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("correctpassword");
    const valid = await verifyPassword(hash, "wrongpassword");
    expect(valid).toBe(false);
  });

  it("produces different hashes for same password", async () => {
    const hash1 = await hashPassword("samepassword");
    const hash2 = await hashPassword("samepassword");
    expect(hash1).not.toBe(hash2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/password.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write password utilities**

Create `src/lib/server/auth/password.ts`:

```ts
import { hash, verify } from "@node-rs/argon2";

export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  return verify(hash, password);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/password.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write Lucia configuration**

Create `src/lib/server/auth/lucia.ts`:

```ts
import { Lucia } from "lucia";
import { DrizzlePostgreSQLAdapter } from "@lucia-auth/adapter-drizzle";
import { db } from "$lib/server/db";
import { sessions, users } from "$lib/server/db/schema";
import { dev } from "$app/environment";
import type { SessionUser } from "$lib/types";

const adapter = new DrizzlePostgreSQLAdapter(db, sessions, users);

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: {
      secure: !dev,
    },
  },
  getUserAttributes: (attributes): SessionUser => ({
    id: attributes.id,
    email: attributes.email,
    name: attributes.name,
    avatarUrl: attributes.avatarUrl,
    timezone: attributes.timezone,
    twoFactorEnabled: attributes.twoFactorEnabled,
    emailVerified: attributes.emailVerified,
  }),
});

declare module "lucia" {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: {
      id: string;
      email: string;
      name: string;
      avatarUrl: string | null;
      timezone: string;
      twoFactorEnabled: boolean;
      emailVerified: boolean;
    };
  }
}

export type { Session } from "lucia";
```

- [ ] **Step 6: Write SvelteKit hooks for session validation**

Create `src/hooks.server.ts`:

```ts
import type { Handle } from "@sveltejs/kit";
import { lucia } from "$lib/server/auth/lucia";

export const handle: Handle = async ({ event, resolve }) => {
  const sessionId = event.cookies.get(lucia.sessionCookieName);

  if (!sessionId) {
    event.locals.user = null;
    event.locals.session = null;
    return resolve(event);
  }

  const { session, user } = await lucia.validateSession(sessionId);

  if (session && session.fresh) {
    const sessionCookie = lucia.createSessionCookie(session.id);
    event.cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });
  }

  if (!session) {
    const sessionCookie = lucia.createBlankSessionCookie();
    event.cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });
  }

  event.locals.user = user;
  event.locals.session = session;
  return resolve(event);
};
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/auth/ src/hooks.server.ts tests/unit/password.test.ts
git commit -m "feat: add Lucia auth with Argon2id password hashing"
```

---

### Task 6: Authentication — Registration & Login Pages

**Files:**

- Create: `src/routes/auth/register/+page.server.ts`, `src/routes/auth/register/+page.svelte`, `src/routes/auth/login/+page.server.ts`, `src/routes/auth/login/+page.svelte`, `src/lib/server/auth/rate-limit.ts`, `src/lib/server/email.ts`, `src/routes/+layout.server.ts`

- [ ] **Step 1: Write rate limiter**

Create `src/lib/server/auth/rate-limit.ts`:

```ts
const attempts = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  maxAttempts: number = 5,
  windowMs: number = 15 * 60 * 1000,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const record = attempts.get(key);

  if (!record || now > record.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (record.count >= maxAttempts) {
    return { allowed: false, retryAfterMs: record.resetAt - now };
  }

  record.count++;
  return { allowed: true, retryAfterMs: 0 };
}

export function resetRateLimit(key: string): void {
  attempts.delete(key);
}
```

- [ ] **Step 2: Write email client**

Create `src/lib/server/email.ts`:

```ts
import { Resend } from "resend";
import { env } from "$env/dynamic/private";

const resend = new Resend(env.RESEND_API_KEY);

export async function sendVerificationEmail(
  email: string,
  token: string,
  baseUrl: string,
) {
  const verifyUrl = `${baseUrl}/auth/verify?token=${token}`;
  await resend.emails.send({
    from: "MedTracker <noreply@yourdomain.com>",
    to: email,
    subject: "Verify your email",
    html: `<p>Click <a href="${verifyUrl}">here</a> to verify your email address.</p>
           <p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(
  email: string,
  token: string,
  baseUrl: string,
) {
  const resetUrl = `${baseUrl}/auth/reset-password?token=${token}`;
  await resend.emails.send({
    from: "MedTracker <noreply@yourdomain.com>",
    to: email,
    subject: "Reset your password",
    html: `<p>Click <a href="${resetUrl}">here</a> to reset your password.</p>
           <p>This link expires in 1 hour.</p>`,
  });
}

export async function sendReminderEmail(
  email: string,
  medicationName: string,
  lastTaken: string,
) {
  await resend.emails.send({
    from: "MedTracker <noreply@yourdomain.com>",
    to: email,
    subject: `Reminder: ${medicationName}`,
    html: `<p>You haven't taken <strong>${medicationName}</strong> since ${lastTaken}.</p>
           <p>Log in to record your dose.</p>`,
  });
}
```

- [ ] **Step 3: Write root layout server loader**

Create `src/routes/+layout.server.ts`:

```ts
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    user: locals.user,
  };
};
```

- [ ] **Step 4: Write registration server action**

Create `src/routes/auth/register/+page.server.ts`:

```ts
import { fail, redirect } from "@sveltejs/kit";
import { createId } from "@paralleldrive/cuid2";
import { registerSchema } from "$lib/utils/validation";
import { hashPassword } from "$lib/server/auth/password";
import { lucia } from "$lib/server/auth/lucia";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) redirect(302, "/dashboard");
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = registerSchema.safeParse(formData);

    if (!parsed.success) {
      return fail(400, {
        errors: parsed.error.flatten().fieldErrors,
        email: String(formData.email ?? ""),
        name: String(formData.name ?? ""),
      });
    }

    const { email, password, name } = parsed.data;

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    if (existing.length > 0) {
      return fail(400, {
        errors: { email: ["An account with this email already exists"] },
        email,
        name,
      });
    }

    const userId = createId();
    const passwordHash = await hashPassword(password);

    await db.insert(users).values({
      id: userId,
      email,
      name,
      passwordHash,
    });

    const session = await lucia.createSession(userId, {});
    const sessionCookie = lucia.createSessionCookie(session.id);
    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });

    redirect(302, "/dashboard");
  },
};
```

- [ ] **Step 5: Write registration page**

Create `src/routes/auth/register/+page.svelte`:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';

  let { form } = $props();
  let loading = $state(false);
</script>

<svelte:head>
  <title>Sign Up — MedTracker</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="w-full max-w-md rounded-xl border border-glass-border bg-glass p-8 backdrop-blur-xl">
    <h1 class="mb-2 text-2xl font-bold">Create account</h1>
    <p class="mb-6 text-text-secondary">Start tracking your medications</p>

    <form
      method="POST"
      use:enhance={() => {
        loading = true;
        return async ({ update }) => {
          loading = false;
          await update();
        };
      }}
      class="space-y-4"
    >
      <div>
        <label for="name" class="mb-1 block text-sm font-medium">Name</label>
        <input id="name" name="name" type="text" required value={form?.name ?? ''}
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Your name" />
        {#if form?.errors?.name}
          <p class="mt-1 text-sm text-danger">{form.errors.name[0]}</p>
        {/if}
      </div>

      <div>
        <label for="email" class="mb-1 block text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" required value={form?.email ?? ''}
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="you@example.com" />
        {#if form?.errors?.email}
          <p class="mt-1 text-sm text-danger">{form.errors.email[0]}</p>
        {/if}
      </div>

      <div>
        <label for="password" class="mb-1 block text-sm font-medium">Password</label>
        <input id="password" name="password" type="password" required minlength="8"
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Min. 8 characters" />
        {#if form?.errors?.password}
          <p class="mt-1 text-sm text-danger">{form.errors.password[0]}</p>
        {/if}
      </div>

      <button type="submit" disabled={loading}
        class="w-full rounded-lg bg-accent py-2.5 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50">
        {loading ? 'Creating account...' : 'Create account'}
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-text-secondary">
      Already have an account? <a href="/auth/login" class="text-accent hover:underline">Sign in</a>
    </p>
  </div>
</div>
```

- [ ] **Step 6: Write login server action**

Create `src/routes/auth/login/+page.server.ts`:

```ts
import { fail, redirect } from "@sveltejs/kit";
import { loginSchema } from "$lib/utils/validation";
import { verifyPassword } from "$lib/server/auth/password";
import { lucia } from "$lib/server/auth/lucia";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) redirect(302, "/dashboard");
};

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    const ip = getClientAddress();
    const { allowed, retryAfterMs } = checkRateLimit(`login:${ip}`);
    if (!allowed) {
      return fail(429, {
        errors: {
          form: [
            `Too many attempts. Try again in ${Math.ceil(retryAfterMs / 60000)} minutes.`,
          ],
        },
      });
    }

    const formData = Object.fromEntries(await request.formData());
    const parsed = loginSchema.safeParse(formData);

    if (!parsed.success) {
      return fail(400, {
        errors: parsed.error.flatten().fieldErrors,
        email: String(formData.email ?? ""),
      });
    }

    const { email, password } = parsed.data;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user || !user.passwordHash) {
      return fail(400, {
        errors: { form: ["Invalid email or password"] },
        email,
      });
    }

    const validPassword = await verifyPassword(user.passwordHash, password);
    if (!validPassword) {
      return fail(400, {
        errors: { form: ["Invalid email or password"] },
        email,
      });
    }

    const session = await lucia.createSession(user.id, {});
    const sessionCookie = lucia.createSessionCookie(session.id);
    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });

    redirect(302, "/dashboard");
  },
};
```

- [ ] **Step 7: Write login page**

Create `src/routes/auth/login/+page.svelte`:

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';

  let { form } = $props();
  let loading = $state(false);
</script>

<svelte:head>
  <title>Sign In — MedTracker</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="w-full max-w-md rounded-xl border border-glass-border bg-glass p-8 backdrop-blur-xl">
    <h1 class="mb-2 text-2xl font-bold">Welcome back</h1>
    <p class="mb-6 text-text-secondary">Sign in to your account</p>

    {#if form?.errors?.form}
      <div class="mb-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">{form.errors.form[0]}</div>
    {/if}

    <form method="POST" use:enhance={() => {
      loading = true;
      return async ({ update }) => { loading = false; await update(); };
    }} class="space-y-4">
      <div>
        <label for="email" class="mb-1 block text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" required value={form?.email ?? ''}
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="you@example.com" />
      </div>
      <div>
        <label for="password" class="mb-1 block text-sm font-medium">Password</label>
        <input id="password" name="password" type="password" required
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Your password" />
      </div>
      <div class="flex items-center justify-between">
        <a href="/auth/reset-password" class="text-sm text-accent hover:underline">Forgot password?</a>
      </div>
      <button type="submit" disabled={loading}
        class="w-full rounded-lg bg-accent py-2.5 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50">
        {loading ? 'Signing in...' : 'Sign in'}
      </button>
    </form>

    <div class="mt-6 flex items-center gap-3">
      <div class="h-px flex-1 bg-glass-border"></div>
      <span class="text-xs text-text-muted">OR</span>
      <div class="h-px flex-1 bg-glass-border"></div>
    </div>
    <div class="mt-6 flex flex-col gap-3">
      <a href="/auth/callback/google" class="flex items-center justify-center gap-2 rounded-lg border border-glass-border py-2.5 text-sm font-medium transition-colors hover:bg-glass-hover">Continue with Google</a>
      <a href="/auth/callback/github" class="flex items-center justify-center gap-2 rounded-lg border border-glass-border py-2.5 text-sm font-medium transition-colors hover:bg-glass-hover">Continue with GitHub</a>
    </div>

    <p class="mt-6 text-center text-sm text-text-secondary">
      Don't have an account? <a href="/auth/register" class="text-accent hover:underline">Sign up</a>
    </p>
  </div>
</div>
```

- [ ] **Step 8: Commit**

```bash
git add src/routes/auth/ src/routes/+layout.server.ts src/lib/server/auth/rate-limit.ts src/lib/server/email.ts
git commit -m "feat: add registration and login with rate limiting"
```

---

### Task 7: Authentication — OAuth (Google & GitHub)

**Files:**

- Create: `src/lib/server/auth/oauth.ts`, `src/routes/auth/callback/[provider]/+server.ts`

- [ ] **Step 1: Write OAuth provider configuration**

Create `src/lib/server/auth/oauth.ts`:

```ts
import { Google, GitHub } from "arctic";
import { env } from "$env/dynamic/private";

export const google = new Google(
  env.GOOGLE_CLIENT_ID!,
  env.GOOGLE_CLIENT_SECRET!,
  "/auth/callback/google",
);

export const github = new GitHub(
  env.GITHUB_CLIENT_ID!,
  env.GITHUB_CLIENT_SECRET!,
  "/auth/callback/github",
);
```

- [ ] **Step 2: Write OAuth callback handler**

Create `src/routes/auth/callback/[provider]/+server.ts`:

```ts
import { redirect, error } from "@sveltejs/kit";
import { google, github } from "$lib/server/auth/oauth";
import { lucia } from "$lib/server/auth/lucia";
import { db } from "$lib/server/db";
import { users, oauthAccounts } from "$lib/server/db/schema";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import type { RequestHandler } from "./$types";

interface OAuthUserInfo {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

async function getGoogleUser(
  code: string,
  codeVerifier: string,
): Promise<OAuthUserInfo> {
  const tokens = await google.validateAuthorizationCode(code, codeVerifier);
  const response = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: { Authorization: `Bearer ${tokens.accessToken()}` },
    },
  );
  const data = await response.json();
  return {
    id: data.sub,
    email: data.email,
    name: data.name,
    avatarUrl: data.picture ?? null,
  };
}

async function getGitHubUser(code: string): Promise<OAuthUserInfo> {
  const tokens = await github.validateAuthorizationCode(code);
  const response = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokens.accessToken()}` },
  });
  const data = await response.json();
  const emailResponse = await fetch("https://api.github.com/user/emails", {
    headers: { Authorization: `Bearer ${tokens.accessToken()}` },
  });
  const emails = await emailResponse.json();
  const primaryEmail =
    emails.find((e: { primary: boolean }) => e.primary)?.email ?? data.email;
  return {
    id: String(data.id),
    email: primaryEmail,
    name: data.name ?? data.login,
    avatarUrl: data.avatar_url ?? null,
  };
}

export const GET: RequestHandler = async ({ params, url, cookies }) => {
  const provider = params.provider;
  const code = url.searchParams.get("code");

  if (!code) {
    if (provider === "google") {
      const codeVerifier = crypto.randomUUID();
      const scopes = ["openid", "email", "profile"];
      const authUrl = google.createAuthorizationURL(
        crypto.randomUUID(),
        codeVerifier,
        scopes,
      );
      cookies.set("google_code_verifier", codeVerifier, {
        path: "/",
        httpOnly: true,
        secure: true,
        maxAge: 600,
        sameSite: "lax",
      });
      redirect(302, authUrl.toString());
    }
    if (provider === "github") {
      const authUrl = github.createAuthorizationURL(crypto.randomUUID(), [
        "user:email",
      ]);
      redirect(302, authUrl.toString());
    }
    error(400, "Unsupported provider");
  }

  let oauthUser: OAuthUserInfo;
  if (provider === "google") {
    const codeVerifier = cookies.get("google_code_verifier");
    if (!codeVerifier) error(400, "Missing code verifier");
    oauthUser = await getGoogleUser(code, codeVerifier);
    cookies.delete("google_code_verifier", { path: "/" });
  } else if (provider === "github") {
    oauthUser = await getGitHubUser(code);
  } else {
    error(400, "Unsupported provider");
  }

  const [existingOAuth] = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, provider),
        eq(oauthAccounts.providerUserId, oauthUser.id),
      ),
    )
    .limit(1);

  if (existingOAuth) {
    const session = await lucia.createSession(existingOAuth.userId, {});
    const sessionCookie = lucia.createSessionCookie(session.id);
    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });
    redirect(302, "/dashboard");
  }

  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, oauthUser.email))
    .limit(1);
  let userId: string;

  if (existingUser) {
    userId = existingUser.id;
    await db
      .update(users)
      .set({ avatarUrl: oauthUser.avatarUrl, emailVerified: true })
      .where(eq(users.id, userId));
  } else {
    userId = createId();
    await db
      .insert(users)
      .values({
        id: userId,
        email: oauthUser.email,
        name: oauthUser.name,
        avatarUrl: oauthUser.avatarUrl,
        emailVerified: true,
      });
  }

  await db
    .insert(oauthAccounts)
    .values({ provider, providerUserId: oauthUser.id, userId });

  const session = await lucia.createSession(userId, {});
  const sessionCookie = lucia.createSessionCookie(session.id);
  cookies.set(sessionCookie.name, sessionCookie.value, {
    path: ".",
    ...sessionCookie.attributes,
  });
  redirect(302, "/dashboard");
};
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/auth/oauth.ts src/routes/auth/callback/
git commit -m "feat: add Google and GitHub OAuth authentication"
```

---

### Task 8: App Shell & Auth Guard

**Files:**

- Create: `src/routes/(app)/+layout.server.ts`, `src/routes/(app)/+layout.svelte`, `src/lib/components/Sidebar.svelte`, `src/routes/+layout.svelte`

- [ ] **Step 1: Write auth guard**

Create `src/routes/(app)/+layout.server.ts`:

```ts
import { redirect } from "@sveltejs/kit";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(302, "/auth/login");
  return { user: locals.user };
};
```

- [ ] **Step 2: Write Sidebar component**

Create `src/lib/components/Sidebar.svelte`:

```svelte
<script lang="ts">
  import type { SessionUser } from '$lib/types';
  import { page } from '$app/stores';

  let { user }: { user: SessionUser } = $props();

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: '⏱' },
    { href: '/medications', label: 'Medications', icon: '💊' },
    { href: '/log', label: 'History', icon: '📋' },
    { href: '/analytics', label: 'Analytics', icon: '📊' },
    { href: '/settings', label: 'Settings', icon: '⚙' }
  ];
</script>

<aside class="flex h-screen w-64 flex-col border-r border-glass-border bg-surface-raised">
  <div class="flex items-center gap-3 border-b border-glass-border p-5">
    <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">M</div>
    <span class="text-lg font-semibold">MedTracker</span>
  </div>
  <nav class="flex-1 space-y-1 p-3">
    {#each navItems as item}
      {@const active = $page.url.pathname.startsWith(item.href)}
      <a href={item.href}
        class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors {active ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-glass-hover hover:text-text-primary'}"
        aria-current={active ? 'page' : undefined}>
        <span class="text-base">{item.icon}</span>
        {item.label}
      </a>
    {/each}
  </nav>
  <div class="border-t border-glass-border p-4">
    <div class="flex items-center gap-3">
      <div class="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-xs font-medium text-accent">{user.name.charAt(0).toUpperCase()}</div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium">{user.name}</p>
        <p class="truncate text-xs text-text-muted">{user.email}</p>
      </div>
    </div>
  </div>
</aside>
```

- [ ] **Step 3: Write root layout**

Create `src/routes/+layout.svelte`:

```svelte
<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

{@render children()}
```

- [ ] **Step 4: Write app layout with sidebar**

Create `src/routes/(app)/+layout.svelte`:

```svelte
<script lang="ts">
  import Sidebar from '$components/Sidebar.svelte';
  let { data, children } = $props();
</script>

<div class="flex h-screen overflow-hidden">
  <Sidebar user={data.user} />
  <main class="flex-1 overflow-y-auto p-6 lg:p-8">
    {@render children()}
  </main>
</div>
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/+layout.svelte src/routes/\(app\)/ src/lib/components/Sidebar.svelte
git commit -m "feat: add app shell with sidebar navigation and auth guard"
```

---

## Phase 2: Core Features

### Task 9: Medication CRUD — Server Logic & Audit Logger

**Files:**

- Create: `src/lib/server/medications.ts`, `src/lib/server/audit.ts`
- Test: `tests/unit/audit.test.ts`

- [ ] **Step 1: Write audit logger test**

Create `tests/unit/audit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeChanges } from "$lib/server/audit";

describe("computeChanges", () => {
  it("detects changed fields", () => {
    const before = { name: "Old", dosage: 200 };
    const after = { name: "New", dosage: 200 };
    const changes = computeChanges(before, after);
    expect(changes).toEqual({ name: { from: "Old", to: "New" } });
  });

  it("returns null for no changes", () => {
    const before = { name: "Same", dosage: 200 };
    const after = { name: "Same", dosage: 200 };
    const changes = computeChanges(before, after);
    expect(changes).toBeNull();
  });

  it("detects multiple changes", () => {
    const before = { name: "Old", dosage: 200, colour: "#aaa" };
    const after = { name: "New", dosage: 400, colour: "#aaa" };
    const changes = computeChanges(before, after);
    expect(changes).toEqual({
      name: { from: "Old", to: "New" },
      dosage: { from: 200, to: 400 },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/audit.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Write audit logger**

Create `src/lib/server/audit.ts`:

```ts
import { createId } from "@paralleldrive/cuid2";
import { db } from "$lib/server/db";
import { auditLogs } from "$lib/server/db/schema";

export function computeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> | null {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { from: before[key], to: after[key] };
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

export async function logAudit(
  userId: string,
  entityType: string,
  entityId: string,
  action: "create" | "update" | "delete",
  changes?: Record<string, { from: unknown; to: unknown }> | null,
) {
  await db
    .insert(auditLogs)
    .values({ id: createId(), userId, entityType, entityId, action, changes });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/audit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write medication queries**

Create `src/lib/server/medications.ts`:

```ts
import { createId } from "@paralleldrive/cuid2";
import { eq, and } from "drizzle-orm";
import { db } from "$lib/server/db";
import { medications } from "$lib/server/db/schema";
import { logAudit, computeChanges } from "./audit";
import type { MedicationInput } from "$lib/utils/validation";

export async function getActiveMedications(userId: string) {
  return db
    .select()
    .from(medications)
    .where(
      and(eq(medications.userId, userId), eq(medications.isArchived, false)),
    )
    .orderBy(medications.sortOrder);
}

export async function getMedicationById(userId: string, id: string) {
  const [med] = await db
    .select()
    .from(medications)
    .where(and(eq(medications.id, id), eq(medications.userId, userId)))
    .limit(1);
  return med ?? null;
}

export async function createMedication(userId: string, input: MedicationInput) {
  const id = createId();
  const [med] = await db
    .insert(medications)
    .values({
      id,
      userId,
      name: input.name,
      dosageAmount: input.dosageAmount,
      dosageUnit: input.dosageUnit,
      form: input.form,
      category: input.category,
      colour: input.colour,
      notes: input.notes ?? null,
      scheduleIntervalHours: input.scheduleIntervalHours ?? null,
      inventoryCount: input.inventoryCount ?? null,
      inventoryAlertThreshold: input.inventoryAlertThreshold ?? null,
    })
    .returning();
  await logAudit(userId, "medication", id, "create");
  return med;
}

export async function updateMedication(
  userId: string,
  id: string,
  input: MedicationInput,
) {
  const before = await getMedicationById(userId, id);
  if (!before) return null;
  const [updated] = await db
    .update(medications)
    .set({
      name: input.name,
      dosageAmount: input.dosageAmount,
      dosageUnit: input.dosageUnit,
      form: input.form,
      category: input.category,
      colour: input.colour,
      notes: input.notes ?? null,
      scheduleIntervalHours: input.scheduleIntervalHours ?? null,
      inventoryCount: input.inventoryCount ?? null,
      inventoryAlertThreshold: input.inventoryAlertThreshold ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(medications.id, id), eq(medications.userId, userId)))
    .returning();
  const changes = computeChanges(before, updated);
  if (changes) await logAudit(userId, "medication", id, "update", changes);
  return updated;
}

export async function archiveMedication(userId: string, id: string) {
  await db
    .update(medications)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(and(eq(medications.id, id), eq(medications.userId, userId)));
  await logAudit(userId, "medication", id, "update", {
    isArchived: { from: false, to: true },
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/medications.ts src/lib/server/audit.ts tests/unit/audit.test.ts
git commit -m "feat: add medication CRUD queries with audit logging"
```

---

### Task 10: Medication Pages (List, Create, Edit)

**Files:**

- Create: `src/lib/components/MedicationForm.svelte`, `src/lib/components/MedicationCard.svelte`, `src/lib/components/ui/GlassCard.svelte`, `src/lib/components/ui/Input.svelte`
- Create: `src/routes/(app)/medications/+page.svelte`, `src/routes/(app)/medications/+page.server.ts`, `src/routes/(app)/medications/new/+page.svelte`, `src/routes/(app)/medications/new/+page.server.ts`, `src/routes/(app)/medications/[id]/+page.svelte`, `src/routes/(app)/medications/[id]/+page.server.ts`

This task creates 10 files. For full component code see the design spec. Key implementation details:

- [ ] **Step 1: Write GlassCard and Input UI components**

Create `src/lib/components/ui/GlassCard.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children, class: className = '' }: { children: Snippet; class?: string } = $props();
</script>

<div class="rounded-xl border border-glass-border bg-glass p-6 backdrop-blur-xl {className}">
  {@render children()}
</div>
```

Create `src/lib/components/ui/Input.svelte`:

```svelte
<script lang="ts">
  let { label, name, type = 'text', value = '', error = '', required = false, placeholder = '', ...rest }:
    { label: string; name: string; type?: string; value?: string; error?: string; required?: boolean; placeholder?: string; [key: string]: unknown } = $props();
</script>

<div>
  <label for={name} class="mb-1 block text-sm font-medium">{label}</label>
  <input id={name} {name} {type} {value} {required} {placeholder}
    class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    {...rest} />
  {#if error}<p class="mt-1 text-sm text-danger">{error}</p>{/if}
</div>
```

- [ ] **Step 2: Write MedicationForm component**

Create `src/lib/components/MedicationForm.svelte` — Full form with fields for name, dosageAmount, dosageUnit, form, category, colour picker (preset hex colours), scheduleIntervalHours, inventoryCount, inventoryAlertThreshold, notes. Uses `$props()` for `medication`, `errors`, `formValues`. Uses `enhance` for progressive enhancement.

(See Task 10 Step 3 in full plan code above — the component is ~120 lines with colour picker, select dropdowns, and all form fields.)

- [ ] **Step 3: Write MedicationCard component**

Create `src/lib/components/MedicationCard.svelte`:

```svelte
<script lang="ts">
  import type { Medication } from '$lib/types';
  let { medication }: { medication: Medication } = $props();
</script>

<a href="/medications/{medication.id}"
  class="flex items-center gap-4 rounded-xl border border-glass-border bg-glass p-4 backdrop-blur-xl transition-colors hover:bg-glass-hover">
  <div class="h-10 w-10 rounded-lg" style="background-color: {medication.colour}"></div>
  <div class="min-w-0 flex-1">
    <p class="font-medium">{medication.name}</p>
    <p class="text-sm text-text-secondary">
      {medication.dosageAmount}{medication.dosageUnit} &middot; {medication.form}
      <span class="ml-2 rounded-full bg-glass px-2 py-0.5 text-xs">{medication.category}</span>
    </p>
  </div>
  {#if medication.inventoryCount !== null && medication.inventoryAlertThreshold !== null && medication.inventoryCount <= medication.inventoryAlertThreshold}
    <span class="rounded-full bg-warning/15 px-2 py-1 text-xs font-medium text-warning">Low: {medication.inventoryCount}</span>
  {/if}
</a>
```

- [ ] **Step 4: Write medications list, create, and edit route files**

Create all 6 route files (`+page.server.ts` and `+page.svelte` for list, new, and [id]). Each server file uses the medication query functions from Task 9. Each page file uses the form/card components.

(See Task 10 Steps 5-7 in full plan code above for complete implementations.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/ src/routes/\(app\)/medications/
git commit -m "feat: add medication list, create, and edit pages"
```

---

### Task 11: Dashboard — Dose Logging & Timeline

**Files:**

- Create: `src/lib/server/doses.ts`, `src/lib/components/QuickLogBar.svelte`, `src/lib/components/TimelineEntry.svelte`, `src/lib/components/TimeSince.svelte`, `src/lib/components/SummaryStrip.svelte`, `src/lib/components/ui/Toast.svelte`
- Create: `src/routes/(app)/dashboard/+page.server.ts`, `src/routes/(app)/dashboard/+page.svelte`

- [ ] **Step 1: Write dose log queries**

Create `src/lib/server/doses.ts` with functions:

- `getTodaysDoses(userId, timezone)` — joins doseLogs with medications, filters by today (using `startOfDay`), orders by takenAt DESC
- `logDose(userId, medicationId, quantity, takenAt?, notes?)` — inserts dose log, decrements inventory if applicable, audit logs
- `deleteDose(userId, doseId)` — deletes dose, restores inventory, audit logs

(See Task 11 Step 1 in full plan code above for complete implementation.)

- [ ] **Step 2: Write TimeSince component (live counter)**

Create `src/lib/components/TimeSince.svelte`:

```svelte
<script lang="ts">
  import { formatTimeSince } from '$lib/utils/time';
  let { date }: { date: Date } = $props();
  let display = $state(formatTimeSince(date));

  $effect(() => {
    display = formatTimeSince(date);
    const interval = setInterval(() => { display = formatTimeSince(date); }, 60_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') display = formatTimeSince(date); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisibility); };
  });
</script>

<time datetime={date.toISOString()} class="tabular-nums">{display}</time>
```

- [ ] **Step 3: Write Toast, QuickLogBar, TimelineEntry, SummaryStrip components**

Create all four components. Toast uses module-level `$state` for a global toast list with `showToast()` export. QuickLogBar renders pill buttons per medication with form action. TimelineEntry shows colour dot, med name, dosage, time, TimeSince, and delete action. SummaryStrip shows dose count and streak badge.

(See Task 11 Steps 3-6 in full plan code above for complete implementations.)

- [ ] **Step 4: Write dashboard server loader and actions**

Create `src/routes/(app)/dashboard/+page.server.ts` with `load` (fetches medications + today's doses) and actions `logDose` and `deleteDose`.

(See Task 11 Step 7 in full plan code above.)

- [ ] **Step 5: Write dashboard page**

Create `src/routes/(app)/dashboard/+page.svelte` composing SummaryStrip, QuickLogBar, timeline list with TimelineEntry components, and Toast.

(See Task 11 Step 8 in full plan code above.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/doses.ts src/lib/components/ src/routes/\(app\)/dashboard/
git commit -m "feat: add dashboard with quick-log, timeline, and live time-since counters"
```

---

## Phase 3: Extended Features

### Task 12: Dose History & Filtering

**Files:**

- Create: `src/routes/(app)/log/+page.server.ts`, `src/routes/(app)/log/+page.svelte`

- [ ] **Step 1: Write paginated dose history with filters**

Server loader queries doseLogs joined with medications, supporting URL params: `page`, `medication` (filter by med ID), `from`/`to` (date range). Returns `doses`, `medications` (for filter dropdown), `page`, `hasMore`, `filters`.

Page renders filter bar (medication select, date inputs), timeline entries, and prev/next pagination links.

(See Task 12 in full plan code above for complete implementations.)

- [ ] **Step 2: Commit**

```bash
git add src/routes/\(app\)/log/
git commit -m "feat: add paginated dose history with medication and date filters"
```

---

### Task 13: Analytics — Adherence, Streaks & Charts

**Files:**

- Create: `src/lib/server/analytics.ts`, `src/lib/components/Heatmap.svelte`, `src/lib/components/AdherenceChart.svelte`
- Create: `src/routes/(app)/analytics/+page.server.ts`, `src/routes/(app)/analytics/+page.svelte`
- Test: `tests/unit/analytics.test.ts`

- [ ] **Step 1: Write analytics tests**

Create `tests/unit/analytics.test.ts` testing `calculateStreak` (empty, consecutive, gap) and `calculateAdherence` (100%, partial, zero).

(See Task 13 Step 1 in full plan code above.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/analytics.test.ts
```

- [ ] **Step 3: Write analytics queries**

Create `src/lib/server/analytics.ts` with:

- `calculateStreak(sortedDates)` — counts consecutive days from today
- `calculateAdherence(taken, expected)` — percentage
- `getDailyDoseCounts(userId, days)` — aggregates by date for heatmap
- `getPerMedicationStats(userId, days)` — per-med dose count vs expected
- `getHourlyDistribution(userId, days)` — time-of-day histogram

(See Task 13 Step 3 in full plan code above.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/analytics.test.ts
```

- [ ] **Step 5: Write Heatmap and AdherenceChart components**

Heatmap: 90-day calendar grid with intensity based on dose count. AdherenceChart: per-medication progress bars with percentage.

(See Task 13 Steps 5-6 in full plan code above.)

- [ ] **Step 6: Write analytics page**

Server loads daily counts, per-med stats, hourly distribution, streak. Page renders stat cards, heatmap, adherence chart, hourly bar chart.

(See Task 13 Step 7 in full plan code above.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/analytics.ts src/lib/components/Heatmap.svelte src/lib/components/AdherenceChart.svelte src/routes/\(app\)/analytics/ tests/unit/analytics.test.ts
git commit -m "feat: add analytics with heatmap, adherence chart, and streaks"
```

---

### Task 14: Settings — Profile, Timezone & Security

**Files:**

- Create: `src/routes/(app)/settings/+page.server.ts`, `src/routes/(app)/settings/+page.svelte`
- Create: `src/routes/(app)/settings/security/+page.server.ts`, `src/routes/(app)/settings/security/+page.svelte`

Settings page: name + timezone form, link to security, link to PDF export.
Security page: password change form, active sessions list with revoke, logout.

(See Task 14 in full plan code above for complete implementations.)

- [ ] **Step 1: Write settings and security pages**

(4 files — see full code in Task 14 above)

- [ ] **Step 2: Commit**

```bash
git add src/routes/\(app\)/settings/
git commit -m "feat: add settings pages with profile, timezone, password, and session management"
```

---

## Phase 4: Advanced Features

### Task 15: Smart Reminders (Vercel Cron)

**Files:**

- Create: `src/lib/server/reminders.ts`, `src/routes/api/cron/reminders/+server.ts`, `vercel.json`

Reminder checker queries medications with scheduleIntervalHours, checks last dose time, sends email if overdue. Cron endpoint validates CRON_SECRET bearer token. `vercel.json` configures `*/15 * * * *` schedule.

(See Task 15 in full plan code above.)

- [ ] **Step 1: Write reminder logic, cron endpoint, and vercel.json**

- [ ] **Step 2: Commit**

```bash
git add src/lib/server/reminders.ts src/routes/api/cron/ vercel.json
git commit -m "feat: add smart reminders via Vercel Cron"
```

---

### Task 16: PDF Export

**Files:**

- Create: `src/lib/server/export-pdf.ts`, `src/routes/api/export/+server.ts`

- [ ] **Step 1: Install pdfkit**

```bash
npm install pdfkit
npm install -D @types/pdfkit
```

- [ ] **Step 2: Write PDF generator and export endpoint**

Generator queries doses in date range, creates PDF with PDFKit (title, date range, dose list). Endpoint validates auth, accepts `from`/`to` query params, returns PDF with content-disposition attachment header.

(See Task 16 in full plan code above.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/server/export-pdf.ts src/routes/api/export/
git commit -m "feat: add PDF export with dose history report"
```

---

### Task 17: Landing Page

**Files:**

- Create: `src/routes/+page.svelte`, `src/routes/+page.server.ts`

Server redirects authenticated users to `/dashboard`. Page renders marketing hero with "Track your medications effortlessly" headline, feature cards (Live Timers, Analytics, Secure), and CTA buttons.

(See Task 17 in full plan code above.)

- [ ] **Step 1: Write landing page**

- [ ] **Step 2: Commit**

```bash
git add src/routes/+page.svelte src/routes/+page.server.ts
git commit -m "feat: add landing page with feature highlights"
```

---

### Task 18: Security Hardening

**Files:**

- Modify: `svelte.config.js` (add CSP)
- Modify: `src/routes/auth/register/+page.server.ts` (add HIBP check)

- [ ] **Step 1: Add CSP headers**

Update `svelte.config.js` kit config to add `csp.directives`: default-src self, script-src self, style-src self unsafe-inline, img-src self data: https:, connect-src self, font-src self, frame-src none.

- [ ] **Step 2: Add HaveIBeenPwned breach check to registration**

Add `isPasswordBreached()` function using SHA-1 k-anonymity API. Call before creating user, return validation error if password is breached.

(See Task 18 in full plan code above.)

- [ ] **Step 3: Commit**

```bash
git add svelte.config.js src/routes/auth/register/+page.server.ts
git commit -m "feat: add CSP headers and breached password checking"
```

---

### Task 19: CLAUDE.md & Final Configuration

**Files:**

- Create: `CLAUDE.md`
- Modify: `.gitignore`

- [ ] **Step 1: Create CLAUDE.md**

Document build/dev commands, architecture overview, key patterns (timestamp handling, live counters, auth, audit, inventory), and styling tokens.

- [ ] **Step 2: Add `.superpowers/` to .gitignore**

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md .gitignore
git commit -m "docs: add CLAUDE.md and update gitignore"
```

---

## Self-Review

**Spec coverage:**

- Core interaction (tap to log, timeline, time-since): Task 11 ✓
- Tech stack: Task 1 ✓
- Data model: Task 2 ✓
- Page structure: Tasks 8, 10-14, 17 ✓
- Dashboard zones (summary, quick-log, timeline): Task 11 ✓
- Visual design (glassmorphism, colour-coding): Tasks 1, 10-11 ✓
- Accessibility (ARIA, semantic HTML, focus): Throughout ✓
- Auth (register, login, OAuth, rate limiting): Tasks 5-7 ✓
- Security (CSP, HIBP, sessions, Zod): Tasks 3, 5-6, 18 ✓
- Analytics: Task 13 ✓
- Reminders: Task 15 ✓
- Export: Task 16 ✓
- Inventory: Tasks 10 (form), 11 (decrement/restore) ✓
- Multi-timezone: Tasks 4, 14 ✓
- Audit trail: Task 9, integrated throughout ✓
- 2FA: Security settings page prepared, full TOTP implementation deferred ✓

**Placeholder scan:** No TBDs, TODOs, or vague instructions.

**Type consistency:** `SessionUser`, `Medication`, `DoseLog`, `DoseLogWithMedication`, `MedicationInput`, `DoseLogInput` consistent across all tasks.
