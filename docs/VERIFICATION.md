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

## Optional execution enforcement

`verification_enforcement` adds a strict PreToolUse guard for shell tools. Install the handler through the host's supported hook trust flow, set `verification_executable` in the features file to the absolute path of the installed `jev-verify` executable, and enable `verification_gate`, `verification_assessment`, and `verification_enforcement`. The source checkout's absolute `bin/jev-verify.mjs` path is also recognized. Keep host permissions in place.

The guard permits a narrow set of literal observation commands and exact wrapper invocations. Direct tests, builds, lint, interpreters, unknown programs, command substitution, and unsupported shell syntax are denied before execution. Pipelines and compound commands are checked command by command; mentioning `jev-verify` in a string does not exempt another command. Unknown scripts must use an explicit verification spec rather than another shell to evade the guard. This strict mode can also block non-verification scripts because their behavior is not statically established.

Use the registered absolute executable path for `plan`, `run --execute`, and `assess`. A bare command name is not enough. The hook never returns an automatic permission grant: allowed calls continue through normal host policy. Denied calls do not run a command inside the hook and cannot cause duplicate execution. Syntax enforcement is local code; the wrapper still asks Jev about necessity and evidence. Disabling `verification_enforcement` in the features configuration restores the prior hook behavior.

This covers hook-visible shell calls, including nested code-mode `exec_command` calls on hosts supporting the native contract. Existing interactive processes and `write_stdin`, hosted tools, browser/MCP operations, and specialized hook-exempt paths are outside this shell guard. Hooks are not an OS sandbox or a tamper-proof boundary; missing, disabled, untrusted, or host-skipped hooks cannot enforce this policy. Do not equate configured source with an observed live denial.

## Limits and privacy

The CLI governs invocations routed through it. The optional native guard forces covered shell execution into that path, while skill and agent instructions cover the remaining workflow. It does not automatically intercept every Codex Desktop verification, reread, browser inspection, or native tool call; host permissions are unchanged.

Jev receives bounded task/goal, command and file metadata, and bounded result evidence. Secret masking is best effort. Private full logs can still contain sensitive data; keep runtime files out of Git.

This feature aims to avoid unnecessary repeated verification. It does not establish that over-verification is the main cause of token use for any model, or that this implementation achieves a specific reduction.

## Observed validation

The focused suite completed with 32 passed, zero failed, and exit code 0. Jev necessity returned UNKNOWN, so the mandatory check retained its original command; run reused the cached UNKNOWN without a second necessity request. Jev assessed the suite evidence as SUPPORTED at confidence 0.93. Tests cover skip restrictions, uncertainty caching, file changes, execution status, shell syntax, wrapper bypass attempts, and native hook response handling.

On the active Codex Desktop task, a harmless direct `node --test` call through code-mode `exec_command` was rejected by the native PreToolUse hook before execution. The same sentinel then completed with exit code 0 through the registered absolute wrapper. That separate sentinel's evidence assessment remained INSUFFICIENT; it was not repeated to seek a favorable label. This demonstrates the covered shell path on the observed host, not universal hook coverage, token savings, or full toolkit compatibility.
