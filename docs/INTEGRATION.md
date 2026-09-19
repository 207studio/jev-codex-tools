# Explicit integration

Installation exposes commands only. It never edits `AGENTS.md`, Codex configuration, hook trust, or permission policy. The `skills/` directory contains optional instructions that you may install through your usual skill workflow.

State paths are resolved from `JEV_TOOLS_HOME` when set (`config`, `state`, `cache`, `bin` subdirectories). Otherwise the corresponding XDG config/state/cache/data paths are used. `JEV_FEATURES_FILE` can select a separate feature configuration. Flags must be enabled individually; `disable all` is supported.

```sh
jev-features enable judge
jev-features enable session_reader
```

For verification, enable `verification_gate` and `verification_assessment` and use `jev-verify plan/run/assess`. See [the verification policy](VERIFICATION.md). The necessity decision does not authorize a command, and the result judgment does not override its actual exit code.

For strict shell enforcement, also enable `verification_enforcement`, register the native PreToolUse handler through the host's trust flow, and configure `verification_executable` as the installed wrapper's absolute path. Covered shell calls that are neither literal observation commands nor a canonical wrapper invocation are denied before execution. Existing interactive sessions and other tool classes remain outside this guard. Do not change trust hashes by hand.

For all hook-visible tool types, enable `decision_enforcement`. It requires a bounded Jev effect classification before normal execution policy, including file edits and MCP calls. Missing responses deny ordinary actions; narrowly defined recovery remains available. Register the absolute Jev adapter paths in `decision_executables` to use their existing judgment and action loops without wrapping them in another verification command. See [tool decision enforcement](DECISION_ENFORCEMENT.md) for uncertainty, privacy, and coverage boundaries.

Supply `JEV_API_KEY` or `TYPESAFE_API_KEY` using your existing secret management. A per-feature `JEV_<FEATURE>_ENABLED=0` override disables that feature for a command. Do not embed real credentials in hook configuration examples or repository files.

## Optional third-party bridges

Install and review the external project separately. Point the adapter at its absolute JavaScript entry file:

| Environment variable | Bridge command | Required flag |
|---|---|---|
| `JEV_ROUTER_ENTRY` | `jev-codex` | `routing` |
| `JEV_PRUNE_ENTRY` | `jevprune` | `prune` |
| `JEV_GATEWAY_ENTRY` | `jev-gateway-codex` | `tool_routing_gateway` |

These command names may conflict with upstream CLI names; use the repository's `bin/*.mjs` directly if you already have those commands. The external gateway's own configuration and logging policies still apply. Passing a home-directory environment variable does not guarantee an arbitrary upstream version honors it.

## Native adapters

- macOS: `npm run build:macos` explicitly builds the included Swift source. `JEV_MACOS_HELPER` can override its output/use path. The caller must grant accessibility permission through macOS; this package does not do so.
- iOS Simulator: pass `--serve-sim /absolute/path/to/entry.js` or set `JEV_SERVE_SIM_ENTRY`. The adapter targets an existing serve-sim 0.1.46 connection for a specific device. It does not install, start, or take over another session's simulator.
- Aside: install Aside independently and use an existing persistent tab. Do not infer faster performance than another browser without a comparable measurement.

## Hooks

`jev-codex-hooks` exposes the experimental handler source. Register it only through your host's supported hook/trust flow after inspecting the event contract and source. It is not automatically enabled, not a replacement for the host approval mechanism, and not a full-conversation compactor. Keep native fallback available.

The [hook inventory](HOOKS.md) maps all six implemented native events to their flags, Korean display names, setup requirements and fallbacks. Start with the [portable example](../hooks/example.json); it contains placeholders and never installs or enables itself.
