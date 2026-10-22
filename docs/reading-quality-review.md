# Reading quality and figure placement review

This review separates source fidelity, translation fidelity, figure placement and interface quality. A readable page or a successful model request does not establish that the scientific interpretation is correct. External projects below were reviewed as documentation; no unfamiliar code was installed or executed.

## Practices worth adapting

- [Paper2Web / Paper2All](https://github.com/YuhangChen1/Paper2All) iterates on content and layout. Its [paper](https://arxiv.org/abs/2510.15842) evaluates connectivity, completeness, presentation and knowledge retention separately. Borrow those separate checks; do not treat the authors' benchmark claims as independent validation of this application. A promotional academic homepage also has a different purpose from private, evidence-bound reading.
- [Study Papers](https://github.com/Loffee5422/study-papers-skill) organizes study around a figure, experiment or argument and distinguishes the question, prediction, observed data and interpretation. This supports concise optional self-checks around an actual source result. It should not force a quiz or a long guided dialogue on readers who chose a quick overview.
- [Scientific Critical Thinking](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/scientific-critical-thinking/SKILL.md) fixes the comparison and sampling unit before appraisal, then locates numerical evidence and its uncertainty. Apply that discipline to responses, questions, routes, benchmarks and repeated samples. Do not apply clinical evidence grades indiscriminately to machine-learning experiments, or convert a checklist into a scientific quality score.
- [Paper Deep Read](https://github.com/dayangxing/Paper-reader-skill) separates orientation, methods and innovation, and checks PDF extraction quality before analysis. Borrow explicit missing-evidence states and progressive depth. Generic parsing heuristics cannot prove that a formula, table or figure was correctly read; visual review and source checks remain separate.

## Concrete failure modes

The original report context builder sampled page prefixes when the source exceeded its character budget. A reader focus was passed to the writer but did not influence source selection. In a long-paper check, this retained a fraction while dropping its operational definition and a late statistical caveat. Adding a request to “be accurate” cannot recover omitted evidence. Focused reports need bounded retrieval of relevant original passages; unrelated source regions must still be described as omitted, not read in full.

For numerical claims, extract the numerator, denominator, unit, comparison and sampling budget before interpretation. A count of responses is not a count of unique strategies or correctly answered questions. A route can be identifiable even when the final answer is wrong. An observation absent from a finite base sample is not a proof that its underlying probability is zero. A confidence bound on one probability and a paired test of a benchmark difference answer different questions; one does not explain the other merely because both concern rare events.

Figure review needs the same available figure identities and captions as generation. Every inserted figure should follow the paragraph about its specific result, before moving to a different experiment. A caption may establish what the authors report, but it does not show the model the pixels. Crop coordinates identify a display region; they do not certify that it is the correct figure. A provided figure description is not necessarily a verbatim source caption. Whole-page previews must not be passed off as extracted figures, and a schematic must not become experimental proof.

Caption translation requires more than matching IDs and preserving numbers. An unchanged Chinese paragraph can pass a JSON schema for an English request. A translation can also preserve a statistic while moving its scope from an overall mean to one task domain. Basic language mismatch checks can reject obvious untranslated prose, while semantic review is still needed for qualifiers, aggregation, uncertainty and which condition a sentence describes. A partial caption failure should retain the completed article and interactive content and permit a caption-only retry.

## Acceptance checks

1. Construct a bounded source packet containing the definition, result, and relevant limitation. Record which pages were supplied and whether they were truncated.
2. Compare generated claims with those passages. Check units, denominators and scope manually; lexical number checks alone are insufficient.
3. Check each figure marker against a real crop and the immediately adjacent explanatory paragraph. Audit the distinction between caption text, a prior unverified model observation and pixels supplied in the current call.
4. Test both translation directions. Include unchanged wrong-language prose and a qualifier that applies to only one of two adjacent sentences. Preserve the original captions and image geometry.
5. Evaluate a short reading separately from a detailed one. More headings or duplicated explanations do not count as better comprehension.
6. Keep failed requests and failed interpretations in the validation record. Use bounded retries and publish no endpoint, key, account identifier, or private source path. The [portable model-validation guide](model-validation-guide.md) describes the isolated workflow.
