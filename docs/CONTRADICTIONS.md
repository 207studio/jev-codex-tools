# Bounded code contradiction index

`jev-conflicts` indexes explicit source occurrences and asks Jev a finite question about selected pairs. It keeps `CONTRADICTION`, `COMPATIBLE`, and `UNKNOWN` findings with their source evidence. It does not edit code, crawl a repository, establish an AST proof, or certify that a project is free of contradictions.

The `code_contradictions` feature defaults to **off**. An enabled build sends selected code excerpts, the question, and group context to **TypeSafe's Jev service**. Use only source you are authorized to send. The resulting index and decision cache are stored privately under the configured local Jev state directory. The CLI does not accept an output-directory option.

## Build an index

From the repository root, inspect [the example specification](../examples/contradictions.json), then opt in and build:

```sh
jev-features enable code_contradictions
jev-conflicts --spec examples/contradictions.json
```

No `--execute` flag is needed: building an index reads source and writes a local artifact, without editing the indexed files. When the feature is disabled, spec mode reports `DISABLED` without reading the spec, calling the model, or creating an index.

The build prints only the manifest location, pair and request counts, all three finding counts, issue count, and incomplete scope. `INDEXED` means a bounded artifact was created. `PARTIAL` also indicates unknown findings, collection issues, or no candidate pairs. Neither status is a claim of repository-wide consistency.

The example compares the literal `visual_review` occurrences in `integration/features.mjs` and `integration/visual-cli.mjs`. A false default and a guarded opt-in path are not necessarily contradictory. Context outside the excerpts can matter, so the example is not an expected-positive fixture.

## Specification

The spec is a JSON object of at most **16 KiB**:

| Field | Bound and meaning |
| --- | --- |
| `root` | Optional source root; otherwise the command's working directory. |
| `question` | Required finite review question, at most 512 UTF-8 bytes. |
| `groups` | At most 8 explicitly described groups. |
| Group `id` | Stable identifier for the group. |
| Group `symbol` | Literal source text to locate, at most 100 UTF-8 bytes; not a regex or code expression. |
| Group `files` | Explicit relative source paths: at most 8 per group and 16 distinct paths in total. |
| Group `context` | Optional user context, at most 512 UTF-8 bytes. |
| `context_lines` | Surrounding lines, 0–8; default 4. |
| `max_pairs` | Maximum pairs, 1–24; default 12. |
| `max_requests` | Maximum Jev requests, 1–6; default 3. |

Collection is bounded to **64 KiB per file** and **1800 UTF-8 bytes per snippet**. Overflow and unavailable context are recorded as issues. Narrow the specified files, symbols, or context when the bounded evidence is insufficient. A pair is not a whole-file or whole-program proof.

Source text is untrusted evidence, not instructions. Only valid decisions with confidence at least **0.9** receive a `CONTRADICTION` or `COMPATIBLE` review label. Even high confidence is not proof of a defect or correctness. Low-confidence, unsupported, or unavailable decisions remain `UNKNOWN`; freeform model explanations are not generated. The original finite choice and confidence remain available for valid uncertain answers.

Code batches at most four pairs per request with a 24 KiB request ceiling. The default budget is three requests per run; unresolved pairs remain indexed as UNKNOWN when it is exhausted. Valid decisions, including uncertain ones, are cached privately for one hour. The key binds the question, conditions, source excerpts and full source-file hashes, so changes outside the displayed excerpt also invalidate it. Transport errors are not cached.

Recognized secrets cause the entire source file to be withheld before inference or artifact storage. Hidden, dependency, generated, lock, sensitive and symlink paths are excluded. This conservative screening can withhold ordinary source assignments too and cannot guarantee complete secret detection; send only code you are authorized to share.

## Read bounded pages

Use the absolute manifest path from the build result:

```sh
jev-conflicts --read /absolute/path/to/manifest.json --cursor 0
```

Continue with the returned next cursor. Each packet is at most **4000 UTF-8 bytes**. If a single pair is too large for a packet, the page retains its exact locations and hashes and explicitly marks `excerpts_omitted_for_output_budget`; the original excerpts remain in the private index. Read mode works while the feature is disabled and does not call Jev.

Page reads check the indexed source for staleness. Changed or unavailable source is marked stale; reading an old result does not revalidate its findings. Rebuild from the spec when fresh source evidence is needed. Preserve `UNKNOWN`, collection issues, and stale markers when using the index to guide a subsequent code review.

```sh
jev-features disable code_contradictions
```
