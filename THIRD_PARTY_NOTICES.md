# Third-party notices

The project source uses the MIT license in [LICENSE](LICENSE). Dependencies and
external materials keep their own licenses. Installing through `npm ci` uses the
versions recorded in `package-lock.json`; preserve dependency license and notice
files when redistributing bundled software.

## Main runtime components

| Component | License | Role |
| --- | --- | --- |
| React / React DOM | MIT | Interface |
| PDF.js (`pdfjs-dist`) | Apache-2.0 | PDF viewing and text extraction |
| `pdf-lib`, `pdf-parse`, `@napi-rs/canvas` | MIT | PDF and image processing |
| Mermaid, KaTeX | MIT | Diagrams and mathematics |
| `lucide-react` | ISC | Interface icons |
| Express, Multer, Cheerio | MIT | Local HTTP server and document import |
| `react-markdown`, remark / rehype / micromark packages | MIT | Markdown processing |
| Undici | MIT | HTTP client |

This is a guide to major components, not a replacement for each installed
package's license. The lockfile includes transitive dependencies. Its missing
SPDX entries for `busboy` and `streamsearch` are covered by the MIT license text
in those packages. `khroma` 2.1.0's MIT license is available in its
[versioned upstream source](https://github.com/fabiospampinato/khroma/blob/4968165afb0d3d09be66497e7985a34f7bfe6d42/license).
The development dependency `caniuse-lite` uses CC-BY-4.0; retain its attribution
when redistributing its dataset. Browser downloads and native dependencies may
include their own additional notices.

## External skills and papers

Supervisor-Skills and ARS-Codex are optional, separately installed tools with
noncommercial license terms. They are not bundled in this repository or required
by API generation. Consult the pinned assessments and
[external-skill guide](skills/paper-workbench/references/external-skills.md)
before using or redistributing them.

Imported papers, figures, generated readings, and user annotations are runtime
data, excluded from this source distribution. Their rights do not become MIT
merely because this application stores or displays them.

Paper Workbench is an independent project inspired by research-reading
workflows. It is not affiliated with alphaXiv or Zotero. Their names identify
references in design studies; proprietary source, logos, and application assets
are not bundled.
