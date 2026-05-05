// Static option lists shared by the medication-form subcomponents.
// `PATTERN_OPTIONS` already lives in `$lib/utils/medication-style.ts`
// alongside the rendering helpers, so it's not duplicated here.

export const PRESET_COLOURS = [
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
  "#f43f5e",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#64748b",
  "#ffffff",
] as const;

export const FORM_OPTIONS = [
  { value: "tablet", label: "Tablet" },
  { value: "capsule", label: "Capsule" },
  { value: "liquid", label: "Liquid" },
  { value: "softgel", label: "Softgel" },
  { value: "patch", label: "Patch" },
  { value: "injection", label: "Injection" },
  { value: "inhaler", label: "Inhaler" },
  { value: "drops", label: "Drops" },
  { value: "cream", label: "Cream" },
  { value: "other", label: "Other" },
] as const;

export const CATEGORY_OPTIONS = [
  { value: "prescription", label: "Prescription" },
  { value: "otc", label: "Over the Counter" },
  { value: "supplement", label: "Supplement" },
] as const;
