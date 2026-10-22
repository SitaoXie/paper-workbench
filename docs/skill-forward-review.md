# Subscription-session reading: forward workflow review

Date: 2026-10-22. This is a practical local workflow assessment, not a claim of scientific peer review or compatibility certification for every agent client.

## Task and isolation

The reviewer followed `skills/paper-workbench/SKILL.md` and its import reference to produce a Chinese quick overview of empirical results and limitations, a faithful English translation of that exact version, a visually checked source figure crop, and an independently phrased evidence question with a saved answer.

The source was the public 44-page paper [How RL Reshapes LLM Reasoning: Transferability, Coverage, and Scaling Laws](https://arxiv.org/abs/2610.04158). A read-only PDF copy was imported into a separate loopback instance on port 4320, with a fresh temporary `DATA_DIR`, no `.env` loading and no inherited provider configuration. Health reported `modelConfigured: false`. No application `report`, `translate`, `ask` or provider-testing command was used. All reasoning and translation occurred in the current agent session. The production library and its settings were not modified.

Generated JSON, the original PDF, exports and screenshots remain outside the repository. This report deliberately excludes local account details, runtime paths, credentials, full paper text and generated reading contents. No note was requested or created.

## What was actually exercised

The CLI sequence was `health`, local PDF `import`, `source` with page ranges, `export`, `publish`, `readings`, a separate exact-version translation `publish`, `new-session`, `answer`, `get`, `sessions` and `notes`. Relevant pages were read directly rather than adopting an earlier generated report. Page 5 was rendered and visually inspected before selecting a normalized crop containing the chart, axes, model labels and legends; surrounding body text was excluded.

The resulting local state contained one immutable quick reading version with `zh-CN` and `en` caption maps and an English article translation. The displayed figure appears immediately after the quantitative comparison it supports. The answer distinguishes one-shot accuracy from fixed-budget coverage, and separates finite-sampling observations from claims about structural ability. It states the inspected scope and does not claim every proof or benchmark implementation was checked.

Chrome UI verification showed:

- Chinese overview and Chinese figure caption; the lightbox rendered a source crop rather than a full-page replacement.
- Switching to English retained the same reading ID and displayed the English article and caption without a model call.
- An exact source-passage link from both the overview and the imported answer opened PDF page 42 and visibly highlighted the intended source sentence. This verifies location, not the truth of a scientific inference.
- The imported exchange appeared in its own question session and the Questions history category. The note endpoint still returned an empty annotation list.

## Observed failures and friction before changes

| Finding | Evidence and consequence | Required improvement |
| --- | --- | --- |
| A copied follow-up task did not identify its conversation | The actual copied text contained origin, paper ID, question and output language, but no `conversationId`. `answer` without an ID uses the active conversation. Misrouting after a later active-session change is a credible risk inferred from that contract; this review did not intentionally insert an answer into a wrong session. | Bind origin, paper and conversation in the task. Read that exact session and require the answer payload to carry the same ID. |
| The documented CLI could list sessions but not read their messages | `sessions` returned titles, metadata and message counts; `--help` exposed no command to retrieve one session's prior exchanges. A request such as “continue explaining…” therefore lacked a straightforward context-reading step. | Add a read-only `conversation` command with server-enforced paper binding. Reading it must not change the active session. |
| A partial figure list was used as a replacement during this test | The first `source --pages 1-5` response contained three figure entries, while the full export contained six. The reviewer copied the partial array into the replacement field while adding one crop, temporarily removing three unrelated automatic previews from the isolated paper. The skill already warned about replacement semantics; the reviewer did not adequately perform a full-list merge. | Mark partial lists explicitly, and require a complete `get` plus ID-based merge before any figure replacement. The UI/API should make the replacement consequence clear. |
| Source text appeared twice | Ranged `source` output contained both `pages[].text` and the merged `text`, repeating the same evidence in the agent context. | Prefer page-structured content for PDFs; retain a compatible option when merged text is explicitly needed. |
| The imported “Original abstract” was not a clean abstract | It contained title, authors, an email line, the abstract, and a truncated start of the introduction. The reader could mistake a front-page extraction for an exact abstract. | Extract a clearly delimited abstract when possible; otherwise label the content as a source excerpt. Avoid silently presenting guessed boundaries as authoritative metadata. |
| API onboarding devalued an already complete subscription answer | The assistant displayed a complete agent-imported answer while showing “Connect a model API for full answers”, alongside an unconfigured default model name. | Present subscription-session and direct-API routes as distinct usable choices. Label the model selector as unconfigured rather than implying a connected provider. |

The figure-list mistake was repaired by publishing the full exported list merged with the checked crop. Verification then showed six current paper figures, the same single reading version, its unchanged three-figure snapshot, and both saved translation languages. The immutable version was deliberately not rewritten to conceal the mistake.

## Assessment

The core subscription path works: a user with an agent session can read a PDF, save an illustrated bilingual version and answer questions without configuring a separate model API. Separate translation import, source-crop rendering, immutable version binding, source-passage navigation and explicit note creation are useful boundaries.

The remaining work is primarily handoff reliability and truthful onboarding. Successful HTTP writes alone are insufficient: the agent should verify the intended version, target language, source geometry, session identity and unchanged unrelated data. A short overview should expose the evidence and its limits without pretending to be an independent audit.

This is one real paper and one current agent session. It does not test scanned-only PDFs, every extraction layout, a separately installed Claude client, or all subscription plans. The protocol uses ordinary local HTTP and Node CLI commands; it neither extracts login tokens nor promises access beyond the agent session's own limits.

## Reusable acceptance procedure

1. Start an isolated loopback instance with a fresh temporary data directory and no model configuration. Bind every CLI command to that instance explicitly with `PAPER_WORKBENCH_URL`.
2. Import an authorized public PDF. Read relevant original pages and inspect any crop visually. Obtain the complete figure list before replacing or merging figures.
3. Publish one concise reading version. Read the returned version, then separately publish the target-language translation and complete caption map bound to its ID.
4. Create or select a specific question session, inspect its messages, and import an answer with that explicit conversation ID. Switch the active session before saving in a dedicated regression to prove the answer cannot drift.
5. Open the actual UI and check article language, captions, source crop, selected version, passage-location feedback and question history. Confirm the note list is unchanged unless note creation was requested.
6. Keep generated source content and artifacts outside the public repository. Record failures before changing implementation, then rerun the affected steps.

## Focused remediation and recheck

The reproduced handoff issues now have focused fixes: a shared task builder binds every command to the exact workspace origin and paper, fixes the question conversation, and requires reading that conversation before and after the explicit-ID answer save. Concurrent copy attempts on one unsaved draft share one session creation; a failed creation can be retried. Paper/session changes cannot reuse that draft’s target. ReadingTools delegates question preparation to the same application callback; its general reading task uses the shared builder.

The CLI now exposes read-only `conversation <paper-id> <conversation-id>`. Its integration test switches the active session, reads the earlier session without changing active state, imports another answer to the fixed ID, and verifies that the other session remains empty. A different paper cannot retrieve that conversation. The isolated real-paper instance also returned the intended two-message exchange through this command.

Default PDF `source` now returns complete extracted page text once rather than repeating it in merged `text`. `--include-derived` and complete `export` retain the compatible combined form, and web sources without pages keep `text`. Ranged source carries `figuresPartial: true` and a full-list merge warning. A real three-page PDF fixture verifies exact page-text preservation, partial figure IDs, and complete export. Rechecking the isolated paper’s first five pages returned no duplicate text, three partial figures and the merge warning; its annotation count remained zero. The source response also preserves `abstractIsExcerpt` so an agent can distinguish an opening excerpt from an identified abstract.

Five shared-helper tests plus the full CLI integration passed. The TypeScript project check passed. These checks establish binding, state isolation and source-preservation behavior; they do not certify a separately installed agent client or scientific accuracy. A focused Chrome regression also passed on desktop and mobile: both application entry points reuse the fixed conversation, an identical question in another session clears the earlier task preview, and a late creation response cannot copy over another paper or replace its draft. Final onboarding and broad regression remain part of the root UI review.
