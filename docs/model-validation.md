# External model validation

Validation date: 2026-10-22 (Asia/Shanghai).

A user-authorized institution-hosted inference service was configured through the local settings API. It provides an OpenAI-compatible Chat Completions interface. No GPU instance was started or allocated. The project has no institutional service dependency.

## Connection and runtime configuration

| Check | Result |
| --- | --- |
| Provider category | Institution-hosted OpenAI-compatible API |
| Model identifier | `dsv4-flash-0731` |
| Direct short question | `计算 2+2，只回答数字。` returned `4` exactly |
| Direct request latency and usage | 0.99 seconds; 14 input and 2 output tokens |
| Application connection test | Passed; returned `Connection successful` exactly in 0.96 seconds |
| Final provider options | Runtime `extraBody: {"chat_template_kwargs":{"thinking":false}}` |
| Final per-response output budget | Runtime `maxOutputTokens: 6144`; source default remains 4096 |
| Final source budget | Runtime `contextChars: 150000`; source default remains 44000 |

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

## Privacy and portability

Credentials and the private endpoint are retained only in ignored local runtime settings. The runtime directory is permission `0700`; the settings file is `0600`. No credentials, private endpoints, document identifiers, personal storage paths, or disposable login parameters are included in source, examples, or this report. The model name and generic generation options above are sufficient to describe the integration without exposing access details.
