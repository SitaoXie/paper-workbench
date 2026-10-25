# Optional external research skills

Use this reference when the user explicitly selects Supervisor-Skills, ARS-Codex, or both for a Paper Workbench task. The normal workflow remains usable without either suite. This guide describes cooperation with separately available skills; it does not contain their prompt text or execute them through the application's API.

## Select the useful scope

First read [the Paper Workbench reading contract](reading-contract.md). Keep the requested paper, output language, quick/deep/critical style, focus, presentation format, and version/session/task bindings. The output is a reading aid unless the user separately requests manuscript writing, a literature investigation, or a formal review.

| Requested companion | Entry and useful scope | Boundary |
| --- | --- | --- |
| Supervisor-Skills | Confirm the installed skill belongs to [HKUSTDial/Supervisor-Skills](https://github.com/HKUSTDial/Supervisor-Skills/tree/a20d76ef3979b804d7dbf599d577826957e0a8a9). Read only relevant entries: `skills/tech-paper-template/SKILL.md` for understanding a technical paper's problem/method relationship; `skills/benchmark-paper-template/SKILL.md` for benchmark construction and evaluation; `skills/paper-polish/SKILL.md` for faithful wording. Use `skills/pre-submission-reviewer/SKILL.md` only when the requested critical reading benefits from its relevant disciplinary checks. | These are largely authoring and review skills. Do not turn a reader's overview into a manuscript draft, rewrite the paper's contributions, require an Introduction template, or apply empirical checks to a proof without regard to paper type. |
| ARS-Codex | Start at the installed [academic-research-suite/SKILL.md](https://github.com/Imbad0202/academic-research-skills-codex/blob/8d6a1f856ee3da9d3a5e2b7f292b3dfe72b592c5/skills/academic-research-suite/SKILL.md). Follow its router for the actual task, loading only applicable references. For reading quality, useful considerations include limitation provenance, declared source coverage, and preservation of scientific meaning during condensation. | Do not start the full research-to-paper pipeline or study screening for an ordinary paper overview. Its formal abstract locale registry is not this application's multilingual reading contract. If the requested task cannot be supported faithfully by an upstream mode, disclose that limit instead of silently changing the user's language or deliverable. |

When both are selected, use their complementary contributions within one overview: source-grounded structure and explanation, followed by a focused evidence/wording check. Do not generate two competing reports or claim that using two suites provides independent scientific verification. Avoid loading the entire collections. Shared terms such as `deep-research` can refer to unrelated installed skills; verify the package identity instead of selecting by name alone.

## Availability and execution

Locate companions using the current agent environment's available-skills catalog or a user-supplied checkout. Never embed a personal installation path in this project's source or exported task. Read the actual entrypoints before claiming to use them. Repository links identify reviewed sources; they are not an installation command or evidence that a compatible local skill exists.

If a requested companion is missing or its required capability is unavailable, state the missing component. Use the base Paper Workbench contract only as an explicitly disclosed fallback when it can satisfy the user's reading request; never label that output as a run of the missing suite. An explicit request to execute a particular unavailable workflow cannot be satisfied merely by attaching its name to a base overview.

This selection does not authorize global installation, shell hooks, a changed model/provider, new paid services, or unrelated data uploads. Continue reasoning in the current subscription session unless the user selected direct API generation. Keep original paper evidence separate from previous model outputs and retain the actual execution identity. Do not claim external fact-checking, a second model, or human review unless it occurred.

Publish one result using `references/agent-import.md` in the parent skill, preserving the selected style/focus/format and normal import bindings. In the completion message, state which companion entrypoints were actually read and any unavailable parts; set the import's `source.agent` and known `source.model` to the real agent/model, not to a skill name. Do not invent import fields or verification badges for skill provenance. Read back the saved version or conversation as usual.

## License and provenance

Reviewed on 2026-10-25:

- Supervisor-Skills at `a20d76ef3979b804d7dbf599d577826957e0a8a9`: the root [LICENSE](https://github.com/HKUSTDial/Supervisor-Skills/blob/a20d76ef3979b804d7dbf599d577826957e0a8a9/LICENSE) declares CC BY-NC-SA 4.0. Some older skill metadata still names CC BY 4.0; this guide does not use those headers to justify redistribution under MIT.
- ARS-Codex at `8d6a1f856ee3da9d3a5e2b7f292b3dfe72b592c5`: the root [LICENSE](https://github.com/Imbad0202/academic-research-skills-codex/blob/8d6a1f856ee3da9d3a5e2b7f292b3dfe72b592c5/LICENSE) declares CC BY-NC 4.0, copyright 2026 Cheng-I Wu. Package version: `3.23.1`.

These suites are not MIT dependencies or bundled executors. Follow their own terms when obtaining or using them. Paper Workbench's shared contract is independently written project guidance informed by its product requirements and integration review. No upstream prompt, template, schema, or implementation is redistributed here; no endorsement or measured quality improvement is implied by these references.
