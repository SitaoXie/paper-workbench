# Onboarding, portable library and zero-key demo validation

This change adds a dismissible first-run guide, actionable model connection diagnostics, portable backup/restore, and a read-only sample workspace. It also updates browser fixtures to the current library, model selector, subscription handoff and automatic note-saving behavior. The repository remains private.

## Verified behavior

- The English/Chinese guide opens without model calls and can be dismissed or reopened. Connection probes run only on an explicit click, explain possible API usage, distinguish common failures, and do not claim that a text probe proves vision, streaming or tool support.
- The sample has its own `/api/demo/*` namespace, a synthetic three-page PDF, quick/deep bilingual readings, a prewritten conversation and a source-linked note. Desktop and mobile checks exercise language/version switching, PDF citation highlighting, note viewing, folder navigation and returning to the personal library. No mutating requests or personal API requests were observed during sample reading. Its server rejects writes and never falls through to personal routes.
- Portable export/restore validates relationships, file checksums, sizes and paths. Restore previews counts, requires explicit confirmation, adds copies with remapped IDs, and preserves existing data and settings. Tests cover malformed archives, path/symlink defenses, legacy records, failed saves, rollback and concurrent edits.
- An independent browser check used a real disposable server with **no API mocks**: upload the sample PDF, create a note, download a backup, preview and confirm restore, then reload the restored PDF and note. PDF bytes matched; IDs were remapped; the original remained; there were no model calls or page errors. Only that check's own fixture records were removed afterward.
- Independent visual checks covered English desktop and Chinese mobile/dark layouts for the guide, sample and backup dialog. Screenshots and the short video in `docs/assets/` use only repository-authored example content. `scripts/capture-demo.mjs` reproduces them with an isolated server/browser.
- Regression work found that saving an already autosaved reading activity from history could create a duplicate note. It now checks current annotations before creating a new one, preserving the existing source geometry. A unit test and real-backend browser regression cover this.

## Local checks

- `npm test`: **577 passed**, zero failures/skips.
- `npm run build`: passed. Vite still reports existing large lazy chunks; this is a size warning, not a build failure.
- `npm audit --audit-level=high`: zero vulnerabilities reported.
- Gitleaks scan of publishable sources and demo assets: no findings. Runtime files and `.env` remain ignored; `.paperwork` backups are now ignored too. Backups contain private prose and are not anonymized.
- README/guide/API local links: 50 checked, none missing.

The complete desktop/mobile browser sweep ran **474 cases**: 469 passed, 2 existing viewport-specific skips, and 3 mobile failures. Two failures initially involved stale test synchronization/ambiguous navigation selectors. The third exposed a 4-pixel compact-toolbar regression; the source badge spacing was corrected without reducing interactive hit areas or relaxing the geometry assertion. Fixing the navigation selector also exposed a real overflow bug: adding Guide and Backup pushed Models offscreen. The main mobile menu now scrolls independently while bottom settings remain visible, with regression assertions for scrolling, stable settings placement and touch target size.

The final focused rerun passed **54/54**, covering `notebook-segments`, `overview-compact`, `ui`, `onboarding-demo`, `workspace-backup`, and `workspace` on desktop and mobile. No new skips were added. This is a complete sweep followed by focused verification of the fixes, not a claim that a single final 474-case run was all green.

An independent judge then used the actual isolated app in Chinese and English at **390×844 and 390×667**. Import remained reachable by scrolling; Backup, Guide, Models and Theme were unobstructed and worked when tapped. Main action targets were 59×57 pixels and Theme was 44×44. No page errors were observed.

## CI and limits

The workflow discovers all `*.spec.ts` files automatically and uploads browser reports, screenshots and traces on success or failure. Earlier GitHub runs failed **before starting a runner** because of the account's billing/spending-limit state. Workflow edits cannot repair an account billing restriction. Local Chrome checks do not substitute for a successful Linux GitHub Actions run; that remains to be verified once Actions can start.

No live model capability or provider billing claim was inferred from fixture tests. The zero-key sample is deliberately prewritten and read-only. Portable archives currently cap total PDF/image bytes at 75 MiB; use the documented stopped-service full backup for larger libraries or an exact configuration/usage rollback. Passing these checks does not establish absence of all bugs.
