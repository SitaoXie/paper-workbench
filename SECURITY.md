# Security

## Supported deployment

Paper Workbench is a single-user application bound to `127.0.0.1`. It has no
account system or API authentication. Keep the server and development server on
loopback. A private GitHub repository does not make a running server private.
Do not expose it through a public reverse proxy, tunnel, or shared workstation
without adding and reviewing authentication and authorization first.

Local processes and users with access to the runtime directory are trusted.
Provider credentials are stored in the untracked runtime configuration, with
restricted filesystem permissions; they are not encrypted at rest. API settings
responses omit keys. Protect `.env`, the data directory, and backups as secrets.
If `DATA_DIR` points outside `.local-data`, exclude that directory from version
control and sharing separately.

## Data sent to external services

Model requests send the selected paper text, images, conversation context, and
prompts to the configured provider. Enabling web search sends search queries to
the selected search provider. URL imports fetch the requested public source.
Optional network proxies and DNS resolvers receive the traffic or hostnames
described in `.env.example`. Review your provider's terms and privacy practices
before processing confidential material.

Imported PDFs, websites, model output, and external-agent results are untrusted
content. The application restricts source URLs, escapes rendered content, and
validates imported structures. These controls are not a guarantee that hostile
documents or prompt injection cannot affect a model's answer. Check important
claims against the original source.

## Reporting vulnerabilities

Use the repository's **Security → Report a vulnerability** feature when private
vulnerability reporting is enabled. If it is unavailable, contact the maintainer
through a private contact listed on their GitHub profile. Do not put credentials,
private papers, conversation logs, or exploit details in a public issue. A public
issue requesting a private reporting channel should contain no sensitive details.

Include the affected commit/version, environment, a minimal synthetic reproducer,
impact, and any proposed fix. Never attach `.env` or `.local-data/store.json`.

## Before distributing a release

- Run `npm ci`, `npm audit`, `npm test`, `npm run build`, and `npm run test:e2e`.
- Scan the current tree **and Git history** for credentials and personal data.
  `.gitignore` does not remove files from past commits.
- Review dependency and optional-skill licenses. The core MIT license does not
  relicense third-party dependencies, externally installed skills, or papers.
- Distribute source/build assets, not a copy of a personal runtime directory.
- State the tested version and known limitations; avoid claiming the software
  is free of vulnerabilities or that model-generated content is verified fact.
