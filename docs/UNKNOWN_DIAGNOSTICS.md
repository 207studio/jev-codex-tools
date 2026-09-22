# Explain uncertain decisions without inventing a verdict

An UNKNOWN can have several causes. Previously the shared choice client returned `null` for absent credentials, an oversized request, HTTP failure, invalid response or transport error. Verification then combined these with low confidence and an explicit Jev UNKNOWN into confidence-zero UNKNOWN. This lost the evidence needed to decide what to investigate next.

The client now keeps fixed diagnostic codes for those boundaries, including HTTP status and the particular response-validation rule. It never logs raw provider error bodies, credentials, original states or prompts. `chooseDetailed` returns the answer and diagnostic separately; existing `choose` and `chooseMany` retain their original answer-or-null contract. Callers may receive metadata through `onDiagnostic`. Each uncertain diagnostic also has a deterministic local Korean `unknown_reason`: `{code, category, label, next_action, source, inferred, display}`. A supported reason-head response is marked `source: "jev"`, `inferred: true`, and `(추정)` in `display`; an explicit UNKNOWN without a supported reason remains unresolved. Transport, API, input-size, response-validation, and low-confidence boundaries are observed runtime causes. Verification preserves and caches this bounded provenance without changing decisions, exit codes, or permissions.

Enable the optional semantic follow-up with `jev-features enable unknown_diagnostics`; disable it with `jev-features disable unknown_diagnostics` or `JEV_UNKNOWN_DIAGNOSTICS_ENABLED=0`. The public default is off. Only an explicit `UNKNOWN` or `INSUFFICIENT` choice (case-insensitive) at or above the caller's confidence threshold can make one follow-up request, and that request contains only the `reason` head. Transport, missing-key, size, schema, and low-confidence results do **not** cause another request. An uncertain or failed follow-up remains `UNKNOWN` and is never retried.

For a valid uncertain model answer, the follow-up asks Jev for one of:

- MISSING_EVIDENCE
- AMBIGUOUS_QUESTION
- CONFLICTING_EVIDENCE
- MISSING_OPTION
- LOW_CONFIDENCE
- UNKNOWN

The production follow-up sends no literal candidates and asks only for the reason head. The older direct `diagnoseUnknown` helper can still opt in to bounded literal proposals for compatible callers; it is not used by `chooseDetailed` or `chooseMany`.

The original choice remains UNKNOWN or low confidence. A reason never creates an action, selector, command, option, or verification result. Verification stores only bounded diagnostic metadata.

There is at most one additional diagnostic request per shared request, with no recursive loop. Diagnosis is limited to 6KB of state, 1KB of instructions, 24 original choices and a maximum 1500ms inside the caller's remaining decision budget. Oversized or sensitive input is withheld rather than silently truncated. The follow-up can itself return UNKNOWN.

Use `jev-judge --file /absolute/path/to/bounded-evidence.txt --question "Does this evidence support the claim?" --details` for an explanation. The default judge output remains YES/NO/UNKNOWN for existing callers. `jev-verify plan` and `run` expose sanitized diagnostics next to the actual process result. When the feature is enabled, private `state/metrics/unknown-decisions.jsonl` records only bounded reason metadata; the compatibility candidate field remains false on these production paths.

Coverage is the toolkit's shared choice adapters and file judge. A separately installed MCP server, external router, Codex's internal reasoning and other providers do not inherit this implementation. The diagnostic request costs an additional bounded API call; no token-saving or accuracy improvement is claimed without a comparable evaluation.

A live synthetic check of the installed Codex file judge on 2026-09-22 used an approval record whose status was not recorded. The original decision stayed UNKNOWN (confidence 0.96); one reason-only follow-up returned MISSING_EVIDENCE (confidence 0.78). The displayed cause was `UNKNOWN · 근거 부족 (추정) — 필요한 정보를 추가`. There were exactly two API requests, zero actions, and the CLI kept its UNKNOWN exit code 3. A separate missing-key check made zero API calls. This is a boundary smoke check, not evidence of general diagnostic accuracy.
