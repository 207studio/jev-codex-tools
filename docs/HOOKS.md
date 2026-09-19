# Hook inventory and reproducible setup

All original native-hook handlers developed for this toolkit are published in [codex-hooks.mjs](../integration/codex-hooks.mjs). [hooks/example.json](../hooks/example.json) maps the six locally used events to that one handler, with Korean status labels. It is a reference for hosts supporting these events, not a universal Codex installation recipe. Loading it does not enable a feature by itself.

| Event / Korean label | Implementation and flags | Actual boundary |
|---|---|---|
| `SubagentStart` / 하위 에이전트 판단 지침 | `codex-hooks.mjs`; `subagent_contract`, optional `visual_enforcement` | Injects the bounded inherited contract. It cannot control a child outside hook coverage. |
| `PreToolUse` / 실행·검증·수집·시각 판단 | `verification-enforcement.mjs`, `collection-enforcement.mjs`, `tool-decisions.mjs`, `visual-enforcement.mjs`; corresponding enforcement flags | Guards recognized command/tool forms before execution. Classification is not host authorization. |
| `PermissionRequest` / 기존 승인 정책 유지 | `codex-hooks.mjs`; `decision_enforcement` or legacy `tool_gate` | With decision enforcement, keeps native policy. Legacy auto-allow is limited to high-confidence read-only classification plus the static `/bin/pwd` or `/usr/bin/true` allowlist. |
| `PostToolUse` / 출력 선별·실행 기록 | `codex-hooks.mjs`, `visual-enforcement.mjs`, `context-window.mjs`; `tool_gate`, `visual_enforcement`, `instant_compaction`, `prune`, `early_compaction` | Records observed execution separately. Eligible redundant output may be selected through an explicitly installed external prune bridge. |
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

Output selection additionally requires `instant_compaction`, `prune`, and an explicitly configured `JEV_PRUNE_ENTRY`. Failed commands, protected errors/constraints, recognized secrets, unsupported layouts, and insufficiently confident decisions pass through. Original output is retained privately. The external bridge is separately installed and licensed.

## Other published components

- [Session reader](../skills/jev-session-read/SKILL.md): bounded exact excerpts and pagination.
- [Verification gate](VERIFICATION.md): necessity and result judgments separate from real exit codes.
- [Collection](DATA_COLLECTION.md): bounded sources, protected records, provenance, and cursor reads.
- [Visual control](../VISUAL_CONTROL.md): supplied measurements and finite candidate selection; no pixel claim.
- [Action adapters](../skills/jev-action-control/SKILL.md): Aside, macOS, and iOS Simulator controllers with state/authorization checks.
- [External integrations](INTEGRATION.md): router, prune and gateway bridges; upstream installations are not bundled.

See [security and data handling](../SECURITY.md). None of these hooks intercepts every internal model decision or every hosted tool.
