# Verification before verification

`jev-verify` addresses two different questions:

1. Is this proposed verification worth attempting now?
2. Does the observed evidence support the stated goal?

Both are finite Jev decisions. The command's real exit status, permissions, and required checks remain code-enforced facts. A favorable model judgment is not a replacement for running a test that is required to establish behavior.

## Commands

```sh
jev-features enable verification_gate
jev-features enable verification_assessment
jev-verify plan --spec examples/verification.json
jev-verify run --spec examples/verification.json --execute
jev-verify assess --spec examples/verification.json --log /path/to/saved.log --exit-code 0
```

The example is intended to run from the repository root. Relative `cwd` is resolved against the invoking process's working directory. The spec names an exact command as an argv array, an optional narrower argv array, the file scope, the goal, and constraints. Plan does not execute. Run executes only with `--execute`; it asks the gate before spawning a command without a shell. It never executes a command written by Jev.

## Necessity decision

Jev returns RUN, NARROW, SKIP, or UNKNOWN. Only a confident decision over a complete declared low-risk optional scope can permit skipping. Mandatory checks, high or normal risk, new failures, missing or oversized input files, and uncertainty cannot silently become SKIP. NARROW requires a command already supplied by the caller. Mandatory checks keep the original command even if Jev recommends narrowing it or is unavailable.

The fingerprint covers the declared file bytes and command/spec. Repeated decisions use a 120-second cache, including an UNKNOWN fallback after uncertainty or API failure. This avoids immediately asking Jev the same question again between plan and run; UNKNOWN never becomes approval to skip a required check. A changed fingerprint invalidates that cached decision. This is **not automatic dependency discovery**: include relevant configuration, fixtures, and dependencies, and do not claim the scope is complete when it is not.

Group closely related checks in one plan. Parsing, fingerprint calculation, and reading exit codes or existing cache entries are deterministic code operations; they do not each need a separate Jev call. After execution, the new execution history must be considered before reusing an earlier necessity decision.

If Jev is unavailable or unsure, the authorized run falls back to the closest caller-provided verification command. Turning the feature off also preserves ordinary execution; it does not make every check a pass.

## Evidence decision

The process writes its full output to a private local log. Only bounded tail evidence and status metadata are supplied to Jev. The response separates:

- `necessity`: what Jev recommended and what the policy allowed;
- `execution`: whether anything ran, the real exit code, and the log path;
- `assessment`: SUPPORTED, CONTRADICTED, or INSUFFICIENT about the goal.

A skipped check has no execution success. A nonzero exit cannot be promoted to a passing execution by a SUPPORTED judgment. Timeout, missing evidence, and uncertain assessment must remain visible. A short tail can omit information; do not claim the whole system was verified from it.

## Limits and privacy

The CLI governs invocations routed through it. It does not automatically intercept every Codex Desktop verification, reread, browser inspection, or native tool call. Optional skill and agent instructions help route those attempts into the gate; host permissions are unchanged.

Jev receives bounded task/goal, command and file metadata, and bounded result evidence. Secret masking is best effort. Private full logs can still contain sensitive data; keep runtime files out of Git.

This feature aims to avoid unnecessary repeated verification. It does not establish that over-verification is the main cause of token use for any model, or that this implementation achieves a specific reduction.

## Observed validation

The final focused suite completed with 17 passed, zero failed, and exit code 0. Live Jev necessity returned UNKNOWN, so the mandatory check retained its original command; run reused the cached UNKNOWN without a second necessity request. The separate evidence assessment fell back to INSUFFICIENT. No extra run was triggered solely to obtain a more favorable model assessment. Tests cover skip restrictions, uncertainty caching, file changes, execution status, and relative working directories; they do not establish general token savings or full toolkit compatibility.
