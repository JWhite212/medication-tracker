// Form-level error bag. SvelteKit's `fail()` returns a discriminated
// union of error shapes per failure path, which makes
// `form?.errors?.<key>` fail to narrow at the consumer side. Treat
// errors as a record of optional string arrays so each subcomponent
// can read any field by name without TypeScript juggling.
export type FormErrors = Record<string, string[] | undefined>;
