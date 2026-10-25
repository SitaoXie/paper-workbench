# Supervisor-Skills reading integration assessment

Reviewed 2026-10-25 against [HKUSTDial/Supervisor-Skills](https://github.com/HKUSTDial/Supervisor-Skills) at commit `a20d76ef3979b804d7dbf599d577826957e0a8a9`. This assessment is a design review of source files, not a claim that the upstream workflows have been executed or that their scientific accuracy has been measured. No upstream script was run and no skill was installed by this review.

## Relevant source material

All paths below are relative to that pinned upstream checkout:

- `skills/tech-paper-template/SKILL.md` and `references/consistency-checks.md`: relationships among the paper's motivation, method and claimed contributions.
- `skills/benchmark-paper-template/SKILL.md`: dataset construction and evaluation need different reading questions from a new algorithm.
- `skills/pre-submission-reviewer/SKILL.md`: adapt evidence checks to research method, including theoretical and qualitative work.
- `skills/paper-writer/SKILL.md`, `references/evidence-discipline.md`, and `references/verification-ladder.md`: distinguish inspected evidence from metadata, avoid invented details, and disclose limitations of same-context review.
- `skills/paper-polish/SKILL.md`: preserve meaning and bounded claims across wording changes and translation.
- `skills/figure-designer/SKILL.md`: distinguish visual inspection from text-only advice.
- `skills/deep-research/SKILL.md`: separate evidence gathering, synthesis and criticism, with retrieval limitations visible.

These are predominantly research-authoring and assessment workflows. Loading the entire suite for a reader's short overview would introduce unrelated manuscript, venue and search tasks.

## Recommended integration

The implementation should use a compact, independently written reading policy shared by application model calls and the external-agent skill. The recommendations below are product requirements, not a copied upstream prompt or a claim that upstream implements Paper Workbench's contract.

| Reading need | Policy behavior | Verification case |
| --- | --- | --- |
| Explain rather than paraphrase section headings | Connect the paper's question to its proposed mechanism and the specific evidence for its conclusion. Keep the main result and caveat readable without forcing a template table. | A method description with no evidence must not become a claim of demonstrated superiority. |
| Match interpretation to paper type | For a benchmark, inspect data construction and measurement; for theory, assumptions and theorem scope; for an empirical study, design and measured outcomes; for qualitative work, material and reasoning. Use a mixed treatment when appropriate. | A theorem paper must not receive an invented complaint that it lacks a benchmark or ablation. |
| Keep quick reads useful | Summarize what the reader learns and why it matters, then the main qualification. Add detail only when needed by the requested focus. | A quick reading must not expand into a manuscript outline or a systematic literature review. |
| Avoid criticism manufactured from incomplete input | Tie a concern to inspected source evidence; distinguish an unsupported draft claim from an alleged defect in the original paper. | Missing pages produce a coverage limitation, not a statement that the authors omitted an experiment. |
| Preserve scientific meaning between languages | Retain qualifiers, comparison conditions, numbers, citations and source-bound figure placement. Separate translation from fresh interpretation. | A bounded association must not become a causal or universal conclusion in translation. |
| Make review status honest | Treat a model critique as a proposed correction; recheck against the source. Report only the verification actually performed. | Sequential roles using one provider must not be labeled independent peer review. |

Existing Paper Workbench prompts already cover source-page citations, units and denominators, finite-sample limitations, checked crop IDs, text-only vision limits and a researcher/skeptic/editor flow. Preserve those protections. The principal additions are genre-aware explanation and one shared contract, rather than a larger volume of boilerplate.

## Rules that should not be imported

- Manuscript drafting routes and automatic handoffs to introduction, rebuttal, venue selection or publishing workflows do not belong in ordinary paper reading.
- A single-paper summary should not trigger mandatory broad literature searches, fixed citation counts or survey corpus quotas. A separate, explicitly requested literature investigation may use those capabilities.
- Upstream stylistic preferences such as word blacklists or punctuation rules are not scientific defects in a source paper.
- Do not assign a severe finding merely because a paper does not follow an upstream narrative template. Evaluate whether the actual evidence supports the actual claim.
- Possessing full text does not support every possible claim. The exact passage, table or image must support the statement being made; availability and inspection are different.
- Abstracts sometimes state exact quantitative results. Such results may be attributed to the abstract without implying that the methods or supporting evidence were inspected.
- Do not reconstruct, recolor or beautify a source figure when the reader asked to inspect the original. Visual improvements to the surrounding UI must preserve source pixels and provenance.
- Prompt text and tests that inspect outgoing prompts do not establish an improvement in model-generated scientific interpretation. A separate controlled reading comparison is needed for that conclusion.

## Licensing and portable distribution

The pinned root `LICENSE` and README declare **CC BY-NC-SA 4.0**. `CHANGELOG.md` records a change from CC BY 4.0 to CC BY-NC-SA 4.0. Several older skill frontmatter fields, including `tech-paper-template`, `benchmark-paper-template` and `pre-submission-reviewer`, still say `CC-BY-4.0`; newer `paper-writer`, `paper-polish` and `deep-research` fields agree with the root declaration. The separate `drawio-reconstruction/LICENSE` is MIT but does not cover the reading skills.

Because of that mismatch and the noncommercial/share-alike terms, this integration must not copy upstream skill text into the MIT application or describe the entire upstream repository as MIT-compatible. The current assessment recommends independently authored application requirements and pinned source attribution; it does not grant rights to redistribute upstream material. Any future vendoring or adaptation of upstream text needs a clear scope and license treatment. The application's own license must not be silently changed.

Optional use of a separately available upstream skill should identify its source and let the external agent follow the applicable terms and environment capabilities. The application must not depend on a developer's personal skill directory, authentication, institution endpoints, or a globally installed package. No upstream code execution, runtime download or model selection is necessary for the shared reading policy.

## Review outcome

Suitable as a methodological reference with explicit adaptation to reading. Not suitable as an unmodified default summary engine. Release acceptance should cover both API and subscription paths, Chinese and English, quick and detailed styles, source coverage, figure placement and evidence-grounded corrections. The review does not certify upstream scientific performance or predict that adding these instructions alone will improve a particular model.
