# Data handling and security boundaries

Jev is an external API. An enabled judgment can send the explicitly selected file, UI labels, or bounded session candidate text and a question to TypeSafe. Credential redaction is best effort, not complete anonymization. Do not use private source material unless you are authorized to send it to that service.

Source session files are read-only. Selected excerpts may be saved in private local packet files so a caller can page through them without repeating decisions. Judgment caches contain hashes and decision metadata. Do not publish these runtime directories, transcripts, API keys, or personal configuration.

Feature flags default off. Installation does not register hooks or alter Codex permissions. UI execution requires an explicit execution flag, allowed targets, and the host permissions. This code is not a sandbox or a substitute for the host approval mechanism. A risk-classification result does not authorize an operation.

The package is an experimental initial extraction; it has not undergone a security audit. Native helpers, routers, browser tools, and platform versions may differ from the original local environment.

Use GitHub private vulnerability reporting if available on this repository. Otherwise open an issue containing only a non-sensitive description and ask for a private reporting channel. Never include real credentials or user session data in a public issue.
