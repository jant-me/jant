/**
 * Tests for what the first-run screens say.
 *
 * These render the component rather than the route: the point under test is
 * that an author is told which step this is — a hosted one landing on an
 * unfamiliar domain, whose site it belongs to; a self-hosted one, how much of
 * setup is left. Neither is something the POST handler or the onboarding
 * middleware can vouch for.
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

describe("SetupContent — hosted site", () => {
  const provisioned: SetupProps = {
    mode: "site",
    askSiteName: false,
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

  // A hosted author never saw a first screen — they created their account in
  // the control plane — so counting steps at them would name one they cannot
  // account for.
  it("counts no steps on the only screen it shows", () => {
    const html = render(provisioned);

    expect(html).not.toContain("Step");
  });

  // The control plane already set the clock; this screen can be opened from
  // anywhere, and the browser reporting another zone is not a decision.
  it("reports no time zone", () => {
    const html = render(provisioned);

    expect(html).not.toContain("timezone");
  });
});

/**
 * The box's state is carried by the Datastar signal, not by a `checked`
 * attribute: `data-bind` initialises the control from the signal on upgrade, so
 * the signal is what the server actually decides.
 */
describe("SetupContent — the Discover question", () => {
  const base: SetupProps = {
    mode: "site",
    askSiteName: true,
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
      askSiteName: false,
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

describe("SetupContent — self-hosted, first screen", () => {
  const account: SetupProps = { mode: "account" };

  it("wears the same one-line shell as the hosted screen, plus the count", () => {
    const html = render(account);

    expect(html).toContain("Setup · Step 1 of 2");
    expect(html).toContain("Welcome to Jant");
  });

  // The whole reason credentials get a screen of their own: an email and a
  // password with nothing between them is the shape password managers look for.
  it("asks for credentials and nothing else", () => {
    const html = render(account);

    expect(html).toContain("setup-email");
    expect(html).toContain("setup-password");
    expect(html).not.toContain("setup-site-name");
    expect(html).not.toContain("setup-content-language");
    expect(html).not.toContain("setup-discover");
  });

  // "Complete Setup" here would make the next screen read as a rejection.
  it("says it continues rather than finishes", () => {
    const html = render(account);

    expect(html).toContain(">Continue</button>");
    expect(html).not.toContain("Complete Setup");
  });
});

describe("SetupContent — self-hosted, second screen", () => {
  const site: SetupProps = {
    mode: "site",
    askSiteName: true,
    contentLanguage: "en",
    discoverAvailable: true,
    discoverDefault: false,
    discoverUrl: "https://jant.me/discover",
  };

  it("counts itself as the last step and names no site yet", () => {
    const html = render(site);

    expect(html).toContain("Setup · Step 2 of 2");
    expect(html).toContain("Set up your site");
  });

  it("asks for the site and not the account", () => {
    const html = render(site);

    expect(html).toContain("setup-site-name");
    expect(html).toContain("setup-content-language");
    expect(html).toContain("setup-discover");
    expect(html).not.toContain("setup-email");
    expect(html).not.toContain("setup-password");
  });

  // The install that is still choosing its own clock is the one that reports
  // it, so the site's time zone is settled by the screen that names the site.
  it("reports the browser's time zone", () => {
    const html = render(site);

    expect(html).toContain("timezone");
  });

  it("ends the flow rather than continuing it", () => {
    const html = render(site);

    expect(html).toContain("Start writing");
    expect(html).not.toContain(">Continue</button>");
  });
});
