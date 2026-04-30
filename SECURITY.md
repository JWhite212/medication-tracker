# Security Policy

Medication Tracker is a personal-use portfolio project, but it handles
authentication, encrypted secrets, and personal health data. Security
issues are taken seriously and any credible report will be investigated.

## Supported Versions

Only the latest commit on `main` is supported. There are no long-term
support branches; fixes land on `main` and the deployed app tracks it.

| Branch | Supported |
| ------ | --------- |
| `main` | Yes       |
| Other  | No        |

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for security reports.

Instead, open a private GitHub Security Advisory:

<https://github.com/JWhite212/medication-tracker/security/advisories/new>

Please include:

- A clear description of the issue and its impact
- Steps to reproduce (or a minimal proof-of-concept)
- The commit SHA or deployment URL you tested against
- Any suggested remediation, if you have one

You can expect an initial response within a few days. Coordinated
disclosure is preferred; please give a reasonable window for a fix
before publishing details.

## Security Practices

The application is built with the following defences in mind:

- **Authentication.** Lucia v3 sessions stored in the database and
  validated on every request via `hooks.server.ts`.
- **Password hashing.** Argon2id with per-user salts; passwords are
  never logged or returned from the API.
- **Encryption at rest.** TOTP secrets are encrypted with AES-256-GCM
  using a key sourced from environment variables.
- **Database access.** All queries go through Drizzle ORM with
  parameterised SQL; user-provided `LIKE` patterns are escaped.
- **Authorisation.** Every query is scoped by `user_id`; the client is
  never trusted to supply user context.
- **Rate limiting.** Login, registration, and other auth endpoints are
  rate-limited to slow brute-force attempts.
- **Security headers.** A strict Content Security Policy is applied
  alongside HSTS, `X-Content-Type-Options`, `Referrer-Policy`, and
  related headers.
- **Audit log.** Sensitive create/update/delete operations are recorded
  with JSONB diffs in a server-side audit table.
- **Dependencies.** Kept current; `npm audit` runs as part of routine
  maintenance.

## Out of Scope

The following are not considered in-scope for security reports:

- Rate-limit denial-of-service against the local dev server
- Vulnerabilities in third-party services (Neon, Vercel, OpenFDA, etc.)
- Issues that require a compromised user device or browser extension
- Self-XSS or social-engineering of the reporter's own account
- Missing best-practice headers that have no demonstrated exploit

Thank you for helping keep the project safe.
