# Contributing

Use Node.js 22.13 or newer and install the pinned dependencies with `npm ci`.
Run `npm run dev` for local development. See [README.md](README.md) and
[docs/API.md](docs/API.md) for setup and API behavior.

## Validation

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The default browser suite starts a separate server on port 4319 with a temporary
data directory. It does not load the project's `.env`. Tests create and mutate
synthetic papers, model profiles, and conversations. Never aim them at your
personal library. To use an existing **disposable test instance**, explicitly set
both `E2E_BASE_URL` and `E2E_ALLOW_EXTERNAL_SERVER=1`. This opt-in does not make a
production instance safe for tests.

Keep deterministic tests independent of model credentials and live provider
availability. Record live-provider tests separately, including the model,
observed behavior, and limitations, without retaining secrets or private data.
For UI changes, inspect desktop/mobile and Chinese/English behavior as relevant.

## Changes and reviews

- Explain the user-visible problem and resulting behavior. Include the relevant
  validation and remaining limitations in the pull request.
- Add focused regression tests for bugs; avoid assertions that merely mirror the
  implementation or weaken existing checks to make a test pass.
- Use synthetic fixtures. Keep papers, chat histories, screenshots of personal
  workspaces, provider credentials, and user-specific paths out of commits.
- Preserve independent branding. Do not copy proprietary alphaXiv source/assets
  or vendor external skill code under the core license without checking its terms.
- Keep dependency changes and their lockfile together. Use `npm ci` to verify a
  fresh checkout, and document any new system requirements.

See [SECURITY.md](SECURITY.md) for the trust boundary and vulnerability reporting.
