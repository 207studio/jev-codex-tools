---
name: jev-verify
description: Ask Jev whether a proposed verification is necessary before running it, then classify bounded evidence separately from the real command exit status. Use to avoid optional repeated tests or inspections.
---

Define the question, affected files, proposed command, and whether a check is required by the user, project, or safety constraints in a small spec. Use the existing spec when its scope is still accurate; do not perform broad exploration just to fill it. Never mark a required check optional to obtain SKIP.

Group related checks into one bounded plan. Ordinary parsing, exit-code reads, hashes, and cache reads are code operations, not new semantic verification tasks that each need another model request.

Run `jev-verify plan --spec FILE` before attempting verification. Jev selects RUN, NARROW, SKIP, or UNKNOWN. Code prevents SKIP for mandatory checks, new failures, high/normal risk, or incomplete file scope. Treat the declared file scope as a caller assertion, not automatic dependency discovery.

Run an authorized command with `jev-verify run --spec FILE --execute`. This repeats the gate using the current file fingerprint and reuses eligible cached decisions. NARROW may use only the caller's supplied `narrow_argv`; Jev never invents a command. A SKIP result means not executed, never passed.

The wrapper records the actual exit code and a private full log. Jev separately returns SUPPORTED, CONTRADICTED, or INSUFFICIENT about the goal and bounded evidence. API failure or uncertainty is not a test pass. For an existing log use `jev-verify assess --spec FILE --log LOG --exit-code N`, reporting the original exit code honestly.

After a sufficient relevant check passes, stop unless code/input changes, a new failure, or a required check justifies more work. Never use this decision gate to bypass a host approval, permission boundary, user hold, or required safety validation. Do not forward full logs or repeat cached reasoning to the parent model.
