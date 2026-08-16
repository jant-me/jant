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

  it("asks nothing but the language", () => {
    const html = render(provisioned);

    expect(html).toContain("setup-content-language");
    expect(html).not.toContain("setup-email");
    expect(html).not.toContain("setup-password");
    expect(html).not.toContain("setup-site-name");
  });
});

describe("SetupContent — fresh install", () => {
  const fresh: SetupProps = { mode: "full", contentLanguage: "en" };

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
