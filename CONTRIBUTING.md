# Contributing

Keep changes bounded and portable. Explain the expected behavior, the input boundary, the fallback, and what was actually tested. Use synthetic fixtures, never real user conversations or credentials. Do not claim a token-saving percentage without a comparable baseline and reported success criteria.

Prefer Node built-ins where practical. Keep optional integrations opt-in, do not auto-install external tools, and never change host approvals or configuration silently. No feature may turn an uncertain Jev decision into permission to act.

Priorities:

- Preserve oversized session constraints with bounded streaming rather than omitting them.
- Add synthetic tests for pagination, source changes, credential masking, confidence fallback, and stale UI state.
- Measure success rate and total model tokens on comparable tasks before and after filtering.
- Document supported host versions and adapter-specific limitations.

Run `npm test` from a Git checkout with Node.js 24 or later. The suite isolates feature state and removes Jev/TypeSafe environment variables; use synthetic fixtures and injected service responses. Tests are maintained in Git and are not included in the installed npm package. Focused checks are appropriate during development; run the whole suite for changes to shared behavior or release packaging.

Submit a focused pull request with a clear description and validation results. Preserve any third-party notices in code you import. Do not include personal hook configurations, application forms, transcripts, credentials, or generated binaries.
