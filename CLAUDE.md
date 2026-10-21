# Paper Workbench agent entry point

Read AGENTS.md for repository constraints and README.md for setup.

For paper summaries, illustrated overviews, translations, or questions, read skills/paper-workbench/SKILL.md. Use the current Claude/Codex agent session to reason from source, then save with scripts/paper-workbench.mjs publish or answer. This mode needs no model API configured inside the workbench. The skill also explains optional direct-provider generation when requested.

The portable Node.js CLI reads source pages and exports a local PDF for figure inspection. Credentials remain with the user's logged-in agent; do not copy agent authentication tokens into the application. Preserve source attribution, originals, and unrelated saved figures/translations. Do not publish public comments.
