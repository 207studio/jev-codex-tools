# Hook inventory and reproducible setup

All original native-hook handlers developed for this toolkit are published in [codex-hooks.mjs](../integration/codex-hooks.mjs). [hooks/example.json](../hooks/example.json) maps the six locally used events to that one handler, with Korean status labels. It is a reference for hosts supporting these events, not a universal Codex installation recipe. Loading it does not enable a feature by itself.

| Event / Korean label | Implementation and flags | Actual boundary |
|---|---|---|
| `SubagentStart` / 하위 에이전트 판단 지침 | `codex-hooks.mjs`; `subagent_contract`, optional `visual_enforcement` | Injects the bounded inherited contract. It cannot control a child outside hook coverage. |
| `PreToolUse` / 실행·검증·수집·시각 판단 | `verification-enforcement.mjs`, `collection-enforcement.mjs`, `tool-decisions.mjs`, `visual-enforcement.mjs`; corresponding enforcement flags | Guards recognized command/tool forms before execution. Classification is not host authorization. |
| `PermissionRequest` / 기존 승인 정책 유지 | `codex-hooks.mjs`; `decision_enforcement` or legacy `tool_gate` | With decision enforcement, keeps native policy. Legacy auto-allow is limited to high-confidence read-only classification plus the static `/bin/pwd` or `/usr/bin/true` allowlist. |
| `PostToolUse` / 출력 선별·실행 기록 | `codex-hooks.mjs`, `progress-compaction.mjs`, `visual-enforcement.mjs`, `context-window.mjs`; `tool_gate`, `visual_enforcement`, `instant_compaction`, `progress_compaction`, `prune`, `early_compaction` | Records execution separately. One bounded Jev choice can select repetitive numeric progress for deterministic removal, or the legacy external bridge can be selected. |
| `PreCompact` / 기본 압축 시작 기록 | `codex-hooks.mjs`; `compaction_audit` | Records native compaction and explicitly marks `jev_used: false`. |
| `PostCompact` / 기본 압축 완료 기록 | Same | Records completion; does not rewrite history or replace native compaction. |

## Register only the intended integration

1. Install from the Git clone as described in [README](../README.md). Resolve the installed `jev-codex-hooks` executable to an absolute path.
2. Inspect the handler and the host's supported hook event contract. Replace each placeholder command in a **copy** of the example. The shown shell quoting is a POSIX example; paths containing a single quote require appropriate shell escaping.
3. Add the intended events through the host's supported configuration and trust flow. Merge with existing hooks; do not overwrite other handlers or edit trust hashes. Provide API credentials through the process environment or a secret manager, never in this JSON.
4. Enable only needed flags using `jev-features enable NAME`. Strict shell enforcement also needs `verification_executable` set to the exact installed `jev-verify` path. `decision_executables` can list exact installed Jev adapters; it is a trusted delegation list, not a wildcard bypass.
5. Keep the host's normal approval policy and inspect bounded decisions/actual execution separately. Use `jev-features disable NAME` to turn off one feature, or `disable all` for all saved flags. Clear any `JEV_<FEATURE>_ENABLED=1` environment override as well. Remove only this package's hook entries if unregistering it.

All package flags default to off. A package install does not modify user instructions, native hooks, trust, credentials, permissions, or live processes.

## The 85% setting

When `early_compaction` is enabled, the current adapter reads bounded local token telemetry and uses `early_compaction_start_percent`, default **85**. At or above that measured threshold it lowers the eligible output-size threshold from 8000 bytes to 2000 bytes by default. It does **not** trigger native compaction, shrink the model's configured window, or guarantee that Jev runs before every native compact event. Missing or stale-after-compaction telemetry remains unknown.

Output selection requires `instant_compaction`. Enable `progress_compaction` for the built-in path: Jev sees only progress counts, at most four numeric progress samples, byte counts and the known/unknown exit code. One PRUNE decision with confidence at least 0.9 allows code to omit only complete numeric progress lines. Every other line stays exact and ordered; errors, constraints, recognized secrets, failed commands, uncertain decisions and insufficient savings pass through. Original output is retained privately before feedback is returned. No external prune install or second model call is needed. Disable `progress_compaction` to restore the legacy path, which separately requires `prune` and an explicit `JEV_PRUNE_ENTRY`; disable `instant_compaction` to stop both.

The built-in path writes private metadata to `compaction-status.jsonl`, including why a candidate was retained, and writes selection decisions separately. It never logs the output body there. It preserves the 85% threshold and the existing 8 KB/2 KB eligibility limits. Native conversation compaction remains unchanged.

The handler returns `continue: false` with bounded feedback only after successful selection. The [official hook contract](https://learn.chatgpt.com/docs/hooks#posttooluse) says this changes the model-visible result without rejecting a nested code-mode promise. Hosted tools and specialized paths can bypass local hooks, and this is not a promise to intercept all output or remove original transcripts.

## Better evidence for bounded commands

Effect classification now parses up to eight literal shell commands, including the required `2>&1 | head -c 4000` form. Jev receives program/subcommand/flag names and chain operators, never full commands, argument values, script bodies or executable paths. Unsupported syntax and interpreters remain withheld. New metadata invalidates old classification cache entries; UNKNOWN and native authorization are unchanged.

GPT image generation (`image_gen__imagegen` or `image_gen.imagegen`, exact tool names) is excluded from the visual routing gate. It still follows ordinary tool-effect classification and host policy. Browser/macOS/iOS observation and interaction remain under the visual gate; the exemption is not a claim of pixel verification.

## Other published components

- [Session reader](../skills/jev-session-read/SKILL.md): bounded exact excerpts and pagination.
- [Verification gate](VERIFICATION.md): necessity and result judgments separate from real exit codes.
- [Collection](DATA_COLLECTION.md): bounded sources, protected records, provenance, and cursor reads.
- [Visual control](../VISUAL_CONTROL.md): supplied measurements and finite candidate selection; no pixel claim.
- [Action adapters](../skills/jev-action-control/SKILL.md): Aside, macOS, and iOS Simulator controllers with state/authorization checks.
- [External integrations](INTEGRATION.md): router, prune and gateway bridges; upstream installations are not bundled.

See [security and data handling](../SECURITY.md). None of these hooks intercepts every internal model decision or every hosted tool.
