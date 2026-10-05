# Selective Jev use

OpenAI's [Astra guidance](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) recommends precise skill triggers, on-demand references, smaller standing instructions and clear completion boundaries. Requiring the same investigation or testing ritual for every task can add unnecessary work. This profile applies those principles without changing the selected model or native permissions.

## What changes

Merge the explicit overrides in [selective-features.json](../examples/selective-features.json) into an existing configuration after backing it up; do not replace the entire configuration. Every package default remains off. The profile retains `decision_enforcement` and `tool_gate`, and adds opt-in `decision_recovery_fastpath`.

That fast path uses the existing shell parser's narrow observation/registered-adapter classification. Recognized calls retain the native policy path without a provider request. Their audit records say `source: policy`, `completed: false`, `choice: unknown`; they are not claimed as Jev decisions or automatic approvals. Unknown syntax, edits and other tools keep the existing classification and provider-failure handling. The tool classifier no longer requests follow-up diagnosis it would discard.

The profile disables:

- Mandatory verification wrapping plus automatic necessity and result assessments. Relevant required tests still run, and real exit codes remain authoritative. Optional uncertain rechecks can explicitly opt in through `jev-verify`.
- Global collection/visual enforcement and automatic UNKNOWN diagnosis. The respective adapters remain available when their workflow is relevant.
- PostToolUse instant/progress/early compaction. These hooks return feedback after the original output and do not prove that native history was removed; the existing implementation can stop the turn. Bound output at its source and retain native compaction. A stored threshold such as 85% is preserved but inactive with early compaction off.

The SubagentStart reminder is shortened. Children receive narrow tasks and relevant constraints, without unconditional per-step Jev calls or coverage inspections. Coverage still needs actual evidence whenever a report claims Jev use.

## Skills and instructions

The four Jev skill roots now state when to activate and link to workflow details. Read those references only for the selected workflow. Session status can use a bounded task summary; long history selection uses `jev-session-read`. Repeated UI control uses `jev-action-control`; a single action does not require an added decision. Five or more fixed-label judgments use `jev-mode`, with record text kept in code rather than agent context. `text_tokens` remains an input-size estimate.

[selective-AGENTS.md](../examples/selective-AGENTS.md) is a ten-line example adapted for the maintainer's Mac, including the pip guard. Preserve other hosts' applicable constraints when adapting it. The shared Jev Mode installation, credentials and Claude Code configuration are not modified.

The optional Jev Mode SessionStart/UserPromptSubmit/SubagentStart reminder example remains inactive and is not added by this change. Existing native hook trust and approval processes remain in force.

## Measurement and rollback

Synthetic tests count provider calls for recognized reads/adapters and check that non-exempt operations still consult the provider. File bytes measure instruction size, not actual model tokens, cached billing or task accuracy. Do not report a savings percentage from these measurements.

On the maintainer's Mac, the scoped suite passed 46/46 tests. A synthetic observation event sent to the installed hook made zero provider calls and returned no permission override. The user AGENTS file decreased from 4,038 to 1,864 bytes (ten lines); the four skill entrypoints decreased from 14,982 to 3,189 bytes in total. Shared Jev Mode files and the native Codex configuration were unchanged. These are bounded local measurements, not real-task accuracy or billed-token results.

Disable `decision_recovery_fastpath` to restore the prior per-tool classification path. Restore the backed-up feature values and skill/instruction files for a full rollback; do not reinstall the shared CLI. A loaded task may retain earlier instructions, so use a new task to assess the complete context reduction.
