# Skills, MCP and Aside operation selection

These integrations serve different roles. The [official TypeSafe skill](https://github.com/typesafe-ai/skills) teaches typed, finite decisions. An MCP server exposes that API to a compatible host. [Jev Ultrafast](https://github.com/browser-use/jev-ultrafast) demonstrates a browser loop; it is not a prerequisite for using Jev with Aside. Check existing installations before adding any of them.

## Optional MCP interface

`jev-mcp --entry /absolute/path/to/dist/index.js` launches a separately reviewed server. It does not download, update or bundle a server. The reviewed candidate is [burnigtm/jev-mcp at 4f4ae11](https://github.com/burnigtm/jev-mcp/tree/4f4ae11a5e1e9a502cdc432550d878f728851820), version 0.1.0, MIT, Node >=20. This toolkit itself requires Node >=24. It is a community project, not an official TypeSafe MCP distribution. Its runtime dependencies are MCP SDK, TypeSafe SDK and zod.

Install that exact commit in a separate directory, inspect its manifest and lock, use `npm ci --ignore-scripts`, and build explicitly with `node node_modules/typescript/bin/tsc`. Do not replace an existing MCP installation or run an unpinned `npx` package. Review upstream changes before updating the pin. The launcher does not verify the entry's commit or content: the operator owns that supply-chain boundary.

Use [the Codex configuration example](../examples/jev-mcp.toml). Expose only `jev_evaluate`; existing `jev-verify`, collection and host approvals remain in charge of their current paths. An MCP result is evidence, never execution authorization. The host tool allowlist does not remove upstream resource registrations. Restart the MCP connection after editing configuration.

The launcher forwards only a minimal OS environment, maps an existing `TYPESAFE_API_KEY` or `JEV_API_KEY` internally, fixes the API root to `https://api.typesafe.ai`, fixes the default model to `jev-latest`, and disables mock mode. It does not load a credential file implicitly or forward other provider keys, arbitrary base URLs or Node preload options. A user-owned launcher may explicitly load a private env file with Node's `--env-file` option. Do not commit that file or put a key in TOML. Upstream `jev_evaluate` permits a per-call model override; omit it to retain the configured model.

Send only the task-relevant bounded `state` and finite `questions`. The submitted state/questions go to TypeSafe. Full conversations, credentials and private page contents are not appropriate default payloads. `output_token_limit` limits host-visible output, not upstream input, billing or logging. The upstream service has larger request limits; this adapter is not a DLP proxy. Low confidence, incomplete coverage and errors must remain uncertain. `required = false` preserves ordinary Codex startup if MCP fails; it does not authorize bypassing a required Jev decision. Disable with `enabled = false` or `JEV_MCP_ENABLED=0`.

## Ultrafast pattern on the existing Aside path

Enable `browser_selector` and opt into `browser_fanout` with `jev-features enable browser_fanout`. This uses TypeSafe's [shared-state fan-out pattern](https://docs.typesafe.ai/patterns/fan-out): one request asks for an operation and a speculative click target; code consumes only the selected branch. Disable `browser_fanout` to retain the existing single-target policy. `control_loop` continues to govern repeated steps; selection without `--execute` performs no action.

The original implementation in `integration/aside-policy.mjs` accepts at most 40 observed, allowed controls, a bounded goal and an HTTP(S) origin. Jev receives IDs, roles and short labels, not pixels, fingerprints, full URLs, credentials, coordinates, arbitrary selectors or form values. It may select CLICK, WAIT only during an observed transition, or HANDOFF. Both the operation and used target need confidence >=0.7. Invalid responses, deadlines, secrets, consequential actions and uncertainty hand control back without inventing an answer. WAIT is limited to two 250ms observations; it does not count as a click.

Aside still supplies the observation and executes actions. Before clicking, the controller observes again and checks URL plus target fingerprint. Changed or missing targets are not clicked. The allowlist, no-text-entry rule, host permissions, action deadline and repeated-state stop remain in force. Browser text remains untrusted. Jev does not generate code or grant permission.

This ports an architectural pattern, not upstream source or its Chrome driver. No browser-harness, additional Chrome profile, text-generation model or other provider key is installed. Ultrafast's TYPE_TEXT, SELECT and scrolling operations are not added here. The observation cache used by some user installations is preserved separately. GPT `image_gen` generation remains exempt from Jev visual gating.

## Evidence and limitations

Synthetic tests cover operation/target validation, low confidence, timeouts, ignored unused answers, WAIT bounds, no-action mode, stale observation, environment isolation, disabled launch and MCP child lifecycle. They do not establish compatibility with every site or replace real page verification. The safe default is HANDOFF, not a passing visual review.

On the maintainer's Mac on 2026-09-20, the isolated complete suite passed 253 tests. The pinned MCP source built successfully, its locked dependencies reported zero known npm audit vulnerabilities, and a stdio handshake plus one synthetic `jev_evaluate` call succeeded (model `jev-1.13.0`). On an owned local fixture, Aside completed one permitted click using one Jev operation/target request, then closed the fixture tab. These are local observations, not a security guarantee, cross-platform certification or comparative speed result.

Use `jev-aside --metrics` and optional `decision_metrics` to record API calls, observed bytes, latency and provider token counts where supplied. Compare equal successful tasks against the single-target policy before claiming a benefit. Extra speculative questions can cost tokens; one combined request is not proof of savings or greater speed than Chrome. API failure or low confidence may increase host handoffs. Neither this MCP interface nor this browser policy replaces native Codex compaction or routes every internal host decision through Jev.
