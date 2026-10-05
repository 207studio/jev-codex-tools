# Bounded synthetic offload comparison

This is one paired, bounded synthetic classification measurement: 24 items with Codex `gpt-6-astra` at `ultra`. It does not measure all skills, all environment settings, or a production workflow. User configuration, hooks, and MCP were omitted in both arms; instructions otherwise loaded. Raw prompts, session traces, keys, and machine paths are private and are not included.

| Metric | Direct Codex | Jev batch helper |
| --- | ---: | ---: |
| Correct | 24 / 24 | 23 / 24 |
| UNKNOWN | 8 | 9 |
| Codex input tokens | 81,426 | 58,221 |
| Codex cached input tokens | 59,392 | 38,272 |
| Codex uncached input tokens | 22,034 | 19,949 |
| Codex output tokens | 927 | 166 |
| Wall time | 71.21 s | 47.55 s |

For this pair only, the recorded reduction is 28.5% total Codex input, 9.5% uncached Codex input, and 82.1% Codex output. Caching was not controlled, so the pair does not establish a general token, latency, accuracy, or accuracy-parity claim.

The helper separately recorded Jev input 11,863, output 1,444, and `text_tokens` 681. `text_tokens` estimates the input item text loaded by the batch helper; it is neither measured Codex input nor Jev output tokens.

The single accuracy difference was holdout `h02`: the raw Jev top label was `read-only`, but confidence 0.87 was below the fixed 0.9 threshold, so the helper preserved `UNKNOWN`. That outcome is a threshold effect, not evidence that the top label was adopted.

Public reproduction inputs and helpers are in [benchmarks/jev-offload](../benchmarks/jev-offload). `validate_fixture.py` checks only fixture shape and counts. `on_offload.py` is optional and may call a configured `jev-mode` executable when the user explicitly runs it; it uses no machine-specific path.

## Repeat the workflow

The fixtures are byte-identical to the measured synthetic inputs, including the fixed 0.9 threshold. Gold labels stay outside both child working directories. The safe task prompts and original CLI arguments are in `benchmarks/jev-offload/protocol.json`; copy only the appropriate fixture/helper files into fresh temporary directories. Do not execute any command described inside a fixture. An existing Codex CLI login and an existing configured `jev-mode` executable are prerequisites; nothing is installed by these helpers.

1. Create separate temporary `off` and `on` directories. Copy `items.jsonl`, `questions.json`, and `pages.py` to both; copy `on_offload.py` to `on/offload.py`. Keep `expected.json` in the parent evaluation directory.
2. In each directory, start a fresh Codex process using the recorded arguments and the matching condition prompt. These experimental commands intentionally omit user config, hooks and MCP in both arms; they are not suggested everyday settings. Network permission in the on arm is solely for the authorized Jev API.
3. Save each complete `--json` event stream and stderr privately, preserving its exit status. Extract `turn.completed.usage` with code; do not paste event streams into model context. Evaluate the written `{id,choice}` records against `expected.json` with code outside the child sessions.
4. Report exact-match accuracy and abstentions alongside total, cached and uncached Codex input, output, elapsed time and separate Jev API usage. Repeated pairs and representative production tasks are still needed.

The public helper preserves the record conversion and threshold used in the measurement. Host instructions and prompt caches change over time, so an exact billed-token match is not expected. This pilot used one concurrent pair, not randomized repeated trials. Lowering the threshold after seeing the holdout miss would require a new independent evaluation.

## Smaller user instructions

Separately, the local Codex policy was reduced from 15 lines / 3,343 bytes to 10 lines / 2,356 bytes, with specialized host rules moved to an on-demand reference. Four duplicate Jev skill entries were disabled only in Codex. A fresh native `codex debug prompt-input` render fell from 31,841 to 30,854 text bytes (987 bytes); skill entries fell from 131 to 127. The rendered skill-description byte budget stayed constant, so no separate catalog-byte saving is claimed. These are local text-size observations, not API token savings or proof that an already-running desktop session shed its earlier context. See [input policy](INPUT_POLICY.md).
