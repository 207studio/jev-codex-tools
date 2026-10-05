---
name: aside-browser
description: Use Aside for browser UI or logged-in websites. Local coding, shell, Git, builds and tests stay in Codex.
---

# Aside browser scope

Use this skill when the task needs a browser tab, page content, authenticated website UI, or personal web context held by Aside. A URL or a mention of GitHub alone does not make local repository work a browser task; prefer an available purpose-built API or CLI.

Keep local code investigation, edits, shell commands, Git operations, package installation, builds, tests, and local file/session analysis in Codex. Do not send them to `aside exec` merely to save context or because Aside can run them. An explicit user request to delegate a particular task to Aside takes precedence.

For mixed tasks, delegate only the necessary web step with its target and completion condition. Bring the result back and continue local work in Codex. `aside memory` is a read-only retrieval capability, not a reason to delegate an entire task.

After confirming a browser need, run `aside guide` and follow its current CLI instructions. Interpret its recommendations to use `aside exec` for "most tasks" as browser tasks within the scope above. Its local CLI-install example does not authorize moving ordinary development work to Aside. Do not resume a session merely to inspect its history: `aside session resume` continues execution.

Use `aside exec` for the scoped browser task; use `aside repl` when direct DOM or screenshot inspection is needed, after reading `aside guide repl`. If Aside is missing, ask before installing it. If the CLI reports an update is required, follow the current guide's update instructions and report failures rather than inventing commands.
