import { msg } from "@lingui/core/macro";
import { useLingui } from "../../../i18n/context.js";
import { toPublicPath } from "../../../lib/url.js";
import { CODE_THEMES, type CodeTheme } from "../../../types/config.js";

const themeNames = {
  github: "GitHub",
  solarized: "Solarized",
  monochrome: msg({
    message: "Monochrome",
    comment: "@context: Code theme using shades of a single hue",
  }),
} satisfies Record<CodeTheme, string | ReturnType<typeof msg>>;

export function CodeThemePicker({
  codeTheme,
  sitePathPrefix,
}: {
  codeTheme: CodeTheme;
  sitePathPrefix: string;
}) {
  const { i18n } = useLingui();

  return (
    <div
      class="max-w-form mt-8"
      data-signals={JSON.stringify({ codeTheme })}
      data-on:change={`@post('${toPublicPath("/settings/code-theme", sitePathPrefix)}')`}
      data-indicator="_codeThemeSaving"
    >
      <fieldset aria-describedby="code-theme-description">
        <legend class="text-lg font-semibold" id="code-theme-heading">
          {i18n._(
            msg({
              message: "Code theme",
              comment: "@context: Code block color theme settings heading",
            }),
          )}
        </legend>
        <p
          class="text-sm text-muted-foreground mb-3"
          id="code-theme-description"
        >
          {i18n._(
            msg({
              message:
                "Choose the colors used to highlight code blocks in posts.",
              comment: "@context: Code block color theme settings description",
            }),
          )}
        </p>
        <div class="grid gap-3">
          {CODE_THEMES.map((id) => {
            const name = themeNames[id];
            const selected = codeTheme === id;
            const labelId = `code-theme-${id}-label`;
            return (
              <label
                key={id}
                class={`flex items-start gap-3 rounded-2xl border p-3 transition-colors has-[:enabled]:cursor-pointer ${selected ? "border-primary" : "border-border"}`}
                data-class:border-primary={`$codeTheme === '${id}'`}
                data-class:border-border={`$codeTheme !== '${id}'`}
              >
                <input
                  type="radio"
                  name="codeTheme"
                  value={id}
                  data-bind="codeTheme"
                  data-attr:disabled={`$_codeThemeSaving && $codeTheme !== '${id}'`}
                  checked={selected || undefined}
                  aria-labelledby={labelId}
                  class="mt-1"
                />
                <div class="min-w-0 flex-1">
                  <div class="font-medium" id={labelId}>
                    {typeof name === "string" ? name : i18n._(name)}
                  </div>
                  <div
                    class="prose mt-2"
                    data-code-theme-preview
                    data-code-theme={id}
                  >
                    <pre>
                      <code class="language-js">
                        {
                          '// Preview\nconst greeting = "Hello, Jant";\nconsole.log(greeting, 42);'
                        }
                      </code>
                    </pre>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
