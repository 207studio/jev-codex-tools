# Bounded workflow advice

Avoid paying for a second decision when code already knows the route. `jev-workflow` produces a short advisory plan; it never spawns agents, changes the main model, runs commands, approves actions, or skips tests. It is an optional CLI, not an additional per-tool hook.

| Situation | Route | Advisor requests |
| --- | --- | --- |
| Known lookup | Main session directly | 0 |
| Known edit/debug/design | Main, or an eligible independent child | 0 |
| At least five bounded semantic records | Existing `jev-mode batch` | 0; batch requests are separate |
| Mixed task with inadequate routing information | Opt-in Jev choice | At most 1 |
| Identical saved spec, models, context and feature state | Reuse saved plan | 0 additional |

Do not invoke the CLI for every trivial action. Apply the known rules directly. Use this advisor only when a mixed task warrants a persisted routing choice. Existing verification fingerprints remain responsible for optional verification reuse; a workflow plan is never test evidence.

## Usage

From an existing source installation, enable only this feature:

```sh
jev-features enable workflow_advisor
jev-workflow --spec /absolute/task.json --out /absolute/new-plan.json \
  --models /absolute/workflow-models.json
```

Use [the spec example](../examples/workflow-plan.json) and [model mappings](../examples/workflow-models.json). `context_id` is a caller-maintained revision marker. Change it whenever task evidence changes; this utility does not independently hash repository state. Do not put source, session text, commands, credentials or private records in the spec. Each JSON file is limited to 4,096 bytes; the optional goal is limited to 1,000 UTF-8 bytes. Only the goal and bounded task metadata may be sent to Jev. `context_id` and model overrides remain local. The sensitive-pattern filter is a safeguard, not a complete secret detector.

Absent explicit model selection, eligible child roles map to procedure=`gpt-5.6-luna/low`, implementation=`gpt-5.6-terra/medium`, design=`gpt-6-astra/high`. These are configurable hints: the host must support the chosen model/effort. An explicit user model wins; main-session plans have no automatic model hint. Children should receive `fork_turns="none"` and only scope, relevant paths and completion conditions.

Mixed-task advice uses a finite choice, confidence threshold 0.7, timeout 1,500 ms, retries 0 and diagnostic follow-ups disabled. Unknown, low confidence and provider failures stay UNKNOWN and return control to the main session. Exit 0 means a plan was selected, **not** that work passed; exit 3 means UNKNOWN; exit 2 means invalid input, cache or I/O failure. `api_calls` counts client request attempts for this invocation, not billed provider requests. It excludes any later batch/execution calls.

The CLI reserves a new plan file before requesting advice. Identical completed plans are reused; concurrent readers may receive an invalid-cache error while the first writer is incomplete, but do not make a duplicate request. Changed, corrupt, incomplete or augmented files are rejected without replacement. Review the failure and choose a new output path when appropriate. Plans are private local advice, not authenticated approvals; callers must not trust a saved plan as evidence of safety or correctness.

Disable network advice with `jev-features disable workflow_advisor` or `JEV_WORKFLOW_ADVISOR_ENABLED=0`. Known deterministic rules still work. Disabling the feature invalidates prior cache identity. All shipped feature defaults remain off.

## Method review and evidence

On 2026-09-22, Jev reviewed six proposed methods: direct lookup, fixed role mapping, existing verification reuse, bulk offload, bounded advice and plan reuse. Only verification reuse initially met the 0.7 threshold. Five proposals received one narrower second pass after the evidence/uncertainty contract was clarified; no third pass was made. Final choices were six ADOPT, with Jev-reported scores 0.81–1.0. These are advisory judgments, not independently calibrated success probabilities or measured accuracy gains.

The one-time review used 11 requests, 5,959 input tokens and 562 output tokens. This review cost is not incurred on every task. Synthetic regression tests check call limits, unknown preservation, model overrides, bounded output and cache rejection. They do not establish Astra token savings, end-to-end speed or task accuracy. Measure those separately with comparable workloads and cache accounting before making performance claims. `jev-mode text_tokens` is an estimate and must not be described as actual Codex context ingress.

## Local Codex policy

A subsequent [routing microbenchmark](WORKFLOW_MEASUREMENT.md) measured the next Astra reporting turn with raw metadata versus precomputed advice. It found only 1.4% lower Astra input and higher combined provider token counts. It does not establish end-to-end task accuracy or general savings.

Keep the always-loaded policy short: direct known work, batch repeated semantics, minimal child context, required checks once. Put this reference behind an on-demand link. Existing runtime integrations can invoke `node /absolute/codex-token-tools/integration/workflow-cli.mjs` without replacing the shared Jev Mode installation or adding a blanket hook.
