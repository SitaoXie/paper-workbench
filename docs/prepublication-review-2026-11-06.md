# Pre-publication review — 2026-11-06

Scope: source distribution and a private GitHub backup. This review does not
approve exposing the running local service publicly or certify model accuracy.

## Fixed in this review

- **High-severity dependency advisories:** updated Multer to 2.5.0 and the
  locked body-parser dependency to 2.4.0. Raised the direct Express/Multer
  minimum versions and retained the lockfile. `npm audit` reports zero known
  vulnerabilities after the update. Advisories:
  [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m),
  [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828).
- **Test data isolation:** an externally supplied `E2E_BASE_URL` now requires
  `E2E_ALLOW_EXTERNAL_SERVER=1`. The default remains a dedicated temporary
  data directory and separate port. The suite mutates data; only disposable
  instances should opt in. Verified that an unapproved external URL fails
  before starting tests.
- Corrected README's outdated context budget and its misleading description
  of provider calls as being made directly by the browser. Recommended
  lockfile-based installation with `npm ci`.
- Added security, contribution, and third-party notices. Added CI with pinned
  action revisions, read-only repository permissions, deterministic tests,
  dependency audit, build, and isolated browser tests.

## Distribution checks

- Scanned all 862 unique blobs reachable from the pre-review Git branches/tags
  for configured secret values, common token/private-key patterns, personal
  workspace identifiers, and runtime-data paths. No matches were found.
  Commit identities use project placeholder addresses. This is a targeted scan,
  not proof that every possible secret format has been detected.
- `.env`, `.local-data`, imported PDFs, provider settings, generated readings,
  screenshots, dependency installations, and build outputs are excluded from
  the tracked source/history reviewed. Do not upload the working directory as
  an unrestricted archive. Custom data directories need their own exclusions.
- The source has an MIT license and independent branding. The optional
  Supervisor-Skills/ARS workflows are external noncommercial dependencies,
  not vendored MIT code. Verified the missing license metadata of `busboy`,
  `streamsearch`, and the pinned `khroma` 2.1.0 source against their license text.

## Validation and remaining work

- **Passed:** 554 unit/API/component tests after dependency updates; fresh
  source-only `npm ci` and production build without personal `.env` or data;
  dependency audit; external-test-server opt-in guard.
- **Public-release blocker — browser regression suite:** the full browser run
  is not green. The bundled Playwright browser was unavailable locally, so a
  second run used installed Chrome against the isolated test server. Before
  stopping repeated stale-selector timeouts, it recorded **21 passed, 8 failed,
  1 interrupted, 432 not run**. No test was removed or marked skipped to hide this.
  The failing areas include subscription handoff, inline-note saving,
  cross-paper chat scroll, and dock controls. Observed stale targets include
  `Question processing mode` / `问答处理方式`, `.paper-card-main`,
  `保存到笔记`, and `管理模型连接`. Migrate the tests to current controls and
  automatic-note semantics, then rerun desktop/mobile and inspect any remaining
  behavioral failures. Missing targets do not establish that the underlying
  features work or fail. CI deliberately retains these checks and can remain red
  until that work is complete.
- **Performance follow-up:** the build reports large JavaScript chunks, including
  the main interface and Mermaid. Measure cold-start and reader interaction on
  lower-end devices before choosing further code splitting.
- **Deployment boundary:** no multi-user authentication or authorization. This
  is acceptable for the documented local-only application, not an internet-facing
  hosted service. Credentials are protected by filesystem permissions, not
  encrypted at rest.
- Live models, paid provider availability, Linux CI execution, and every optional
  external skill were not revalidated in this review. Model-generated readings
  require their own evidence review. Before making the repository public, rerun
  the security/history checks and finish the browser release gate.
