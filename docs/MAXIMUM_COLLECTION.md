# Maximum collection profile

The maximum profile expands the supported collection path without removing source, output, confidence or permission limits. No additional package dependency or background crawler is installed. It extends [bounded collection](DATA_COLLECTION.md).

## Input and selection

Set `"profile": "maximum"` in a collection spec, or `"collection_profile": "maximum"` in the existing feature settings for a user-wide default. An explicit `"profile": "bounded"` overrides that default. Public installs keep features off until enabled.

Maximum profile limits: four explicit sources, 1 MiB per source / 4 MiB total, 768 records after chunking, 1,500 UTF-8 bytes per record, 512 bytes per question. Processing uses pages of at most 96 records and bounded Jev batches. No URLs, files or directories are discovered automatically. Too much input fails instead of silently omitting it.

- Wrapped JSON: `"records_path": ["data", "items"]` selects an array using own properties only. `"text_fields": ["title", "description"]` selects primitive-valued fields rather than the entire object. No dynamic code or prototype traversal.
- CSV: `"format": "csv"` with `text_fields` selects named columns. Quoted commas, doubled quotes and embedded newlines are supported. Malformed CSV and duplicate headers fail. Public HTTPS accepts CSV MIME types as well as the previously supported static text/JSON types; redirect, credential and private-network restrictions remain.
- Long text is chunked with overlapping context and UTF-16 spans. Each chunk marks overlap and whether more context exists. Relevance across chunk boundaries is not guaranteed; the complete raw source stays on disk.
- Errors, explicit constraints and recognized requirement lines are protected as UNKNOWN without asking Jev to discard them. Protection is conservative and may retain irrelevant content.
- Known credential-bearing sources are withheld before paging, including when a private-key block crosses a page boundary. Pattern-based withholding is not universal anonymization. Raw private artifacts still contain the supplied source.
- Exact duplicates are removed across all pages and retain aliases for every source location. Confident decisions use the existing partial cache; UNKNOWN remains visible.

For structured records, `representation` identifies either a decoded field value or code-formatted `key: value` fields. Its offsets are not raw JSON byte offsets. Field spans, JSONL source-line offsets, CSV raw row/cell spans, chunk metadata and the raw artifact preserve that distinction.

## Read selected results

```sh
jev-collect --spec examples/collection-maximum.json
jev-collect --read /absolute/result/manifest.json
jev-collect --read /absolute/result/manifest.json --cursor 12
```

Use the manifest path and `next_cursor` returned by the actual commands; the path and cursor above illustrate the syntax. The example spec must be run from the repository root, with a fresh output directory.

`--read` makes no Jev API call. Each page is <=4,000 bytes and includes KEEP, EXTRACT and UNKNOWN records, omitting DROP/NONE. Known withheld secret text is not printed. The record-file hash is checked before reading; changed artifacts fail explicitly. This reader accepts new schema-2 manifests. Earlier schema-1 artifacts remain on disk but require the older manual access path.

## Hook and agent integration

Enable `collection_enforcement` alongside the existing verification guard. Hook-visible supported bulk shell reads require a downstream `head`/`tail -c N` bound where N is 1..4000, or the explicitly registered Jev/verification path. Each command is checked separately. A line limit alone is insufficient. This is a stdout guard, not a guarantee about arbitrary stderr from external tools. Keep using `2>&1` before the byte limiter when collecting combined output.

The order is existing execution guard, collection output guard, then Jev effect classification. A denial is not an invitation to use another interpreter. The collection guard grants no permission to execute code. Required tests and authorized execution remain under `jev-verify`.

`SubagentStart` passes the collection → bounded reader contract to children, including source/UNKNOWN/error/constraint preservation. Existing session and verification adapters already have bounded Jev paths and do not receive duplicate classifiers.

The guard covers supported hook-visible shell calls. Hosted search/MCP responses, browser transport and nested code-mode results are not universally intercepted or replaced. Use existing connectors or Aside to provide explicit structured exports; this feature does not scrape logged-in browser tabs automatically.

Disable enforcement with `jev-features disable collection_enforcement`; disable semantic collection separately with `jev-features disable data_collection`. A bounded profile can still be used with enforcement on. User installations that wrap features differently can set the same booleans in their existing private feature configuration. Hook definitions and native approval settings do not need to change.

## Validation for this update

63 related tests passed through the verification gate, covering parsing, chunk provenance, global deduplication, artifact paging/integrity, secrets across pages, fallback, and native hook compatibility. An installed-path fixture processed 104 inputs into 103 unique records over two processing pages: 101 protected records, one KEEP and one DROP. It made one Jev request and paged 102 retained records over ten bounded result pages. The installed hook denied an unbounded synthetic read and supplied the updated subagent contract. Raw input was preserved.

The gate's separate semantic evidence assessment remained INSUFFICIENT. Test success refers to actual command exit codes and assertions, not a substituted Jev verdict. These checks do not establish general token savings or relevance/extraction accuracy.
