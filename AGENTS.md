Inspect only files relevant to the request; use bounded searches before reading large ranges.
Keep command output within 4000 bytes and retain full test logs outside model context when needed.
Preserve existing changes and host permission boundaries; do not silently enable integrations. Commit changes on a topic branch and open a PR; never push directly to main or merge without explicit user authorization.
Use Jev only for finite decisions; keep facts, caching, execution, and safety checks in code.
Use the decision hook for supported tool calls and registered Jev adapters for finite choices; never bypass a denial or turn UNKNOWN into an invented verdict.
Retain UNKNOWN and low-confidence evidence; stop UI actions when state or authorization is unclear.
Never commit credentials, conversations, runtime state, generated binaries, or personal configuration.
Document actual validation and limitations; do not infer token savings or platform compatibility.
For visual finite choices use jev-visual, except GPT image_gen image generation; preserve pixel review as unperformed until a supported tool actually inspects pixels.
Before verification, use jev-verify plan and run; with shell enforcement enabled use its registered absolute path, never bypass a denial, and keep Jev's judgment separate from actual exit codes.
