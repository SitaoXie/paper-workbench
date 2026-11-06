# Demo assets

All screenshots and `reading-tour.webm` show the application's own fictional reading exercise. They contain no user papers, API keys, private endpoints or personal conversations. Reading text and answers are prewritten examples, not generated live during recording. Source: `server/demo-workspace.mjs`. These repository-authored sample assets use the project's MIT license.

To reproduce from a clean checkout:

```sh
npm ci
npm run build
npx playwright install chromium ffmpeg
E2E_CHANNEL=chromium node scripts/capture-demo.mjs
```

If Google Chrome is installed, `node scripts/capture-demo.mjs` uses it by default. The script starts its own disposable, empty workspace on an ephemeral loopback port, blocks external browser requests during recording, and removes its temporary data afterward. It never reads `.env` or the normal library. Screenshots cover the guide, bilingual overview with assistant, PDF source highlight, notes and mobile layout. The short WebM tour follows those same interactions without audio.
