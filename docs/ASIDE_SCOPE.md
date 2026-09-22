# Keep ordinary development work in Codex

Aside's current guide recommends delegating "most tasks" and includes a local CLI-install example. These instructions appear within a browser guide but can be interpreted too broadly after the skill is loaded. The installed skill also mentioned personal context alongside browsing, which could trigger it for local history work.

This package's [scoped entry](../skills/aside-browser/SKILL.md) makes the boundary explicit: use Aside for browser UI, authenticated websites and Aside-held web context. Keep local code investigation, editing, shell, Git, package installation, builds, tests and local file/session analysis in Codex. For mixed requests, delegate only the web step. An explicit user request for a particular Aside delegation still takes precedence.

## Codex-only activation

Place the scoped entry at `~/.codex/skills/aside-browser/SKILL.md`. In the existing Codex `config.toml`, disable the original `.agents/skills/aside-browser/SKILL.md` entry and enable the scoped `.codex/skills/aside-browser/SKILL.md` entry using `[[skills.config]]` with the two resolved absolute paths. Preserve every unrelated setting and back up the existing config first. Do not edit or disable the shared source for other agents. No new package, hook, API request, or global AGENTS rule is required.

This entry still loads `aside guide` when a browser task actually needs it; it does not copy or freeze CLI usage. Guide recommendations about delegation remain confined to the current browser task. A reference to a URL, GitHub or context savings alone does not justify handing local development work to a browser agent.

## Observed evidence and limits

The local audit on 2026-09-22 found registered Codex hooks, but no general shell/edit-to-Aside dispatcher in the examined runtime. `runAside` was entered through its explicit controller CLI. Its selector/fanout flags did not create an automatic entry point. The patch therefore changes the skill's scope instead of disabling legitimate browser features.

The skill validator passed. A fresh native `codex debug prompt-input` render exposed exactly one `aside-browser` entry, resolving to the scoped Codex skill. The original shared skill, existing hooks and empty global AGENTS file retained their hashes. This establishes configuration and discovery, not a proof that every model will obey the boundary in every task. A previously running conversation can retain old instructions until its skill context is refreshed.

The reported individual session was not found in the accessible CLI listing or app search. Its causal execution trace is unverified. Do not claim this change proves what happened in that session. `aside session resume` was deliberately not used for inspection because it continues execution rather than merely reading history.

To undo the local override, restore the previous two skill settings and remove only the scoped entry added for this change. Keep the original shared skill and all other settings intact.
