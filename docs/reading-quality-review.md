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

## Isolated figure review, 2026-10-22

This check used the public PDFs of [Attention Is All You Need](https://arxiv.org/abs/1706.03762), page 4, Figure 2, and [Deep Residual Learning for Image Recognition](https://arxiv.org/abs/1512.03385), page 5, Figure 4. Both crops were rendered from those PDFs and visually reviewed before being saved through the figure API. The Attention crop contains both titled panels; the residual-network crop contains both plots and their legends, without the neighboring table caption. The submitted images were 490 × 309 and 651 × 212 pixels. A subsequent 4× PDF render was used for human review only; it was not sent to the model.

One configured text model (A) and one explicitly enabled vision model (B) were tested in a separate library. Model names were not used to infer capabilities. There were exactly six upstream calls, all returning HTTP 200, with no retries or schema repair calls. This is a task-specific check, not a model ranking or a scientific validation benchmark.

| Operation | Time | Actual outcome |
| --- | ---: | --- |
| Text-only Attention question, with page 4 and its caption | 4.7 s | Correctly described the two mechanisms and scaling rationale, and identified the figure as a schematic. Provenance recorded no pixels and no prior visual observations. |
| Attention crop analysis by B | 46.8 s | Correctly distinguished left input order Q/K/V from right V/K/Q, recognized the optional mask, concatenation and final projection, and did not claim accuracy or speed measurements. Some wording about complete agreement with the paper was too strong for the supplied page excerpt. |
| Residual-network crop analysis by B | 101.6 s | **Failed curve interpretation.** Panel identities and caption terminology were retained, but several visual claims contradicted the crop and supplied source text; see below. |
| Quick Attention article by A using the saved B observation | 13.4 s | Used exactly the reviewed figure snapshot and its PDF/collection revisions, with one figure marker immediately after the matching mechanism paragraph. Provenance identified only the Attention observation and still recorded `pixelsProvided:false`. The article explicitly called that observation unverified. One statement about missing experimental detail was unsupported. |
| Both original English captions to Chinese, using the bounded caption translator | 2.2 s | Preserved panel identities, 18/34-layer conditions, center-crop validation, and the limitation of the no-extra-parameters statement to this figure. |
| Those Chinese captions back to English | 2.7 s | Retained the same conditions and scope. No figure IDs, page/crop geometry or pixels changed. This small round trip does not establish general translation fidelity. |

The residual-network result is not acceptable as evidence for later synthesis without correction or exclusion:

- It said thin curves generally lie below bold curves in the left plot. In the early and middle portions, the thin training curves are visibly above their corresponding bold validation curves. A blanket ordering is wrong.
- It claimed that the two thin curves in the right plot cross repeatedly in the latter half and cannot be reliably ordered. The red 34-layer training curve is visibly below the cyan 18-layer curve there. The supplied source paragraph also states that the 34-layer residual network exhibits considerably lower training error. Uncertainty language does not make a false crossing claim safe.
- It placed the major drops near 10 and 20 × 10⁴ iterations. The labeled axis places them around 15 and 30 × 10⁴. Approximate curve reading must still respect the axis scale.

The article also described incomplete experimental detail as a property of the paper. Its actual context covered source excerpts: 13,726 characters out of 43,336 source characters. It could correctly say that this request did not include all table details; it could not conclude that the full paper omitted them. The retained evidence observation, correct figure position and working API do not repair that claim.

This pass therefore accepts the tested source binding, text/vision provenance separation, caption scope, and Attention figure placement, but **does not release visual interpretation quality**. The failed residual-network observation was preserved for audit, not used in the Attention report. No second vision model, higher-resolution model rerun, interactive generation, full adversarial researcher/skeptic/editor pipeline, or broader language/figure benchmark was tested in this six-call pass. The next useful check is a bounded comparison that makes the model identify each condition, line style and axis separately, then checks those observations against source text; simply asking it to be more careful is insufficient.

The follow-up prompt revision now requires a panel/metric/trace map before interpreting plots, separates caption-provided semantics from pixel observations, and requires named traces and a visible interval before alleging crossings. Axis changes must be located using the actual ticks and multiplier. Schematics follow a boxes/inputs/arrows path instead of an invented chart schema. Source comparisons are limited to specific supplied statements, not a claim of complete agreement with the paper.

Generation now supplies computed source-coverage metadata to every report role and explicitly distinguishes unavailable input from an author omission. The editor must also reject an unsupported absence claim introduced by the skeptic. Vision receives the length and truncation state of its single-page text packet. Outbound-contract tests cover a hostile caption, a false omission allegation from the mock skeptic, partial versus complete extraction, and the continued unverified status of deliberately wrong mock visual output. These tests confirm prompt delivery and provenance boundaries. At that checkpoint the revised prompts had not yet been retested with a paid model; the bounded follow-up below records the subsequent results. No failed observation has been relabeled correct.

## Prompt and production-resolution follow-up

Four further calls used the same configured text/vision models, request settings, public PDF bytes, crop coordinates, captions and single-page source text as the preceding pass. There were no retries. The first call reused the exact original residual-network PNG to examine a prompt-only change. The next two images were produced by the actual browser `cropPdfToPng` function, with scale `min(4, 1800 / max(cropWidth, cropHeight))`, rather than by enlarging the earlier low-resolution PNGs. The resulting images were inspected before submission. This is a comparison of individual stochastic outputs, not a controlled estimate of either intervention's effect.

| Operation with revised prompt | Submitted pixels | Time | Independently inspected outcome |
| --- | ---: | ---: | --- |
| Original residual-network crop | 651 × 212 | 61.1 s | Still failed. It placed a major change at about 3 × 10⁴ iterations instead of the visible changes near 15 and 30 × 10⁴, and described bold validation traces as more fluctuating than the visibly jagged thin training traces. The earlier repeated-crossing allegation did not recur. |
| Production residual-network crop | 1,734 × 565 | 88.7 s | Correctly located the main changes at 1.5 × 10⁵ and 3 × 10⁵ and described the principal plain/ResNet series ordering. It still called the upper right “18-layer” annotation red; that annotation is cyan. This is an improvement in this sample, not a clean visual-quality pass. |
| Production Attention crop | 1,306 × 823 | 73.4 s | Correctly described both panels' inputs, operation order, optional mask, parallel heads, concatenation and final projection. It did not infer speed or accuracy from the schematic and did not invent a numeric head count from the stacked boxes. A minor Chinese typo and imprecise box-fill description remained. |
| Quick Attention article using only that new observation | No pixels in the text call | 17.9 s | Preserved the reviewed figure snapshot, PDF/collection revisions and observation identity. The marker followed the mechanism paragraph before unrelated experimental findings. It explicitly qualified unavailable details as missing from the supplied text, not omitted by the authors. |

All four requests returned HTTP 200. Only the Attention observation was accepted for the narrow synthesis check after independent inspection; it retained `modelUnverified:true`. The article retained `pixelsProvided:false` and `prior-vision-observations` provenance. Its actual packet covered 13,726 of 43,208 source characters. It acknowledged that boundary instead of repeating the earlier unsupported omission claim. However, its phrase that parsing is suitable “regardless of training-data size” is broader than the abstract's evaluated large and limited training-data settings. It also used a generic abstract citation rather than an exact quotation anchor. Correct figure placement and improved input-boundary wording therefore do not establish full claim or citation quality.

The original source-page text packets were identical across the vision comparisons, and the low-resolution first image was byte-identical to the original. The two production images came from a fresh PDF rendering. Because there is only one output per condition, the observed difference cannot be attributed confidently to resolution or prompt changes alone. This follow-up did not rerun caption translation, another vision model, interactive generation, or the three-role adversarial report. The earlier caption results and failed observations remain part of the record.

The PNG size-limit loop was also inspected without changing the renderer. A successful final encoding returns dimensions for that same canvas. If the eighth encoding is still oversized, the function rejects before returning any image, even though it has created one more smaller canvas. A controlled test of the actual function confirmed both an eighth-encoding success with matching blob/dimensions and an all-eight-oversized rejection with no image returned. Thus the final resize can do unused work but did not produce the suspected successful-response metadata mismatch.

### Containing propagation after independent interface review

Following independent interface review, **new** visual observations are now excluded from later reading and question context until the reader explicitly selects “Use in later readings and answers.” Existing records retain their current inclusion state, including legacy observations without an exclusion flag. Crop review confirms the displayed source region; it does not approve the model's interpretation. Inclusion never clears the observation's unverified status.

The latest-per-figure rule remains: a new excluded observation does not silently revive an older result. Historical observations remain inspectable, but enabling a non-latest observation returns 409. The server also rejects inclusion when the crop or actual PDF bytes no longer match. This is enforced by the API, not only by a disabled interface control. Readers can still inspect or copy an observation without automatically supplying it to another model; taking a note does not enable it. Existing readings and in-flight context snapshots are not rewritten.

HTTP regressions inspect the actual outbound report and question packets before and after explicit inclusion, retain legacy inclusion behavior, verify that a pending latest observation suppresses the older one, and confirm that historical readings remain unchanged. Stale-crop, changed-byte, missing-PDF and non-latest inclusion attempts are rejected. These tests establish propagation controls, **not scientific correctness**. The model errors above remain failures; an included observation is still unverified secondary evidence.

## Deep-reading comparison, 2026-10-25

A comparison of three existing Chinese deep readings with the public alphaXiv AI Overview text found a coverage problem, not merely a formatting problem. The old local readings had short conclusions and caveats, but frequently skipped the intervening mechanism and experimental reasoning. Public overview text was inspected for organization only; no alphaXiv prose or images were copied into the application. New readings were independently written from the locally imported original PDFs in Codex sessions.

| Paper and public reference | Useful structure in the reference | Gap repaired in the local deep reading |
| --- | --- | --- |
| [ResNet](https://www.alphaxiv.org/abs/1512.03385) | Connects the optimization problem, residual block, matched-depth comparisons and shortcut variants, using both mechanism and result figures. | Explains residual notation and dimension changes, plain/residual controls, A/B/C projections, bottlenecks and the different evaluation protocols. Includes the 1,202-layer negative result. |
| [Transformer](https://www.alphaxiv.org/abs/1706.03762) | Relates parallel training to autoregressive inference and pairs the mechanism with benchmark and component comparisons. | Walks through input to output, Q/K/V and scaling, masking, heads and positions. Distinguishes test/dev protocols and interprets non-monotonic head counts and label-smoothing results. |
| [CLIP](https://www.alphaxiv.org/abs/2103.00020) | Connects paired training to language-defined classifiers and heterogeneous transfer evidence. | Explains both directions of the contrastive loss, text-generated classifiers and objective comparisons; separates zero-shot, few-shot, linear-probe and robustness protocols. |

The sources for the new content were [ResNet v1](https://arxiv.org/abs/1512.03385v1), [Transformer v7](https://arxiv.org/abs/1706.03762v7), and the imported ICML version of [CLIP](https://arxiv.org/abs/2103.00020). Citations refer to each local PDF's pages, which need not match the currently hosted alphaXiv revision. In particular, the Transformer v7 abstract/table report 41.8 for English–French while its section 6.1 says 41.0; the reading retains that discrepancy instead of silently choosing one.

| Local Chinese reading | Previous Han characters | New Han characters | Previous/new embedded figures or tables |
| --- | ---: | ---: | ---: |
| ResNet | 580 | 2,379 | 1 / 3 |
| Transformer | 774 | 2,585 | 1 / 2 |
| CLIP | 823 | 2,357 | 1 / 2 |

Counts include Chinese text in Markdown and captions written into the article, excluding separately stored figure captions. These are descriptive before/after measurements, not a quality score or an English/Chinese length equivalence. The local drafts also used selected reading focuses; this is not a controlled model benchmark.

### Contract changes

The shared reading contract is now version 2. Deep reading means a self-contained guided explanation: inspect relevant source sections, explain important steps and notation, interpret a meaningful comparison or ablation, and place figures according to their explanatory roles. It does not impose a fixed figure count or a generic experimental template on every paper. With substantial methods/results available, the planning guide is about 2,000–3,500 Chinese characters or 1,200–2,000 English words. Short sources and explicit reader preferences take precedence over padding.

The earlier universal “concise” skill instruction and API deep-mode 900-word ceiling encouraged compressed outlines. The portable skill, copied agent task and API now share the deeper expectation. The API's reviewer checks source-supported explanatory gaps as well as factual errors; the final editor is told to preserve useful explanations and comparisons. Configured output-token limits remain unchanged. Quick and critical retain their own scope. Copied task instructions select length units from the output language independently of the interface locale.

### Evidence and remaining limits

An independent agent compared all three new readings with the original text and actually viewed their relevant PDF crops. Review led to widening the ResNet bottleneck crop and completing the Transformer output-stage explanation. New versions and their Chinese figure-caption maps were saved through the local API. Exact readback checks preserve all three previous versions for each paper, resolve every figure marker, check citation page bounds and parse all math with KaTeX. These checks supplement source review; they cannot certify scientific correctness by themselves.

A same-provider, same-source, old/new prompt experiment was attempted twice. Both paired attempts failed before producing a response because the configured provider hostname could not be resolved. No successful live API comparison is claimed, and unknown provider usage is not reported as zero. The three completed outputs demonstrate the revised subscription-agent workflow, not every API model's compliance. No browser-based presentation acceptance was performed in this comparison.

Validation completed: 404 unit/integration tests passed, the production build passed, and the skill validator accepted the portable skill. Regression coverage includes Chinese/English output units across interface locales, all three model stages respecting the configured token budget, short-source scoping, and quick/critical isolation. One older test matched the exact wording “at most 250 words”; it was updated to accept the equivalent “within 250 words” while retaining the same bound. Independent saved-data review confirmed all nine old versions unchanged, all seven embedded figure references resolved, and all eighteen figure-caption entries present across the three new snapshots.
