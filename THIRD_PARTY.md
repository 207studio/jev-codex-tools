# Upstream services and related projects

This repository publishes the integration code developed for this toolkit. It does not redistribute installed upstream packages, Jev model weights, browser binaries, or private vendor archives.

- [TypeSafe](https://docs.typesafe.ai/) supplies the hosted Jev decision API. Use is subject to TypeSafe's service terms and pricing. See the [Choice API](https://docs.typesafe.ai/primitives/choice).
- [Jev Router](https://github.com/gargpratyush/jev-router) is a separate model-tier routing project. An optional bridge requires an explicit external entry path.
- [Jev Context](https://github.com/zbush/jev-context) is a separate relevance-search project, not bundled here.
- [Jev Mode](https://github.com/ddfeyes/jev-mode/tree/97615aa5cc14586488c11f6644a5b845827234c6) is a separate MIT batch-decision CLI. Our adapted Codex skill and inactive hook example reuse an existing installation; its source, credentials and shared wrapper are not bundled.
- [TypeSafe Skills](https://github.com/typesafe-ai/skills) is the official guidance project; review any existing installation before adding another copy.
- [burnigtm/jev-mcp](https://github.com/burnigtm/jev-mcp/tree/4f4ae11a5e1e9a502cdc432550d878f728851820) is a community MIT MCP server reviewed at that commit. The optional launcher requires its explicit, separately installed entry; its source and dependencies are not redistributed here.
- [Jev Ultrafast](https://github.com/browser-use/jev-ultrafast/tree/1231850a0bf1a0c0341fe408ef1668dbbfdfac46) is an MIT Chrome/browser-harness example. Its operation/target fan-out architecture informed our original Aside policy; no upstream source or browser driver is copied or bundled.
- [jevprune](https://github.com/ibrahemid/jevprune) is a separate output-filtering project. An optional bridge requires an explicit external entry path.
- [Jev Gateway](https://github.com/vinilana/jev-gateway) is a separate tool-routing proxy. Its installed distribution is not bundled here. Our [privacy and feature-switch patch](patches/jev-gateway/README.md) includes the upstream MIT notice, exact base commit and synthetic tests. It is not applied automatically. A separately installed version has its own behavior and license; review those before enabling a bridge.
- [Codex](https://github.com/openai/codex), Aside, Apple's accessibility APIs, and serve-sim are external host tools or interfaces. Their presence is not permission for a particular operation.

Third-party names identify integrations, not endorsement. Preserve upstream notices if you redistribute upstream code in a derivative. The MIT license in this repository covers this repository's original integration source; it does not relicense external services or tools.
