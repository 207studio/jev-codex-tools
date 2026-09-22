# Keep bulk raw input out of model context

Code reads and transforms bulk records. For a repeated semantic task, Jev may select finite labels or relevant records; code owns thresholds and returns only counts, IDs, source paths, line ranges and short evidence. Exact source text stays in local artifacts. Inspect the selected source range directly when an edit, exact error or unresolved question requires it. Selection is not proof that omitted content is irrelevant.

Preserve original requirements, constraints, exact error messages, commands, exit codes, provenance and UNKNOWN. Do not shrink context by deleting evidence, weakening tests or turning uncertainty into success. Do not call Jev merely to decide whether to read one known file, inspect a cache or perform arithmetic.

## Existing optional byte guard

With the existing native hook installed, `jev-features enable collection_enforcement` rejects recognized bulk shell readers without a per-command `head -c N` or `tail -c N` bound (`1 <= N <= 4000`). Disable with `jev-features disable collection_enforcement`. This policy branch is deterministic and makes no Jev request. It does not approve the command; native permissions still apply.

This is not a universal raw-input firewall. It covers recognized hook-visible shell syntax. Arbitrary scripts, file tools, nested tool orchestration and child agents may fall outside its coverage. A 4 KB dump may still be irrelevant, so the model's scope discipline remains necessary. No new hook is needed when the collection guard is already wired.

For builds and tests, capture stdout/stderr and the command's actual exit status into private files first, then print a bounded summary or error tail. A simple pipeline's exit status may belong to `head` rather than the producer; do not mistake it for a successful build. Keep raw traces out of Git.

Use 1,000 bytes as the initial lookup budget, widening to 4,000 bytes only for needed evidence. This is a default investigation budget, not a new hard-denial threshold: the existing guard still allows up to 4,000 bytes. Prefer a code-produced count, path or exact match to a raw dump of the same size.

## Child context

Where Codex exposes `spawn_agent`, default to `fork_turns="none"` and supply only the objective, relevant paths, completion conditions and required constraints. If history is essential, provide the relevant excerpt or the smallest supported turn count. Do not copy the full conversation into the task prompt. A fresh child still receives host-provided instructions and tools; this setting does not make its initial context empty or prove a particular token reduction.

## User-scope instructions

Keep the always-loaded policy to ten short lines and move specialized host details into references loaded only when needed. Merge duplicate rules rather than dropping safety constraints. Disable only proven duplicate skill entries in the host's own configuration; keep their intended replacement active and do not edit shared sources or other agents' settings.

An instruction change can guide subsequent work but does not remove text already in a live conversation. Validate new prompt loading separately from billed token usage. `jev-mode`'s `text_tokens` estimates batch item input text; it does not measure Codex context ingress. Use Codex's own usage events for that comparison.

## Native input budgets

Codex documents a catalog budget and a separate budget for tool outputs retained in history. They do not limit the final answer. See the [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). For the measured local installation, these user-scope keys were added without changing model selection, hooks or skill enablement:

```toml
# Top-level keys in ~/.codex/config.toml
tool_output_token_limit = 1000
skills.max_context_tokens = 3500
```

A fresh `codex debug prompt-input` render on 2026-09-22 retained all 127 skill paths. The skill section fell from 22,262 to 14,497 bytes; total rendered text fell from 30,854 to 23,106 bytes (25.1%). The ten-line instruction update is included in that comparison. A 2,000-token catalog omitted entries, so it was rejected. Descriptions are shorter at 3,500 tokens; retained names and paths do not establish unchanged skill-selection accuracy.

These are local prompt text bytes, not measured API token savings. Other installations may need a larger catalog budget. The tool-history setting's end-to-end savings were not benchmarked. Keep full logs externally and recover the exact source/error range when a shortened result is insufficient. Already-loaded desktop context is not retroactively erased; confirm fresh-task behavior separately. Remove only these two added keys to restore their native defaults.
