# External model validation

Validation date: 2026-10-22 (Asia/Shanghai).

A user-authorized institution-hosted inference service was configured through the local settings API. It provides an OpenAI-compatible Chat Completions interface. No GPU instance was started or allocated. The project has no institutional service dependency.

## Initial integration: connection and runtime configuration

| Check | Result |
| --- | --- |
| Provider category | Institution-hosted OpenAI-compatible API |
| Model identifier | `dsv4-flash-0731` |
| Direct short question | `计算 2+2，只回答数字。` returned `4` exactly |
| Direct request latency and usage | 0.99 seconds; 14 input and 2 output tokens |
| Application connection test | Passed; returned `Connection successful` exactly in 0.96 seconds |
| Initial accepted provider options | Runtime `extraBody: {"chat_template_kwargs":{"thinking":false}}` |
| Initial accepted per-response output budget | Runtime `maxOutputTokens: 6144`; source default remains 4096 |
| Initial accepted source budget | Runtime `contextChars: 150000`; source default remains 44000 |

The initial long-paper requests with default provider options returned an explicit no-text error despite the short connection test passing. Provider-specific thinking was then disabled through the generic runtime options. No institution-specific behavior was added to application source. This demonstrates why a connection test is not enough to validate a long research workflow.

## Public paper and question answering

