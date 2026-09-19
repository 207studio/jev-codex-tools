# Open-source contribution and evidence

Jev Codex Tools is an experimental, MIT-licensed toolkit maintained by 207 Studio. It was developed iteratively with Codex to explore whether narrow decision models and reusable deterministic code can reduce repetitive context in coding-agent workflows while retaining requirements, evidence and host permissions. It is independent of OpenAI and TypeSafe; no endorsement or support award is claimed.

## Inspectable contribution

- One published native handler with six documented hook events, portable example configuration and explicit feature flags.
- Necessity checks before optional verification, with actual command results and semantic evidence assessment recorded separately.
- Bounded session reading and data collection with original source preservation, provenance, paging, protected evidence and confidence fallbacks.
- Finite browser/macOS/iOS choices with state checks, plus structured visual measurement and narrowly scoped design-token application.
- Source, regression fixtures, package metadata, contribution guidance and CI configuration in the same repository.

The implementation separates finite semantic choices from deterministic parsing, hashing, arithmetic, caching and execution. Unknown evidence is not a passing result. Jev is a text-only service: visual measurement support is not pixel inspection, and native conversation compaction remains native.

## Evidence a reviewer can reproduce

Clone the repository, use Node.js 24 or later, then run `npm test`. The runner isolates feature state and strips Jev/TypeSafe environment variables. Tests use synthetic data and injected responses rather than live credentials. See the [CI workflow](../.github/workflows/test.yml), [hook inventory](HOOKS.md), [limitations](LIMITATIONS.md) and [release history](../CHANGELOG.md).

Earlier focused checks covered decision, verification, collection and visual paths. An installed local visual example also obtained a real Jev response while keeping pixel review explicitly unperformed. These observations are narrower than independent end-to-end validation. Published test results are not evidence of adoption, production reliability, or measured token savings.

## Work that support would enable

1. Compare a native baseline, bounded-code-only workflow and Jev-assisted workflow on the same public fixture tasks.
2. Record all coding-model input/output tokens, Jev request usage, latency, retries, required-fact retention and independently checked task success. Count routing overhead as well as any saved context.
3. Add failure-injection and preservation cases for large session records, stale UI observations, service outages and hook-contract changes.
4. Maintain compatibility reports and focused fixes from reproducible community issues.

No benchmark result, adoption count, percentage saving, or selection outcome is asserted here. This is a new project; ecosystem value must be established through reproducible results and real use, not repository count.

The official [Codex for Open Source program](https://openai.com/form/codex-for-oss/) considers meaningful usage, ecosystem importance and active maintenance. This page supplies inspectable technical scope and planned evaluation, not a claim that the project already meets every selection signal. Applicant identity and application records are not part of the public package.
