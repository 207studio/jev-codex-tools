# Visual decisions and implementation

Jev accepts text and structured text state, not images or screenshots. This is an explicit limitation in the official [State documentation](https://docs.typesafe.ai/concepts/state). These tools use deterministic measurements and finite choices. Actual pixel inspection, code generation, and image generation stay with supported tools or a person.

CLI and measurement results report `scope: supplied_metrics_only` where applicable and `pixel_review: NOT_PERFORMED`; hook audit records also retain that pixel status. A metric `PASS`, chosen candidate, successful token write, or observed tool execution is not visual acceptance.

## Enable and disable

Both features default off:

| Flag | Effect |
|---|---|
| `visual_review` | Enables `jev-visual --spec FILE` assessment and candidate selection. |
| `visual_enforcement` | Requires finite routing consultation for recognized visual calls through an installed, trusted native hook. |

```sh
jev-features enable visual_review
jev-visual --help
jev-visual --spec visual-review.json

# Requires separately installed and trusted hooks.
jev-features enable visual_enforcement
```

When a shell guard requires registered executables, use the exact registered absolute path to `jev-visual`. Enabling a flag does not install hooks, collect DOM/AX observations, take screenshots, or execute a review spec automatically.

```sh
jev-features disable visual_review
jev-features disable visual_enforcement
```

Environment overrides take precedence over saved flags. If present, clear them or set `JEV_VISUAL_REVIEW_ENABLED=0` and `JEV_VISUAL_ENFORCEMENT_ENABLED=0` in the hook/CLI environment. Disabling these two flags leaves the other guards configured independently.

## Assess supplied measurements

Use supported browser, accessibility, rendering, or image tools to obtain real evidence first. Write a JSON spec with `mode: assess`, a bounded `question`, `observation`, and `checks`. Specs are limited to 64 KiB, 80 elements per observation, and 32 checks. The reusable `measure(observation, checks)` function in `integration/visual-review.mjs` performs the same local calculations.

| Check type | Required evidence |
|---|---|
| `inside_viewport` | One element rectangle and positive viewport width/height |
| `min_target` | One rectangle and explicit minimum width/height in `min` |
| `contrast` | One element's opaque hex `foreground`/`background` and explicit minimum ratio |
| `no_overlap` | Two rectangles |
| `gap` | Two rectangles, `axis: x` or `y`, and explicit minimum gap |
| `contains_text` | One element's text and literal expected `text` |

Missing evidence or unsupported checks remain `UNKNOWN`. Deterministic `FAIL` or `UNKNOWN` is not upgraded by Jev. Passing metrics may be judged `METRICS_SUPPORTED`, `PIXEL_REVIEW`, or `UNKNOWN`; only sufficient, high-confidence support yields a metric PASS.

This is a synthetic format example, not a screenshot, actual measurement, or acceptance result:

```json
{
  "mode": "assess",
  "question": "Do the supplied metrics support this target's bounds and size?",
  "observation": {
    "viewport": {"width": 390, "height": 844},
    "elements": [{"id": "action", "rect": {"x": 16, "y": 20, "width": 120, "height": 48}}]
  },
  "checks": [
    {"id": "bounds", "type": "inside_viewport", "ids": ["action"]},
    {"id": "size", "type": "min_target", "ids": ["action"], "min": 44}
  ]
}
```

## Select a finite candidate

Use `mode: pick`, a `question`, and 1–8 `candidates`. Each candidate supplies an `id`, `label`, flat primitive `tokens`, `observation`, and `checks`. Code measures each candidate first; only candidates whose supplied checks all PASS become Jev choices. Jev selects an existing ID or leaves the result UNKNOWN. It does not invent candidate values or generate implementation code.

Selection requires confidence at least 0.9. Missing, uncertain, or unavailable judgments retain UNKNOWN and do not select or apply a candidate. Accepted decisions can be reused for one hour only for the same hashed spec, question, criteria, and configured model alias. This is a supplied-evidence decision cache, not a cache of real screen acceptance.

## Optional existing token-file patch

The default command only reviews. To apply selected tokens, a pick spec must also include `destination` with:

- `file`: an existing `design-tokens.json` or `NAME.tokens.json` inside the current working directory.
- `expected_sha256`: the 64-character lowercase SHA-256 of that file's exact current bytes.
- `keys`: the explicit permitted existing keys; selected token keys must be within this list.

```sh
jev-visual --spec visual-pick.json --apply --execute
```

Both flags are required together. The selected candidate must have passing supplied checks and confidence at least 0.9. The spec is rechecked after the model call. The destination must be a flat JSON object no larger than 16 KiB; hidden paths, `node_modules`, symlink entries, new token keys, and stale hashes are rejected. The writer backs up original bytes privately and replaces the file with the merged tokens. It does not generate arbitrary code or claim that the resulting UI was rendered or visually checked.

## Native hook boundary and data flow

With trusted hooks and `visual_enforcement` enabled, recognized visual calls must complete a finite routing consultation. These include image-view/screenshot/general image-generation tools, recognized Figma tools, CUA code with explicit capture calls, supported UI-file edits, and detectable screenshot shell commands already subject to the shell guard. GPT image generation is explicitly excluded for exact tool names `image_gen__imagegen` and `image_gen.imagegen`: generation does not need a Jev visual-choice receipt. Ordinary effect classification, native authorization, execution audit and pixel-review limitations still apply. Tool arguments and similar names cannot trigger this exception. Indirect hosted scripts, unknown nested execution, and tools that the host does not expose to hooks are not universally intercepted. Exact registered helpers are exempt from nested routing decisions.

The hook sends only the visual kind, extension/count metadata, input hash and byte count, and capability facts. It sends no code, paths, prompts, screenshot contents, or tool-output bodies. It does not collect DOM/AX/geometry evidence or approve pixels. Its choices route inspection, implementation, or generation; they do not skip the requested action or required checks and never grant native permission.

Valid UNKNOWN or low-confidence replies remain uncertain under native policy. Missing, malformed, failed, or timed-out requests deny the pending visual call. The request limit is 1800 ms with no retries; valid routing outcomes alone may be cached for 120 seconds using session, turn, tool, and full input hash. File contents are not part of this routing cache because it never caches an image result or skips execution.

`before_execution` decisions and `actual_execution` observations are separate private audit records. Observing PostToolUse is not a success or quality verdict. Audit and cache files contain hashes and bounded metadata, not original payloads.

The CLI has a different data boundary: it sends the supplied question and calculated measurement evidence to Jev; candidate mode also sends eligible candidate labels and token values. Raw observation text is used locally for literal checks. Pixel fields/encoded image inputs are rejected, and recognized credentials are withheld. Keep supplied text and tokens appropriate for the external API. CLI stdout is bounded to 4000 bytes. Real screenshots, rendering checks, and code-generation results still require the supported tools and their own evidence.
