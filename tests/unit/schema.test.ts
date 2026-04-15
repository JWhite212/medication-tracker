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
