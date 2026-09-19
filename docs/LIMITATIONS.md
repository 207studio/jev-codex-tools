# Current limitations

- Jev performs finite choices; it does not capture screens, write arbitrary code, or replace all coding-model reasoning.
- Codex Desktop and native `read_thread` calls are not automatically intercepted. The explicit commands and optional instructions must be used.
- The 85% context setting affects the minimum size for tool-output filtering. It does not schedule or replace full-history native compaction.
- Session reading defaults to the latest 80 eligible records. Earlier history and remaining output require cursors. A selected page is not the entire conversation.
- A text record larger than 16 KiB is omitted from the selected view and reported in `issues`. The source remains, but its constraints may be absent from the returned text. This requires improvement before lossless preservation can be claimed.
- `UNKNOWN`, API failures, and low confidence retain session candidates. UI adapters stop or hand back control instead of guessing.
- Aside navigation is bounded to observed and allowed elements. Actual macOS accessibility presses and live iOS device interaction were not established by the original synthetic cases.
- Optional third-party router bridges do not guarantee compatibility with every upstream version. They require an explicitly configured entry point, and no third-party runtime is bundled.
- Hook registration, trust, invocation formats, and approval behavior depend on the host. A classifier is not a universal execution gate.
- No general token-savings percentage, Chrome-versus-Aside speedup, or production reliability level has been measured for this public extraction.
- Verification gating applies to explicit `jev-verify` calls. Its fingerprint covers only the caller's declared files and inputs; it cannot discover missing dependencies or bypass required checks. A Jev evidence judgment is separate from the real test result.
