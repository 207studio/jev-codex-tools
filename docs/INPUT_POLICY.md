# Keep bulk raw input out of model context

Code reads and transforms bulk records. For a repeated semantic task, Jev may select finite labels or relevant records; code owns thresholds and returns only counts, IDs, source paths, line ranges and short evidence. Exact source text stays in local artifacts. Inspect the selected source range directly when an edit, exact error or unresolved question requires it. Selection is not proof that omitted content is irrelevant.

Preserve original requirements, constraints, exact error messages, commands, exit codes, provenance and UNKNOWN. Do not shrink context by deleting evidence, weakening tests or turning uncertainty into success. Do not call Jev merely to decide whether to read one known file, inspect a cache or perform arithmetic.

## Existing optional byte guard

With the existing native hook installed, `jev-features enable collection_enforcement` rejects recognized bulk shell readers without a per-command `head -c N` or `tail -c N` bound (`1 <= N <= 4000`). Disable with `jev-features disable collection_enforcement`. This policy branch is deterministic and makes no Jev request. It does not approve the command; native permissions still apply.

This is not a universal raw-input firewall. It covers recognized hook-visible shell syntax. Arbitrary scripts, file tools, nested tool orchestration and child agents may fall outside its coverage. A 4 KB dump may still be irrelevant, so the model's scope discipline remains necessary. No new hook is needed when the collection guard is already wired.

For builds and tests, capture stdout/stderr and the command's actual exit status into private files first, then print a bounded summary or error tail. A simple pipeline's exit status may belong to `head` rather than the producer; do not mistake it for a successful build. Keep raw traces out of Git.

## User-scope instructions

Keep the always-loaded policy to ten short lines and move specialized host details into references loaded only when needed. Merge duplicate rules rather than dropping safety constraints. Disable only proven duplicate skill entries in the host's own configuration; keep their intended replacement active and do not edit shared sources or other agents' settings.

An instruction change can guide subsequent work but does not remove text already in a live conversation. Validate new prompt loading separately from billed token usage. `jev-mode`'s `text_tokens` estimates batch item input text; it does not measure Codex context ingress. Use Codex's own usage events for that comparison.
