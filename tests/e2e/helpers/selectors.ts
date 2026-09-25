// Shared selector strings. Centralised so a single UI rename only needs
// touching this file plus the corresponding component.

export const SEL = {
  emailInput: 'input[name="email"]',
  passwordInput: 'input[name="password"]',
  nameInput: 'input[name="name"]',
  disclaimerCheckbox: 'input[name="disclaimerAcknowledged"]',
} as const;

export const HEADING = {
  login: "Welcome back",
  register: "Create account",
  // The dashboard's h1 is "Today"; the tab title and the nav still say
  // "Dashboard". Match it with { level: 1, exact: true }: "Today" is a
  // substring of "Done today" and "Later today", and the Due section has an
  // h3 "Today" whenever Earlier rows are shown.
  dashboard: "Today",
  medications: "Medications",
  doseHistory: "Dose History",
  analytics: "Analytics",
  addMedication: "Add Medication",
  dataManagement: "Data Management",
} as const;
