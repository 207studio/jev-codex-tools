# Explain uncertain decisions without inventing a verdict

An UNKNOWN can have several causes. Previously the shared choice client returned `null` for absent credentials, an oversized request, HTTP failure, invalid response or transport error. Verification then combined these with low confidence and an explicit Jev UNKNOWN into confidence-zero UNKNOWN. This lost the evidence needed to decide what to investigate next.

The client now keeps fixed diagnostic codes for those boundaries, including HTTP status and the particular response-validation rule. It never logs raw provider error bodies, credentials, original states or prompts. `chooseDetailed` returns the answer and diagnostic separately; existing `choose` and `chooseMany` retain their original answer-or-null contract. Callers may receive metadata through `onDiagnostic`. Verification preserves actual low-confidence observations separately, retains explicit UNKNOWN/INSUFFICIENT confidence, and caches these facts for the plan/run pair. Required checks, exit codes and host approval rules remain unchanged.

Enable the optional semantic follow-up with `jev-features enable unknown_diagnostics`; disable it with `jev-features disable unknown_diagnostics` or `JEV_UNKNOWN_DIAGNOSTICS_ENABLED=0`. The public default is off. Transport, missing-key, size and schema failures do **not** cause another semantic request.

For a valid uncertain model answer, the follow-up asks Jev for one of:

- MISSING_EVIDENCE
- AMBIGUOUS_QUESTION
- CONFLICTING_EVIDENCE
- MISSING_OPTION
- LOW_CONFIDENCE
- UNKNOWN

Code extracts at most eight exact short labels from the original bounded state, with JSON paths. The same request asks Jev whether one of those literals supplies a missing option. Only a supported MISSING_OPTION and a supported candidate (both confidence >=0.7) return `proposed_option`. Code rechecks that the literal still exists at the original path. This discovers a previously unoffered answer from evidence; it is not free-form text generation.

The original choice remains UNKNOWN or low confidence. A proposed label is evidence for a caller to refine its schema, never an automatically accepted action, selector, command or verification result. Verification reports only whether a proposal exists, to avoid echoing unrelated raw text. The judge's `--details` output can include a fresh literal proposal; its cache retains only bounded diagnosis metadata, not the proposed source text.

There is at most one additional diagnostic request per shared request, with no recursive loop. Diagnosis is limited to 6KB of state, 1KB of instructions, 24 original choices and a maximum 1500ms inside the caller's remaining decision budget. Oversized or sensitive input is withheld rather than silently truncated. Missing evidence and unavailable candidates remain unresolved. The follow-up can itself return UNKNOWN.

Use `jev-judge --file /absolute/path/to/bounded-evidence.txt --question "Does this evidence support the claim?" --details` for an explanation. The default judge output remains YES/NO/UNKNOWN for existing callers. `jev-verify plan` and `run` expose sanitized diagnostics next to the actual process result. When the feature is enabled, private `state/metrics/unknown-decisions.jsonl` records only reason metadata and whether a candidate was proposed.

Coverage is the toolkit's shared choice adapters and file judge. A separately installed MCP server, external router, Codex's internal reasoning and other providers do not inherit this implementation. The diagnostic request costs an additional bounded API call; no token-saving or accuracy improvement is claimed without a comparable evaluation.

A live synthetic check on 2026-09-20 supplied `observed_category: DEFER` with only ALLOW/DENY/UNKNOWN options. The original result stayed UNKNOWN (confidence 1); the follow-up returned MISSING_OPTION (confidence 0.98) and the exact `DEFER` literal at `$["observed_category"]`. It used two requests and executed zero actions. Other real calls still produced low confidence or an unresolved diagnosis; those outcomes were retained, not counted as passing judgments.
