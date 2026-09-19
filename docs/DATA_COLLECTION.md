# Bounded data collection with Jev

Version 0.1.5 adds CSV, wrapped JSON, protected evidence, bounded result reading and an opt-in maximum profile plus shell enforcement. See [maximum collection](MAXIMUM_COLLECTION.md) for the extended contract; the limits below describe the original bounded profile.

`jev-collect` adds code-first gathering and deduplication, followed by finite Jev selection. It is an experimental implementation of the official [pre-parsed value extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook) pattern, using the existing [HTTP API](https://docs.typesafe.ai/api) adapter. No new SDK, search provider or crawler dependency is installed. It does not intercept every Codex or browser read.

## Use

After the normal source install (`npm link --ignore-scripts`), export `JEV_API_KEY` or `TYPESAFE_API_KEY` through your secret manager, then:

```sh
jev-features enable data_collection
jev-collect --spec examples/collection.json
jev-features disable data_collection
```

Run the example from the repository root. `output_dir` must be a fresh absolute path; existing directories are rejected before source retrieval and API calls. Use a new path for another run. To override the flag for a process, use `JEV_DATA_COLLECTION_ENABLED=0` (disabled) or `1` (enabled). With shell enforcement, use the registered absolute wrapper path, or an authorized `jev-verify plan` / `run --execute` spec; do not bypass a denial.

The spec has `question`, `mode`, `sources`, `output_dir`, and optional `kind`:

- `mode: filter`: Jev returns KEEP, DROP or UNKNOWN for each unique record.
- `mode: extract`, `kind: email|url|amount|date`: regex finds candidates; Jev selects an existing candidate ID, NONE or UNKNOWN. Code returns the exact source value and offsets. Ambiguous phone/date/currency normalization is not implemented.
- A source is `{ "file": "explicit/path.txt", "format": "text" }` or `{ "url": "https://public.host/path.txt", "format": "text" }`.
- `text` uses nonempty lines as records. `jsonl` / `json` accept rows that are strings or objects with a string `text` field; JSON must be an array. Other object fields remain in the raw artifact, not in the semantic record.
- File paths resolve from the working directory. The tool does not search directories, discover URLs, follow links or schedule background collection.

Limits: four sources, 64 KiB per source / 128 KiB total, 96 records, 1,500 bytes per record and 512 bytes per question. Oversized records fail instead of being silently truncated. Use an existing connector or Aside to collect a bounded text/JSONL export when a page requires JavaScript or authentication. Jev does not replace the browser transport.

## Network and privacy

Public HTTPS fetching supports plain text, Markdown, JSON and JSONL only. No redirects, query/fragment, credentials, non-default ports, custom headers or compressed/HTML responses. IPv4 DNS results must be public and are pinned for the connection; normal TLS hostname checks remain enabled. IPv6-only hosts are unsupported. The destination receives an ordinary unauthenticated GET; obey its access and usage conditions.

Jev receives the question and bounded candidate text (or extraction candidates and their limited record context), opaque record/source IDs and finite criteria. Paths and source URLs are retained in the local manifest, not sent as source metadata. A URL appearing inside the chosen text remains content. The tool withholds recognized credential-bearing records and rejects known credential filenames. This is pattern-based protection, not a guarantee that arbitrary personal information is removed: only provide data authorized for TypeSafe processing.

Artifacts are written to a fresh 0700 directory, with files 0600. `sN.source` preserves raw source bytes and may therefore contain sensitive material present in the explicitly supplied file. `manifest.json` stores source hashes/locations, counts and artifact paths. `records.json` stores selected/uncertain records or exact extraction results; exact duplicates retain aliases and provenance. Do not commit these artifacts. The decision cache stores hashes and validated decisions, not source content; its key binds the question, mode, kind, schema/model and record group. A partially resolved group reuses its confident decisions and asks only about unresolved IDs in the same bounded context. Confidence below 0.90, unavailable API, malformed IDs or errors retain UNKNOWN. Disabled collection makes no source reads or API calls.

Stdout is a <=4,000-byte manifest summary. Full data stays on disk. `COMPLETE` means all decisions for the supplied bounded records resolved; it does not mean the web or source domain was exhaustively collected. UNKNOWN makes the run PARTIAL, not failed or irrelevant. Source fetching/parsing errors have exit status 2 and no completeness claim. No generated summary or missing values are invented.

## Sweep, 2026-09-19

GitHub `pushed_at` is maintenance evidence only, not a quality endorsement. All five repositories below were unarchived when checked.

| Repository | Recent push (UTC) / license | Actual path / data sent | Application here |
|---|---|---|---|
| [typesafe-sdk-js](https://github.com/typesafe-ai/typesafe-sdk-js) | Sep 15 / MIT | `src/client.ts` → `systemOne`; state, questions, criteria to TypeSafe. Node >=20, no runtime dependencies. | Existing HTTP client already covers the required API; no duplicate SDK installation. |
| [typesafe-sdk-python](https://github.com/typesafe-ai/typesafe-sdk-python) | Sep 18 / MIT | `src/typesafe_sdk/_core/client/sync/client.py`; caller state/questions to TypeSafe. Python >=3.10, httpx2/pydantic/tenacity stack. | No Python runtime layer added to this Node tool. |
| [superagents-lab/jev-search](https://github.com/superagents-lab/jev-search) | Sep 19 / MIT | `src/lib/pipeline.ts` → TypeSafe intention/reranking + Search1API retrieval; request/result snippets to Jev, search constraints to Search1API. React/TanStack/Vite. | Not installed: additional provider key and separate application required. Existing search remains available. |
| [Foadsf/jev-for-engineers](https://github.com/Foadsf/jev-for-engineers) | Sep 16 / MIT | `05_extraction_without_hallucination.py` → regex candidates → `jev.py` → source-membership check. Standard-library Python. Whole document and candidate context sent to Jev. | Reference only; bounded official-pattern implementation added here, no copied wrapper installed. |
| [databricks-jev-pdf-lab](https://github.com/laurentfabre/databricks-jev-pdf-lab) | Sep 19 / license UNKNOWN | `scripts/jev_router.py` → `jev_transport.py`; `selective_parse.py` configures parsing. Numeric page/layout metadata to Jev, Databricks environment required separately. | Not installed: unresolved license and research-stage quality/savings claims. |

The initial Jev suitability question returned UNKNOWN and was not promoted to an endorsement. Implementation follows the user's explicit prototype request and the official candidate-selection contract. Review and tests establish only the documented behavior; they do not establish general extraction accuracy or token savings.

## Validation

`npm run test:collection` covers bounded source parsing, private-network restrictions, disabled/API failure fallback, artifact permissions, exact provenance, deduplication, cache binding, confidence and invalid-candidate handling. Execute through `jev-verify` when shell enforcement is active. A synthetic live run can demonstrate API reachability and cache reuse, but byte counters are not tokenizer measurements or an independent quality benchmark.
