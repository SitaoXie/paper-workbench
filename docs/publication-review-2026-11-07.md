# Source publication review — 2026-11-07

Scope: publishing the source repository under its MIT license. This is a local,
single-user research application; publishing its code does not expose a running
service, transfer a personal library, or establish scientific accuracy of AI output.

## Distribution and privacy

- Gitleaks checked all 42 commits reachable from branches and tags: no findings.
- A separate check inspected 969 unique historical blobs for six configured
  credential values and known private workspace identifiers: no matches.
  Credential values themselves were never written to the review or console.
- No runtime database, `.env`, imported PDF, private backup, or key file was found
  in the tracked file history. `.env.example` uses empty values and generic examples.
- The only tracked screenshots and video are reproducible, repository-authored
  examples. They contain a fictional paper, illustrative data and prewritten
  answers, not user papers or conversations.
- GitHub had no release assets, Actions artifacts or issue/PR discussions attached
  to the private repository at the time of this check.

These are targeted checks, not a guarantee that every possible secret or private
detail can be detected. Keep custom runtime directories and backups out of Git.

## License and installation

- The project has an MIT license, recognized by GitHub. Dependency notices are
  recorded in `THIRD_PARTY_NOTICES.md`; installed license text covers the three
  missing lockfile license entries.
- Optional external research skills are separately installed, not vendored or
  required for API generation. Their noncommercial terms remain independent of
  this project's MIT license. Imported papers retain their own rights.
- A clean `git archive` checkout without `.env` or personal runtime data passed
  `npm ci` and the production build. The sample does not need an API key.
- `npm audit --audit-level=high` reported zero known vulnerabilities.

## Validation

- Unit/API/component suite: **577 passed**, zero failures or skips.
- Production TypeScript/Vite build: passed. Existing large-chunk warnings remain.
- Complete desktop/mobile browser suite: **472 passed**, zero failures, and
  **2 existing viewport-specific skips** out of 474 cases (8.9 minutes).
  No tests were removed or newly skipped for this publication review.
- The prior review's browser failures were repaired, including real mobile
  navigation overflow and duplicate history-to-note saving. Independent browser
  checks of onboarding, the sample, navigation and actual backup/restore are
  documented in [the implementation validation](validation-2026-11-07.md).

## Remaining boundaries

The server binds to loopback and has no multi-user authentication. This review
approves source distribution, not exposing the service through a public tunnel
or hosting it for multiple users. See [SECURITY.md](../SECURITY.md).

Provider availability, live model capabilities and AI answer accuracy are not
certified by fixture tests. Portable backups have documented size limits and
exclude model credentials/settings; use the stopped-service backup procedure
for full configuration rollback. Browser coverage is Chrome desktop/mobile
emulation, not every physical device or browser.

The private repository's hosted CI runs did not start because of an account-level
restriction. Local results are reported separately; a successful Linux Actions
run is not claimed here. Performance work on large JavaScript bundles remains a
follow-up, not a known source-publication blocker.

## Decision

No blocking issue was found for publishing this source repository as an MIT-licensed
development project. The earlier browser release gate is closed by the complete
run above. The deployment and validation limits still apply.
