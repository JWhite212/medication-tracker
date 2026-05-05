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
  dashboard: "Dashboard",
  medications: "Medications",
  doseHistory: "Dose History",
  analytics: "Analytics",
  addMedication: "Add Medication",
  dataManagement: "Data Management",
} as const;