Source: [How RL Reshapes LLM Reasoning: Transferability, Coverage, and Scaling Laws](https://arxiv.org/abs/2610.04158v1).

- Imported and extracted 44 PDF pages, comprising 120,759 source-text characters.
- The full source representation supplied to the model contains 122,359 characters, including metadata and page markers. All 44 pages are represented; there are no context-truncation markers at the configured budget.
- Chinese question about contributions and limitations completed in 21.00 seconds with `mode: model`, the correct source URL, and a persistent conversation identifier.
- A follow-up challenge completed in 21.75 seconds in the same conversation. The answer corrected an overly broad claim about out-of-domain extrapolation after checking page 11.
- A second boundary-check question completed in 9.26 seconds in the same conversation. It explicitly clarified that the paper does not prove RL cannot create new strategies, and that unseen routes in a finite sample do not establish new strategy support.

Sampled source checks covered the experimental setup and transfer results (pages 3–5), route analysis and sample limitations (page 6), the two-stage policy and theoretical assumptions (pages 7–10), scaling extrapolation and approximation scope (pages 11–12), and LLM-assisted route classification (page 39). The checked central claims were supported after clarification. This was a focused audit, not an exhaustive validation of every generated sentence.

The first answer's extrapolation wording was too strong, and a later answer briefly introduced an unsupported likelihood judgment. Explicit follow-up challenges corrected both. Source-linked model answers remain fallible; multi-role critique and citations do not constitute independent scientific verification.

## Adversarial report audit

The first full-context three-role report returned in 184.02 seconds and recorded all three stages with `coverage: full-text-extracted` and matching `contextCharacters` / `sourceCharacters` of 122,359. **That report was rejected by independent review:** all three stage outputs ended at token limits, and the final stage stopped mid-sentence. The critic also invented an inconsistency between a count out of 100 and the equivalent percentage, which the editor repeated. Successful HTTP status and three recorded stages were therefore insufficient for acceptance.

The implementation now rejects explicit provider token-limit termination and uses shorter role-output guidance, with numerical-equivalence and citation checks before accepting critique. Final revalidation completed successfully after the implementation changes. One immediate connection failure was diagnosed with successful short probes, then a single bounded report retry was made.

| Final report check | Result |
| --- | --- |
| End-to-end report latency | 63.81 seconds |
| Mode | `model-adversarial` |
| Coverage | `full-text-extracted` |
| Source characters / model context characters | 122,359 / 122,359 |
| Recorded stages | `researcher`, `skeptic`, `editor` |
| Stage content lengths | 3,539 / 1,954 / 3,199 characters |
| Completion check | All three stage outputs ended in complete sentences; explicit token-limit responses are rejected by the server |
| Final report persistence | The new complete report replaced the previously rejected report in the local library |

Source spot-checks confirmed the BoxNet coverage figures, route-count change and confidence interval, and the 487/3,840 proportion. The final report correctly treats a count of 34 out of 100 as 34%, and treats differing scaling-fit aggregation as an uncertainty rather than an established numerical contradiction.

**Acceptance is functional, not a claim of perfect scientific interpretation.** The final critique still overstates two issues: a single favorable SFT benchmark does not contradict a claim of broader forgetting, and the paper's own statement about amplifying source-valid strategies should not be conflated with uniform amplification on target prompts. These residual model-interpretation errors are recorded rather than silently edited out of the generated artifact. Multi-role review can introduce errors as well as catch them; users must inspect the cited sources.

## v0.2 integration and independent review

The later reading-workspace validation used the same public paper and four locally configured model profiles. Their identifiers are recorded here for reproducibility; private endpoints, credentials, and institution document links are excluded.

| Live check | Observed result |
| --- | --- |
| `dsv4-pro-0813`, short finite-sampling question | Completed in 5.372 seconds; distinguished unseen among 16 samples from zero support |
| `GLM-5.3-w8a8c8`, same boundary question | Completed in 20.667 seconds with the same qualification |
| `Qwen3.8-27B`, same text question | Completed in 20.767 seconds with the same qualification |
| Pro long report | One immediate connection error, then an explicit 90-second timeout on the bounded retry; short probes still passed |
| `dsv4-flash-0731`, in-place explanation | Completed in 13.728 seconds; an independent browser request also completed in place and appeared in Explanations history |
| Qwen figure 1, initial 938 × 334 crop | HTTP success in 31.906 seconds, but rejected for incorrect categories, missing values and axis ticks, and an overbroad conclusion |
| Qwen figure 1, 1800 × 642 crop | Earlier 90-second attempts timed out. With an explicitly increased 240-second per-request budget, completed in 120.290 seconds and passed independent source comparison |
| Flash full adversarial interactive generation | Completed research/review stages but final structure failed validation after 193.298 seconds; this exposed an incomplete recovery path |
| Flash conversion of a saved article to interactive content | After the recovery changes, succeeded in 29.094 seconds and created a new four-block interactive version without regenerating the article |

The accepted high-resolution figure analysis identified AM–GM, Calculus, and Lagrange separately and read the six values as 0.25/0.69/0.06 before RL and 0.94/0.06/0 after RL. It correctly transcribed the right-hand chart axes and ticks and qualified the illustration as a conceptual mechanism rather than a universal theorem. An independent judge compared those details with a newly rendered source PDF page. This acceptance applies to this sampled result, not to the model generally. The rejected low-resolution record was retained in history and explicitly excluded from future model context.

These runs motivated generic per-profile request timeouts, explicit vision capability, evidence exclusion, bounded schema repair, and preservation of a completed article if the final interactive step fails. Repair attempts are restricted to parse/schema failures; transport failures are not silently retried. Several real requests failed immediately while a subsequent short connection probe succeeded. These remain recorded as intermittent external connection failures; their root cause has not been established.

The later text profile used a 150,000-character source budget and an 8,192-token output budget. Thinking controls remained runtime JSON options. The vision profile used a 2,048-token output budget and a 240-second request timeout. No provider-specific configuration is required by the source code.

### Own-subscription skill workflow

A Codex agent in its already authenticated session read the extracted source and inspected PDF figures, without calling the workbench's configured model API. It produced a Chinese deep reading with eight interactive concept, figure, and self-check blocks. The local CLI imported it as a new immutable version, retaining the original article and source bindings. A second agent independently checked relevant source pages 6, 7, 9, 33–35, 39–40, and 42–44, including a rendered Table 2.

Checks included the mean route change 3.24 → 2.66 and paired-difference confidence interval, the finite-sampling interpretation of 487/3,840 trajectories, distinct Pass@1/256/1024 protocols, the 0/1024 rare-success bound, and the assumptions behind the paper's theoretical claims. The candidate passed this focused audit and was then opened in the app; self-check disclosure, evidence-page navigation, and offline HTML download worked. This demonstrates the own-subscription import path using the current Codex session. Claude compatibility is based on the shared file/CLI contract and was not tested through a separate Claude subscription.

The independent [judge report](judge-v3.md) records UI acceptance and remaining limitations. All generated visual observations retain an unverified label even when one result has passed a focused review.

### Translation acceptance exposed a separate failure

The first real English translation of that Codex reading produced an 8,725-character article with the checked numbers, confidence interval, finite-sample caveats, and page citations preserved. Navigation away and back retained the pending task, and Chinese/English switching subsequently reused the saved article. However, the model returned all eight interactive blocks in Chinese. Their JSON structure and source bindings were valid, so the earlier validator incorrectly accepted them as an English translation. The independent judge rejected this result. A successful article translation does not establish successful translation of the interactive presentation.

The next real retry preserved the article and correctly rejected an invalid interactive result after its one allowed repair. The UI retained the explicit source-binding/structure failure across navigation and kept incomplete cards/export unavailable. The translation implementation was then changed: the model receives only display fields to translate, while the application retains the original card order, types, citations, and figure identifiers. Exact field-list validation and basic Chinese/English mismatch checks still apply. This avoids relying on a model to reproduce immutable source bindings correctly while translating.

The following real retry succeeded through the browser. All eight interactive blocks were in English; three self-check answers were opened and the main numerical and inferential boundaries were independently checked. An API comparison confirmed that the saved English article hash and creation time were unchanged, every original card/source binding was preserved, and the incomplete-translation error was cleared. The real provider result, rather than a mocked response, closed this content failure; deterministic tests separately exercise invalid-field rejection, bounded repair, concurrent requests, and cache reuse.

## Privacy and portability

Credentials and the private endpoint are retained only in ignored local runtime settings. The runtime directory is permission `0700`; the settings file is `0600`. No credentials, private endpoints, document identifiers, personal storage paths, or disposable login parameters are included in source, examples, or this report. The model name and generic generation options above are sufficient to describe the integration without exposing access details.
