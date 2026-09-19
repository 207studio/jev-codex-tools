# Contributing

Keep changes bounded and portable. Explain the expected behavior, the input boundary, the fallback, and what was actually tested. Use synthetic fixtures, never real user conversations or credentials. Do not claim a token-saving percentage without a comparable baseline and reported success criteria.

Prefer Node built-ins where practical. Keep optional integrations opt-in, do not auto-install external tools, and never change host approvals or configuration silently. No feature may turn an uncertain Jev decision into permission to act.

Priorities:

- Preserve oversized session constraints with bounded streaming rather than omitting them.
- Add synthetic tests for pagination, source changes, credential masking, confidence fallback, and stale UI state.
- Measure success rate and total model tokens on comparable tasks before and after filtering.
- Document supported host versions and adapter-specific limitations.

Submit a focused pull request with a clear description and validation results. Preserve any third-party notices in code you import. The current repository is an initial source snapshot, so do not assume a full automated test suite exists.
