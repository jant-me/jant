import { describe, expect, it } from "vitest";
import { renderSiteUnavailablePage } from "../site-unavailable-page.js";

describe("renderSiteUnavailablePage", () => {
  it("links back to the configured hosting provider", () => {
    const html = renderSiteUnavailablePage({
      HOSTED_CONTROL_PLANE_BASE_URL: "https://cloud-jant.localtest.me",
      HOSTED_CONTROL_PLANE_PROVIDER_NAME: "Jant Cloud",
      SITE_RESOLUTION_MODE: "host-based",
    });

    expect(html).toContain("This site is offline");
    expect(html).toContain(
      '<a href="https://cloud-jant.localtest.me/app">Jant Cloud</a>',
    );
  });

  it("stays provider-neutral when no control plane is configured", () => {
    const html = renderSiteUnavailablePage({});

    expect(html).toContain("There's nothing to read here right now");
    expect(html).toContain("sign in to your hosting provider");
    expect(html).not.toContain("<a ");
  });
});
