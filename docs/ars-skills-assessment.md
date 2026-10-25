# ARS-Codex integration assessment

Inspected on 2026-10-25. This is a source review and integration recommendation, not a claim that the upstream suite was executed or that its reading quality was measured.

## Provenance and distribution boundary

Repository: [Imbad0202/academic-research-skills-codex](https://github.com/Imbad0202/academic-research-skills-codex), inspected commit `8d6a1f856ee3da9d3a5e2b7f292b3dfe72b592c5`, package version `3.23.1`. Its manifest identifies the vendored ARS source as `Imbad0202/academic-research-skills@4c5449017f46eb64d112a301d4817d22c7c9f3d9`.

The pinned [LICENSE](https://github.com/Imbad0202/academic-research-skills-codex/blob/8d6a1f856ee3da9d3a5e2b7f292b3dfe72b592c5/LICENSE) names Cheng-I Wu and Creative Commons Attribution-NonCommercial 4.0. It is not an MIT dependency. This review imports no upstream prompt text, schemas, scripts, hooks, or templates into Paper Workbench. Do not redistribute an adapted ARS prompt as part of the MIT core without resolving its separate license. An optional handoff to a user's separately installed skill must identify that external dependency and its license; it must not claim that Paper Workbench bundles it.

## Relevant sources and product decisions

All links below are pinned to the inspected revision. The decisions are Paper Workbench proposals, not claims about shipped behavior.

| Inspected source | Useful consideration | Decision for this reader |
| --- | --- | --- |
| [Root router](https://github.com/Imbad0202/academic-research-skills-codex/blob/8d6a1f856ee3da9d3a5e2b7f292b3dfe72b592c5/skills/academic-research-suite/SKILL.md) and [deep-research workflow](https://github.com/Imbad0202/academic-research-skills-codex/blob/8d6a1f856ee3da9d3a5e2b7f292b3dfe72b592c5/skills/academic-research-suite/ars/deep-research/WORKFLOW.md) | Select a relevant workflow and read only its supporting material. Broad research, manuscript writing, and single-paper reading are different tasks. | Keep one-paper overview generation small. Do not start the whole research-to-paper pipeline, study screening, or user-intake process when someone wants to understand a paper. |
| [Method weaknesses](https://github.com/Imbad0202/academic-research-skills-codex/blob/8d6a1f856ee3da9d3a5e2b7f292b3dfe72b592c5/skills/academic-research-suite/ars/shared/references/per_source_method_weaknesses.md) | A limitation may come from the authors or from a reader's analysis; missing source access is another category. | Name who makes the criticism and cite the source or explain its inferred basis. With only an abstract, explain what cannot be assessed; do not invent a methods audit. Keep the prose compact instead of adding a large checklist to every quick overview. |
| [Claim-strength guidance](https://github.com/Imbad0202/academic-research-skills-codex/blob/8d6a1f856ee3da9d3a5e2b7f292b3dfe72b592c5/skills/academic-research-suite/ars/shared/references/claim_strength_ladder.md) | Rewriting can distort scope, uncertainty, direction, or evidential strength even when numbers remain unchanged. | Preserve scientific meaning in both summary and translation: correlation cannot become causation, a null result cannot become success, and cautious findings cannot become universal claims. Over-weakening an established result is also distortion. |
| [Evidence-row protocol](https://github.com/Imbad0202/academic-research-skills-codex/blob/8d6a1f856ee3da9d3a5e2b7f292b3dfe72b592c5/skills/academic-research-suite/ars/shared/references/evidence_row_protocol.md) | An excerpt matching source bytes does not establish that the source supports the interpretation. Unavailable, unexamined, and checked evidence have different meanings. | Preserve Paper Workbench's existing page/passage references and version binding. Describe a working citation as a locator, not a scientific-verification badge. Do not add a second citation schema merely to imitate upstream. |
| [Source verification agent](https://github.com/Imbad0202/academic-research-skills-codex/blob/8d6a1f856ee3da9d3a5e2b7f292b3dfe72b592c5/skills/academic-research-suite/ars/deep-research/agents/source_verification_agent.md) | Verification is separate from writing and can require external evidence. | Recheck claims against the actual paper first. Do not apply a medical evidence hierarchy to a theoretical or systems paper, rank truth by affiliation, or claim external corroboration without actually consulting independent sources. |

## Recommended integration

Use one concise, independently written Paper Workbench reading contract for API prompts and the portable `paper-workbench` skill. Preserve quick/deep/critical style and reader focus. Strengthen the shared contract with limitation provenance, source-access boundaries, and meaning-preserving condensation. Avoid embedding a large external suite into every request.

Provide a documented optional path for users who already have ARS-Codex: read its router, select only the relevant task, then import the resulting overview through Paper Workbench's existing local contract. Preserve the paper ID, version, language, source coverage and actual agent provenance. If the requested external skill is unavailable, report that fact rather than labeling a fallback as an ARS run. Do not require a personal skill directory in application source.

The API path should not claim to execute ARS. No upstream hooks, Python resolver clients, runtime model defaults, provider uploads, or automatic installation are needed. ARS's abstract output-language registry currently documents `zh-tw-en`; it is not a substitute for this application's `zh-CN`/`en` reading and translation contract. Upstream native-model and cross-model evaluation claims do not transfer to our API provider.

## Verification to perform

1. Exercise each overview style through a mocked API and assert that the shared evidence contract reaches every generation/review stage; verify the external-agent route exposes that same contract.
2. Include source fixtures with abstract-only access, author-stated caveats, an inferred methodological concern, a correlation, a negative result, and numerical qualifiers. Evaluate produced text against explicit expected meanings, not only keyword counts.
3. Compare Chinese and English summaries/translations against the same fixed source/version; check that restrictions remain attached to the correct claim and that citations and figure IDs survive.
4. Record which agent/model actually ran and distinguish code-contract tests from live output assessment. Passing prompt tests does not prove scientific quality or upstream-skill compatibility.

This assessment alone does not certify a separately installed Claude client, run the ARS pipeline, or establish improved reading quality.
