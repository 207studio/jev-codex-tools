# Gateway privacy and feature-switch patch

This patch publishes the modifications developed alongside Jev Codex Tools for [vinilana/jev-gateway](https://github.com/vinilana/jev-gateway). It is separate from the package's gateway launcher: installing this package does **not** apply the patch or install Gateway.

- Base: `5dde23482c85dbdf273ffa026693426b1516be00` (Gateway 0.2.2 source checkout).
- Changes: allowlist route-log metadata, mask recognized credentials in state sent for Jev decisions, and re-read an optional feature file for live requests, dry runs and dashboard status.
- The original execution arguments remain intact; ordinary prompt text can still be sent to Jev. Redaction is best effort, not complete anonymization.
- Includes synthetic privacy and feature-switch tests, plus the corresponding dashboard expectation adjustment.
- [manifest.json](manifest.json) records the base, changed files and patch digest. [LICENSE.upstream](LICENSE.upstream) preserves the upstream MIT notice. Original changes are covered by this toolkit's [MIT license](../../LICENSE).

## Apply in a separately reviewed source checkout

Use the exact base and first preserve your own changes. Then, from that Gateway checkout, run:

```sh
git apply --check /path/to/privacy-and-feature-switch.patch
git apply /path/to/privacy-and-feature-switch.patch
```

Use upstream's documented dependency installation and test commands before building or launching a patched distribution. Later upstream revisions may already include equivalent fixes or may require manual adaptation; never apply blindly or overwrite an existing installation.

Export validation checked reverse application against the modified source tree and scanned for known local credentials and personal paths. That establishes patch consistency, not runtime success on a fresh clone. Earlier local focused tests/typechecking informed these changes, but this export does not rerun the upstream suite or claim universal Gateway compatibility.
