# References

Third-party source code checked in as read-only reference for AI agents (Claude Code).
These are NOT runtime dependencies - they exist so the agent can look up API docs and component examples without web access.

## Contents

| Directory              | Source                                              | Version    | Commit    |
| ---------------------- | --------------------------------------------------- | ---------- | --------- |
| `basecoat/`            | https://github.com/hunvreus/basecoat                | 0.3.10     | `713c163` |
| `datastar/`            | https://github.com/starfederation/datastar          | 1.0.4      | `1efcdc3` |
| `lingui-po-translate/` | https://github.com/theowenyoung/lingui-po-translate | 1.0.10     | `9af94cf` |
| `wxt/`                 | https://github.com/wxt-dev/wxt                      | 0.20.20    | `ffdd15e` |
| `tufte-css/`           | https://github.com/edwardtufte/tufte-css             | 1.8.0      | `c0a7db6` |

## Updating

```bash
# Remove old version and clone fresh (from project root)
rm -rf references/basecoat
git clone --depth 1 https://github.com/hunvreus/basecoat.git references/basecoat
rm -rf references/basecoat/.git

rm -rf references/datastar
git clone --depth 1 https://github.com/starfederation/datastar.git references/datastar
rm -rf references/datastar/.git

rm -rf references/lingui-po-translate
git clone --depth 1 https://github.com/theowenyoung/lingui-po-translate.git references/lingui-po-translate
rm -rf references/lingui-po-translate/.git

rm -rf references/wxt
git clone --depth 1 https://github.com/wxt-dev/wxt.git references/wxt
rm -rf references/wxt/.git

rm -rf references/tufte-css
git clone --depth 1 https://github.com/edwardtufte/tufte-css.git references/tufte-css
rm -rf references/tufte-css/.git
```

After updating, update the version and commit in the table above.
