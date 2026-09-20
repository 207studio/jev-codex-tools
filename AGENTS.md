Inspect only files relevant to the request; use bounded searches before reading large ranges.
Keep command output within 4000 bytes and retain full test logs outside model context when needed.
Preserve existing changes and host permission boundaries; do not silently enable integrations. Commit changes on a topic branch and open a PR; never push directly to main or merge without explicit user authorization.
Use Jev only for finite decisions; keep facts, caching, execution, and safety checks in code.
Use Jev for repeated finite choices; code handles facts, counters and established policy paths. Never bypass a denial or invent a verdict for UNKNOWN.
Retain UNKNOWN and low-confidence evidence; stop UI actions when state or authorization is unclear.
Never commit credentials, conversations, runtime state, generated binaries, or personal configuration.
Document actual validation and limitations; do not infer token savings or platform compatibility.
Use jev-visual for repeated visual candidate selection, excluding GPT image_gen; preserve pixel review as unperformed until a supported tool actually inspects pixels.
Run relevant required checks once; repeat for changes, failures or explicit requirements. Use jev-verify for ambiguous optional rechecks, or when active enforcement requires it; keep judgment separate from exit codes.
