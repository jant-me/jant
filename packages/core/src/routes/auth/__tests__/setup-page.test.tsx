/**
 * Tests for what the first-run screen says.
 *
 * These render the component rather than the route: the point under test is
 * that a hosted author landing on an unfamiliar domain is told which step this
 * is and whose site it belongs to — neither of which the POST handler or the
 * onboarding middleware can vouch for.
 */

import type { Context } from "hono";
import { renderToString } from "hono/jsx/dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../i18n/context.js";
import { createI18n } from "../../../i18n/i18n.js";
import { SetupContent } from "../setup.js";

type SetupProps = Parameters<typeof SetupContent>[0];

function render(props: SetupProps): string {
  const i18n = createI18n("en");
  const c = {
    get: (key: string) => (key === "i18n" ? i18n : undefined),
  } as unknown as Context;

  I18nProvider({ c, children: "" });
  return renderToString(SetupContent(props));
}

describe("SetupContent — provisioned site", () => {
  const provisioned: SetupProps = {
    mode: "language",
    contentLanguage: "en",
    siteName: "My Blog",
    discoverAvailable: true,
    discoverDefault: true,
    discoverUrl: "https://jant.me/discover",
  };

  it("names the step and the site in one line", () => {
    const html = render(provisioned);

    expect(html).toContain("Setup · My Blog");
    expect(html).toContain("What language do you write in?");
  });

  it("keeps the line when the site has no name", () => {
    const { siteName: _omitted, ...unnamed } = provisioned;
    const html = render(unnamed);

    expect(html).toContain(">Setup</p>");
    expect(html).not.toContain("·");
  });

  it("drops a blank name rather than trailing a separator", () => {
    const html = render({ ...provisioned, siteName: "   " });

    expect(html).not.toContain("·");
  });

  it("asks nothing but the language and Discover", () => {
    const html = render(provisioned);

    expect(html).toContain("setup-content-language");
    expect(html).not.toContain("setup-email");
    expect(html).not.toContain("setup-password");
    expect(html).not.toContain("setup-site-name");
  });
});

/**
 * The box's state is carried by the Datastar signal, not by a `checked`
 * attribute: `data-bind` initialises the control from the signal on upgrade, so
 * the signal is what the server actually decides.
 */
describe("SetupContent — the Discover question", () => {
  const base: SetupProps = {
    mode: "full",
    contentLanguage: "en",
    discoverAvailable: true,
    discoverDefault: false,
    discoverUrl: "https://jant.me/discover",
  };

  it("starts clear where the deployment lists nothing by default", () => {
    const html = render(base);

    expect(html).toContain("setup-discover");
    expect(html).toContain("discover: false");
  });

  // Hosted Jant sets `DISCOVER=latest`, and the box has to say so rather than
  // showing a refusal the site would not honour.
  it("starts ticked where the deployment lists its blogs", () => {
    const html = render({ ...base, discoverDefault: true });

    expect(html).toContain("discover: true");
  });

  it("is asked on the hosted screen too", () => {
    const html = render({
      ...base,
      mode: "language",
      siteName: "My Blog",
      discoverDefault: true,
    });

    expect(html).toContain("setup-discover");
    expect(html).toContain("discover: true");
  });

  // Demo mode and feeds-off both outlive setup, so the question would be a
  // promise the next screen breaks.
  it("is not asked where the answer could not be honoured", () => {
    const html = render({
      ...base,
      discoverAvailable: false,
      discoverDefault: true,
    });

    expect(html).not.toContain("setup-discover");
    expect(html).toContain("discover: false");
  });

  // What Discover is, is best answered by the list itself, so the word for it
  // in the help line is the way there.
  it("links the word for the directory to the directory", () => {
    const html = render(base);

    expect(html).toContain(
      '<a href="https://jant.me/discover" target="_blank" rel="noopener noreferrer" class="underline hover:text-foreground transition-colors">directory</a>',
    );
  });

  // A self-hosted site that announces to no directory has no address to link,
  // and a sentence with a dead link in it is worse than a plain one.
  it("leaves the help line plain when no directory is configured", () => {
    const html = render({ ...base, discoverUrl: null });

    expect(html).toContain("Jant Discover is a directory of Jant blogs");
    expect(html).not.toContain("<a href");
  });

  // Only this screen says where the setting lives, and it spells the route out
  // of the labels those screens render — so a renamed page renames the
  // directions with it rather than sending the author somewhere that is gone.
  it("says where the setting can be changed later", () => {
    const html = render(base);

    expect(html).toContain(
      "You can change this later in Settings → General → Site visibility.",
    );
  });
});

describe("SetupContent — fresh install", () => {
  const fresh: SetupProps = {
    mode: "full",
    contentLanguage: "en",
    discoverAvailable: true,
    discoverDefault: false,
    discoverUrl: "https://jant.me/discover",
  };

  it("wears the same one-line shell as the hosted screen", () => {
    const html = render(fresh);

    expect(html).toContain(">Setup</p>");
    expect(html).toContain("Welcome to Jant");
  });

  it("asks for the site and the account", () => {
    const html = render(fresh);

    expect(html).toContain("setup-site-name");
    expect(html).toContain("setup-content-language");
    expect(html).toContain("setup-email");
    expect(html).toContain("setup-password");
  });
});
