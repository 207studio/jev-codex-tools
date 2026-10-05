# Jev Mode for Codex

[Jev Mode](https://github.com/ddfeyes/jev-mode/tree/97615aa5cc14586488c11f6644a5b845827234c6) is a separate MIT project. This repository provides an adapted [Codex skill](../skills/jev-mode/SKILL.md) and an inactive [hook example](../examples/jev-mode-codex-hooks.json); it does not bundle or reinstall its CLI.

## Existing installation

The maintainer's Codex and Claude Code share `~/.local/share/jev-mode` v1.2.0 and `~/.local/bin/jev-mode`. The existing wrapper supplies `TYPESAFE_ENV_FILE` pointing to `~/.jev-router.env`. Preserve those files and all existing agent configuration. Start with `jev-mode check`; stop if reachability, key presence, or expected model `jev-1.13.0` cannot be confirmed. Never print credentials.

The reference Mac's default pip 21.2.4 / Xcode Python 3.9.6 can report a successful PEP 621 installation while creating only `UNKNOWN-0.0.0` metadata. Do not use that pip to install this or other PEP 621 packages. Inspect with `pip3 show UNKNOWN`; remove only a confirmed ghost distribution with `pip3 uninstall -y UNKNOWN`. Any separately authorized installation must be verified by importing the module with the same Python and resolving its executable, not by pip's success message.

Adapt the skill to the host, then place it manually at `~/.codex/skills/jev-mode/SKILL.md`, preserving any existing version. Add its compact batch rule to the existing user `AGENTS.md` without duplicating policies. No marketplace registration or package install is needed for an existing shared CLI. Existing verification and permission controls continue to apply.

## Batch boundary

For at least five bounded semantic judgments, code reads the records and builds the request files; the agent receives only counts and usage. Send one record per call and use a concise `choice` question with decisive criteria. Do not combine atomic `noul` answers by argmax. Code owns weights, thresholds, counting and comparisons. Only low-confidence records receive a sharper second pass; unresolved items remain unresolved. Prose, code generation, explanation, arithmetic, magnitude and date comparison stay outside this workflow.

Item text and answer text must not be displayed, pasted into a parent session or handed to a child agent. Inputs and outputs remain private local files. The requested example is:

```sh
jev-mode batch --items ~/.local/share/jev-mode/examples/items.jsonl --questions ~/.local/share/jev-mode/examples/questions.json --out /tmp/jm-answers.jsonl --pool 4
```

Preserve an existing output file before running. On a host enforcing `jev-verify`, run the check and batch through its plan/run flow rather than bypassing the shell guard.

## Observed result and metric limits

The Codex application run on 2026-09-20 KST completed with exit code 0: **8 items, 8 ok, 0 failed, 3,703 input tokens, 517 output tokens and 83 text tokens**. There were eight answer records, and zero item-text records were printed. The user's Claude Code baseline matched items/ok/failed/input_tokens/text_tokens. The shared checkout and protected wrapper/source files were unchanged, and no `UNKNOWN` distribution was found. These observations apply to this local example, not every installation.

In v1.2.0, [`text_tokens`](https://github.com/ddfeyes/jev-mode/blob/97615aa5cc14586488c11f6644a5b845827234c6/src/jev_mode/batch.py#L126) sums estimates of the input record text. It is **not a measurement of text entering Codex context**. Track it as an input-size indicator alongside raw item records printed (target: zero). Do not infer 78% savings or superior accuracy from this run; the upstream accuracy results are synthetic and require measurement on real task data.

The surrounding verification wrapper recorded the actual successful command exit separately from its Jev evidence assessment, which remained `INSUFFICIENT`. No runtime source changed, so the toolkit's full test suite was not rerun.

## Optional hooks and child agents

The example proposes SessionStart, UserPromptSubmit and SubagentStart reminders with Korean display names. It is **not installed or enabled by this change**. Ask the user before activation, merge approved entries into existing hooks rather than replacing them, and preserve the host's trust/approval process. Use `JEV_MODE_CONFIG="$HOME/.codex/jev-mode.json"` for Codex-only state; enabling it must not alter Claude Code's shared configuration. Without an enabled config these reminder hooks emit no guidance. They do not replace tool safety gates.

Give each child a narrow task, completion criteria and relevant constraints. The [selective-use policy](SELECTIVE_USAGE.md) removes unconditional per-step Jev and coverage calls: use Jev for repeated bounded judgments and inspect records only when establishing a claim of Jev use. The v1.2.0 `coverage` parser recognizes `codex-typesafe` call strings and a separate hook trace, so it does not establish coverage of every local Jev adapter. Missing trace or unmatched tool names mean unmeasured coverage. Historical reports of child hook gaps are not proof of the current host's behavior.

To stop using the skill, disable it through Codex's skill configuration; do not remove the shared CLI. If the optional hooks are later approved, their Codex-only config can be disabled independently.
