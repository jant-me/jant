import { msg } from "@lingui/core/macro";
import { useLingui } from "../../i18n/context.js";
import {
  getJantBrandPackHref,
  getJantIconFilename,
  getJantIconHref,
  getJantPositiveLogoPngHref,
  getJantLogoFilename,
  getJantLogoHref,
  JANT_BRAND_PACK_FILENAME,
  JANT_POSITIVE_LOGO_PNG_FILENAME,
  type JantIconAsset,
  type JantLogoVariant,
} from "../../lib/jant-branding.js";
import { JantBrandMark } from "../shared/JantBrandMark.js";

function LogoResourceCard({
  title,
  usage,
  body,
  variant,
  href,
  filename,
  downloadLabel,
  pngDownloadHref,
  pngFilename,
  pngDownloadLabel,
  rawLabel,
}: {
  title: string;
  usage: string;
  body: string;
  variant: JantLogoVariant;
  href: string;
  filename: string;
  downloadLabel: string;
  pngDownloadHref?: string;
  pngFilename?: string;
  pngDownloadLabel?: string;
  rawLabel: string;
}) {
  return (
    <article class="brand-logo-card">
      <div
        class={`brand-logo-preview${variant === "negative" ? " brand-logo-preview-dark" : ""}`}
      >
        <JantBrandMark
          variant={variant}
          class="brand-logo-preview-mark"
          label={title}
        />
      </div>
      <div class="brand-logo-copy">
        <p class="brand-spec-card-role">{usage}</p>
        <h3 class="brand-logo-title">{title}</h3>
        <p class="brand-logo-body">{body}</p>
        <code class="brand-spec-card-value">{filename}</code>
      </div>
      <div class="brand-logo-actions">
        <a href={href} download={filename} class="btn-primary">
          {downloadLabel}
        </a>
        {pngDownloadHref && pngFilename && pngDownloadLabel && (
          <a href={pngDownloadHref} download={pngFilename} class="btn-outline">
            {pngDownloadLabel}
          </a>
        )}
        <a href={href} class="btn-outline">
          {rawLabel}
        </a>
      </div>
    </article>
  );
}

function IconResourceCard({
  title,
  usage,
  body,
  asset,
  href,
  filename,
  badge,
  downloadLabel,
  rawLabel,
}: {
  title: string;
  usage: string;
  body: string;
  asset: JantIconAsset;
  href: string;
  filename: string;
  badge: string;
  downloadLabel: string;
  rawLabel: string;
}) {
  return (
    <article class="brand-logo-card brand-icon-card">
      <div class="brand-icon-preview">
        <div class="brand-icon-preview-tile">
          <JantBrandMark
            variant="negative"
            class="brand-icon-preview-mark"
            label={title}
          />
        </div>
        <span class="brand-icon-preview-badge">
          {asset === "favicon" ? "ICO" : badge}
        </span>
      </div>
      <div class="brand-logo-copy">
        <p class="brand-spec-card-role">{usage}</p>
        <h3 class="brand-logo-title">{title}</h3>
        <p class="brand-logo-body">{body}</p>
        <code class="brand-spec-card-value">{filename}</code>
      </div>
      <div class="brand-logo-actions">
        <a href={href} download={filename} class="btn-primary">
          {downloadLabel}
        </a>
        <a href={href} class="btn-outline">
          {rawLabel}
        </a>
      </div>
    </article>
  );
}

function SquareLogoResourceCard({
  title,
  usage,
  body,
  variant,
  badge,
  pngHref,
  pngFilename,
  svgHref,
  svgFilename,
  downloadPngLabel,
  downloadSvgLabel,
  rawPngLabel,
}: {
  title: string;
  usage: string;
  body: string;
  variant: JantLogoVariant;
  badge: string;
  pngHref: string;
  pngFilename: string;
  svgHref: string;
  svgFilename: string;
  downloadPngLabel: string;
  downloadSvgLabel: string;
  rawPngLabel: string;
}) {
  return (
    <article class="brand-logo-card brand-icon-card">
      <div class="brand-icon-preview">
        <div class="brand-icon-preview-tile brand-icon-preview-tile-light">
          <JantBrandMark
            variant={variant}
            class="brand-icon-preview-mark"
            label={title}
          />
        </div>
        <span class="brand-icon-preview-badge">{badge}</span>
      </div>
      <div class="brand-logo-copy">
        <p class="brand-spec-card-role">{usage}</p>
        <h3 class="brand-logo-title">{title}</h3>
        <p class="brand-logo-body">{body}</p>
        <code class="brand-spec-card-value">{pngFilename}</code>
      </div>
      <div class="brand-logo-actions">
        <a href={pngHref} download={pngFilename} class="btn-primary">
          {downloadPngLabel}
        </a>
        <a href={svgHref} download={svgFilename} class="btn-outline">
          {downloadSvgLabel}
        </a>
        <a href={pngHref} class="btn-outline">
          {rawPngLabel}
        </a>
      </div>
    </article>
  );
}

function BrandTileResourceCard({
  title,
  usage,
  body,
  badge,
  pngHref,
  pngFilename,
  svgHref,
  svgFilename,
  downloadPngLabel,
  downloadSvgLabel,
  rawPngLabel,
  previewClassName,
}: {
  title: string;
  usage: string;
  body: string;
  badge: string;
  pngHref: string;
  pngFilename: string;
  svgHref: string;
  svgFilename: string;
  downloadPngLabel: string;
  downloadSvgLabel: string;
  rawPngLabel: string;
  previewClassName?: string;
}) {
  return (
    <article class="brand-logo-card brand-icon-card">
      <div class="brand-icon-preview">
        <div
          class={`brand-icon-preview-tile${previewClassName ? ` ${previewClassName}` : ""}`}
        >
          <JantBrandMark
            variant="negative"
            class="brand-icon-preview-mark"
            label={title}
          />
        </div>
        <span class="brand-icon-preview-badge">{badge}</span>
      </div>
      <div class="brand-logo-copy">
        <p class="brand-spec-card-role">{usage}</p>
        <h3 class="brand-logo-title">{title}</h3>
        <p class="brand-logo-body">{body}</p>
        <code class="brand-spec-card-value">{pngFilename}</code>
      </div>
      <div class="brand-logo-actions">
        <a href={pngHref} download={pngFilename} class="btn-primary">
          {downloadPngLabel}
        </a>
        <a href={svgHref} download={svgFilename} class="btn-outline">
          {downloadSvgLabel}
        </a>
        <a href={pngHref} class="btn-outline">
          {rawPngLabel}
        </a>
      </div>
    </article>
  );
}

function GuidanceCard({ title, body }: { title: string; body: string }) {
  return (
    <article class="brand-guidance-card">
      <h3 class="brand-guidance-title">{title}</h3>
      <p class="brand-guidance-body">{body}</p>
    </article>
  );
}

export function BrandPage({
  sitePathPrefix = "",
}: {
  sitePathPrefix?: string;
}) {
  const { i18n } = useLingui();
  const brandPackHref = getJantBrandPackHref(sitePathPrefix);
  const positiveLogoHref = getJantLogoHref("positive", sitePathPrefix);
  const negativeLogoHref = getJantLogoHref("negative", sitePathPrefix);
  const positiveLogoPngHref = getJantPositiveLogoPngHref(sitePathPrefix);
  const brandTileSvgHref = getJantIconHref("brandTileSvg", sitePathPrefix);
  const brandTilePngHref = getJantIconHref("brandTilePng", sitePathPrefix);
  const squareTileSvgHref = getJantIconHref("squareTileSvg", sitePathPrefix);
  const squareTilePngHref = getJantIconHref("squareTilePng", sitePathPrefix);
  const circleTileSvgHref = getJantIconHref("circleTileSvg", sitePathPrefix);
  const circleTilePngHref = getJantIconHref("circleTilePng", sitePathPrefix);
  const faviconAssetHref = getJantIconHref("favicon", sitePathPrefix);
  const appleTouchHref = getJantIconHref("appleTouch", sitePathPrefix);
  const socialImageHref = getJantIconHref("socialImage", sitePathPrefix);
  const positiveLogoFilename = getJantLogoFilename("positive");
  const negativeLogoFilename = getJantLogoFilename("negative");
  const positiveLogoPngFilename = JANT_POSITIVE_LOGO_PNG_FILENAME;
  const brandTileSvgFilename = getJantIconFilename("brandTileSvg");
  const brandTilePngFilename = getJantIconFilename("brandTilePng");
  const squareTileSvgFilename = getJantIconFilename("squareTileSvg");
  const squareTilePngFilename = getJantIconFilename("squareTilePng");
  const circleTileSvgFilename = getJantIconFilename("circleTileSvg");
  const circleTilePngFilename = getJantIconFilename("circleTilePng");
  const faviconAssetFilename = getJantIconFilename("favicon");
  const appleTouchFilename = getJantIconFilename("appleTouch");
  const socialImageFilename = getJantIconFilename("socialImage");
  const logoLabel = i18n._(
    msg({
      message: "Jant logo",
      comment: "@context: Accessible label for the Jant logo mark",
    }),
  );
  const downloadSvgLabel = i18n._(
    msg({
      message: "Download SVG",
      comment: "@context: Download button label for a logo asset",
    }),
  );
  const downloadPngLabel = i18n._(
    msg({
      message: "Download PNG",
      comment: "@context: Download button label for a PNG logo asset",
    }),
  );
  const openRawPngLabel = i18n._(
    msg({
      message: "Open raw PNG",
      comment:
        "@context: Button label to open the raw PNG asset in the browser",
    }),
  );
  const openRawSvgLabel = i18n._(
    msg({
      message: "Open raw SVG",
      comment:
        "@context: Button label to open the raw SVG asset in the browser",
    }),
  );
  const downloadFileLabel = i18n._(
    msg({
      message: "Download file",
      comment: "@context: Download button label for a non-SVG brand asset",
    }),
  );
  const openRawAssetLabel = i18n._(
    msg({
      message: "Open raw asset",
      comment:
        "@context: Button label to open a raw brand asset in the browser",
    }),
  );
  const downloadBrandPackLabel = i18n._(
    msg({
      message: "Download Brand Pack",
      comment: "@context: Primary hero button label for the brand pack ZIP",
    }),
  );
  const browseFilesLabel = i18n._(
    msg({
      message: "Browse files",
      comment: "@context: Secondary hero button label to jump to the file list",
    }),
  );
  const defaultLogoBody = i18n._(
    msg({
      message:
        "Use this for websites, docs, articles, and other light or neutral surfaces.",
      comment: "@context: Description for the default logo card",
    }),
  );
  const reverseLogoBody = i18n._(
    msg({
      message:
        "Use this on dark backgrounds, image-backed surfaces, and any placement where the green logo would lose contrast.",
      comment: "@context: Description for the reverse logo card",
    }),
  );
  const brandPackBody = i18n._(
    msg({
      message:
        "A single ZIP with the main logo, reverse logo, square PNG, rounded, square, and circle tiles, plus favicon, Apple touch icon, and social preview image.",
      comment: "@context: Description for the brand pack card",
    }),
  );

  return (
    <div class="brand-page py-8">
      <section class="brand-hero">
        <div class="brand-hero-copy">
          <div class="brand-mark-lockup">
            <JantBrandMark class="brand-hero-mark" label={logoLabel} />
            <p class="brand-eyebrow">
              {i18n._(
                msg({
                  message: "Brand assets",
                  comment: "@context: Eyebrow on the public brand asset page",
                }),
              )}
            </p>
          </div>
          <h1 class="brand-title">
            {i18n._(
              msg({
                message:
                  "Download the official Jant logo, icons, and preview files.",
                comment: "@context: Hero title on the public brand asset page",
              }),
            )}
          </h1>
          <p class="brand-lead">
            {i18n._(
              msg({
                message:
                  "Everything on this page is ready to use for articles, launch posts, directories, and product coverage.",
                comment:
                  "@context: Intro paragraph on the public brand asset page",
              }),
            )}
          </p>

          <div class="brand-hero-actions">
            <a
              href={brandPackHref}
              download={JANT_BRAND_PACK_FILENAME}
              class="btn-primary"
            >
              {downloadBrandPackLabel}
            </a>
            <a href="#brand-files" class="btn-outline">
              {browseFilesLabel}
            </a>
          </div>

          <div
            class="brand-keywords"
            aria-label={i18n._(
              msg({
                message: "Included assets",
                comment:
                  "@context: Accessible label for the asset keyword list on the public brand page",
              }),
            )}
          >
            {[
              i18n._(
                msg({
                  message: "Logo",
                  comment:
                    "@context: Asset keyword on the public brand asset page",
                }),
              ),
              i18n._(
                msg({
                  message: "Reverse logo",
                  comment:
                    "@context: Asset keyword on the public brand asset page",
                }),
              ),
              i18n._(
                msg({
                  message: "Square logo",
                  comment:
                    "@context: Asset keyword on the public brand asset page",
                }),
              ),
              i18n._(
                msg({
                  message: "Brand tile",
                  comment:
                    "@context: Asset keyword on the public brand asset page",
                }),
              ),
              i18n._(
                msg({
                  message: "Circle tile",
                  comment:
                    "@context: Asset keyword on the public brand asset page",
                }),
              ),
              i18n._(
                msg({
                  message: "Social preview",
                  comment:
                    "@context: Asset keyword on the public brand asset page",
                }),
              ),
            ].map((keyword) => (
              <span key={keyword} class="brand-keyword">
                {keyword}
              </span>
            ))}
          </div>
        </div>

        <aside class="brand-manifest">
          <div class="brand-manifest-header">
            <p class="brand-panel-kicker">
              {i18n._(
                msg({
                  message: "Start here",
                  comment:
                    "@context: Heading for the quick-start panel on the brand asset page",
                }),
              )}
            </p>
            <h2 class="brand-panel-title">
              {i18n._(
                msg({
                  message: "Everything most people need is in one ZIP.",
                  comment:
                    "@context: Section title for the quick-start panel on the brand asset page",
                }),
              )}
            </h2>
          </div>

          <p class="brand-panel-body brand-manifest-body">
            {i18n._(
              msg({
                message:
                  "The brand pack includes SVG logos, a transparent square PNG, rounded, square, and circle tiles, plus favicon, Apple touch icon, and the default social preview image.",
                comment:
                  "@context: Intro copy for the quick-start panel on the brand asset page",
              }),
            )}
          </p>

          <div class="brand-logo-actions brand-manifest-actions">
            <a
              href={brandPackHref}
              download={JANT_BRAND_PACK_FILENAME}
              class="btn-primary"
            >
              {downloadBrandPackLabel}
            </a>
          </div>

          <div class="brand-entry-grid">
            <article class="brand-entry-card">
              <div class="brand-entry-preview">
                <div class="brand-entry-surface">
                  <JantBrandMark
                    class="brand-entry-mark"
                    label={i18n._(
                      msg({
                        message: "Logo",
                        comment:
                          "@context: Asset keyword on the public brand asset page",
                      }),
                    )}
                  />
                </div>
              </div>
              <div class="brand-entry-copy">
                <p class="brand-spec-card-role">
                  {i18n._(
                    msg({
                      message: "Default logo",
                      comment:
                        "@context: Usage label for the default logo card",
                    }),
                  )}
                </p>
                <h3 class="brand-logo-title">
                  {i18n._(
                    msg({
                      message: "Logo",
                      comment: "@context: Title for the default logo card",
                    }),
                  )}
                </h3>
                <p class="brand-logo-body">{defaultLogoBody}</p>
              </div>
              <div class="brand-logo-actions">
                <a
                  href={positiveLogoHref}
                  download={positiveLogoFilename}
                  class="btn-primary"
                >
                  {downloadSvgLabel}
                </a>
                <a
                  href={positiveLogoPngHref}
                  download={positiveLogoPngFilename}
                  class="btn-outline"
                >
                  {downloadPngLabel}
                </a>
              </div>
            </article>

            <article class="brand-entry-card">
              <div class="brand-entry-preview brand-entry-preview-dark">
                <div class="brand-entry-surface brand-entry-surface-dark">
                  <JantBrandMark
                    variant="negative"
                    class="brand-entry-mark"
                    label={i18n._(
                      msg({
                        message: "Reverse logo",
                        comment: "@context: Title for the reverse logo card",
                      }),
                    )}
                  />
                </div>
              </div>
              <div class="brand-entry-copy">
                <p class="brand-spec-card-role">
                  {i18n._(
                    msg({
                      message: "Dark backgrounds",
                      comment:
                        "@context: Usage label for the reverse logo card",
                    }),
                  )}
                </p>
                <h3 class="brand-logo-title">
                  {i18n._(
                    msg({
                      message: "Reverse logo",
                      comment: "@context: Title for the reverse logo card",
                    }),
                  )}
                </h3>
                <p class="brand-logo-body">{reverseLogoBody}</p>
              </div>
              <div class="brand-logo-actions">
                <a
                  href={negativeLogoHref}
                  download={negativeLogoFilename}
                  class="btn-primary"
                >
                  {downloadSvgLabel}
                </a>
                <a href={negativeLogoHref} class="btn-outline">
                  {openRawSvgLabel}
                </a>
              </div>
            </article>

            <article class="brand-entry-card">
              <div class="brand-entry-preview">
                <div class="brand-entry-surface brand-entry-surface-stack">
                  <JantBrandMark
                    class="brand-entry-mark"
                    label={i18n._(
                      msg({
                        message: "Brand pack",
                        comment: "@context: Title for the brand pack card",
                      }),
                    )}
                  />
                  <div class="brand-entry-files" aria-hidden="true">
                    {["SVG", "PNG", "ICO", "ZIP"].map((label) => (
                      <span key={label} class="brand-entry-filechip">
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div class="brand-entry-copy">
                <p class="brand-spec-card-role">
                  {i18n._(
                    msg({
                      message: "Everything in one download",
                      comment: "@context: Usage label for the brand pack card",
                    }),
                  )}
                </p>
                <h3 class="brand-logo-title">
                  {i18n._(
                    msg({
                      message: "Brand pack",
                      comment: "@context: Title for the brand pack card",
                    }),
                  )}
                </h3>
                <p class="brand-logo-body">{brandPackBody}</p>
                <code class="brand-spec-card-value">
                  {JANT_BRAND_PACK_FILENAME}
                </code>
              </div>
              <div class="brand-logo-actions">
                <a
                  href={brandPackHref}
                  download={JANT_BRAND_PACK_FILENAME}
                  class="btn-primary"
                >
                  {downloadBrandPackLabel}
                </a>
                <a href="#brand-files" class="btn-outline">
                  {browseFilesLabel}
                </a>
              </div>
            </article>
          </div>
        </aside>
      </section>

      <section class="brand-logo-resources" id="brand-files">
        <article class="brand-panel">
          <p class="brand-panel-kicker">
            {i18n._(
              msg({
                message: "Guidelines",
                comment:
                  "@context: Section kicker for the usage guidance section on the brand asset page",
              }),
            )}
          </p>
          <h2 class="brand-panel-title">
            {i18n._(
              msg({
                message: "A few simple rules.",
                comment:
                  "@context: Section title for the usage guidance section on the brand asset page",
              }),
            )}
          </h2>
          <div class="brand-guidance-grid">
            <GuidanceCard
              title={i18n._(
                msg({
                  message: "Use the logo on light backgrounds.",
                  comment: "@context: Guidance title on the brand asset page",
                }),
              )}
              body={i18n._(
                msg({
                  message:
                    "Choose the standard logo for websites, docs, directories, and editorial layouts.",
                  comment: "@context: Guidance body on the brand asset page",
                }),
              )}
            />
            <GuidanceCard
              title={i18n._(
                msg({
                  message: "Use the reverse logo on dark backgrounds.",
                  comment: "@context: Guidance title on the brand asset page",
                }),
              )}
              body={i18n._(
                msg({
                  message:
                    "Switch to the white logo when the standard green version would lose contrast.",
                  comment: "@context: Guidance body on the brand asset page",
                }),
              )}
            />
            <GuidanceCard
              title={i18n._(
                msg({
                  message: "Keep the artwork unchanged.",
                  comment: "@context: Guidance title on the brand asset page",
                }),
              )}
              body={i18n._(
                msg({
                  message:
                    "Do not recolor, stretch, rotate, outline, or add effects to the logo.",
                  comment: "@context: Guidance body on the brand asset page",
                }),
              )}
            />
          </div>
        </article>

        <article class="brand-panel brand-panel-resource" id="brand-logos">
          <p class="brand-panel-kicker">
            {i18n._(
              msg({
                message: "Logos",
                comment:
                  "@context: Section kicker for the logo downloads section",
              }),
            )}
          </p>
          <h2 class="brand-panel-title">
            {i18n._(
              msg({
                message: "Primary logo files",
                comment:
                  "@context: Section title for the logo downloads section",
              }),
            )}
          </h2>
          <div class="brand-panel-body">
            <p>
              {i18n._(
                msg({
                  message:
                    "Choose the standard logo for most placements and the reverse logo when you need more contrast.",
                  comment: "@context: Body copy for the logo downloads section",
                }),
              )}
            </p>
          </div>
        </article>

        <div class="brand-logo-grid">
          <LogoResourceCard
            title={i18n._(
              msg({
                message: "Logo",
                comment: "@context: Title for the default logo asset card",
              }),
            )}
            usage={i18n._(
              msg({
                message: "Default",
                comment:
                  "@context: Usage label for the default logo asset card",
              }),
            )}
            body={i18n._(
              msg({
                message:
                  "Primary Jant logo for websites, docs, press coverage, and editorial layouts.",
                comment:
                  "@context: Description for the default logo asset card",
              }),
            )}
            variant="positive"
            href={positiveLogoHref}
            filename={positiveLogoFilename}
            downloadLabel={downloadSvgLabel}
            pngDownloadHref={positiveLogoPngHref}
            pngFilename={positiveLogoPngFilename}
            pngDownloadLabel={downloadPngLabel}
            rawLabel={openRawSvgLabel}
          />
          <LogoResourceCard
            title={i18n._(
              msg({
                message: "Reverse logo",
                comment: "@context: Title for the reverse logo asset card",
              }),
            )}
            usage={i18n._(
              msg({
                message: "Dark backgrounds",
                comment:
                  "@context: Usage label for the reverse logo asset card",
              }),
            )}
            body={reverseLogoBody}
            variant="negative"
            href={negativeLogoHref}
            filename={negativeLogoFilename}
            downloadLabel={downloadSvgLabel}
            rawLabel={openRawSvgLabel}
          />
        </div>

        <article class="brand-panel brand-panel-resource">
          <p class="brand-panel-kicker">
            {i18n._(
              msg({
                message: "Icons and previews",
                comment:
                  "@context: Section kicker for the icon and preview downloads section",
              }),
            )}
          </p>
          <h2 class="brand-panel-title">
            {i18n._(
              msg({
                message:
                  "Square assets for avatars, apps, browsers, and shared links",
                comment:
                  "@context: Section title for the icon and preview downloads section",
              }),
            )}
          </h2>
          <div class="brand-panel-body">
            <p>
              {i18n._(
                msg({
                  message:
                    "Use these when you need a transparent square logo, a shaped tile with a built-in background, a browser icon, or a default preview image.",
                  comment:
                    "@context: Body copy for the icon and preview downloads section",
                }),
              )}
            </p>
          </div>
        </article>

        <div class="brand-icon-grid" id="brand-icons">
          <SquareLogoResourceCard
            title={i18n._(
              msg({
                message: "Square logo PNG",
                comment: "@context: Title for the square logo PNG asset card",
              }),
            )}
            usage={i18n._(
              msg({
                message: "Transparent square",
                comment:
                  "@context: Usage label for the square logo PNG asset card",
              }),
            )}
            body={i18n._(
              msg({
                message:
                  "A ready-made 1:1 PNG for decks, mockups, directories, and other square placements.",
                comment:
                  "@context: Description for the square logo PNG asset card",
              }),
            )}
            variant="positive"
            badge="512"
            pngHref={positiveLogoPngHref}
            pngFilename={positiveLogoPngFilename}
            svgHref={positiveLogoHref}
            svgFilename={positiveLogoFilename}
            downloadPngLabel={downloadPngLabel}
            downloadSvgLabel={downloadSvgLabel}
            rawPngLabel={openRawPngLabel}
          />
          <BrandTileResourceCard
            title={i18n._(
              msg({
                message: "Brand tile",
                comment: "@context: Title for the brand tile asset card",
              }),
            )}
            usage={i18n._(
              msg({
                message: "Built-in background",
                comment: "@context: Usage label for the brand tile asset card",
              }),
            )}
            body={i18n._(
              msg({
                message:
                  "White logo on the Jant green rounded tile for app icon mockups, touch icons, directory listings, and other square placements that should feel softer.",
                comment: "@context: Description for the brand tile asset card",
              }),
            )}
            badge="512"
            pngHref={brandTilePngHref}
            pngFilename={brandTilePngFilename}
            svgHref={brandTileSvgHref}
            svgFilename={brandTileSvgFilename}
            downloadPngLabel={downloadPngLabel}
            downloadSvgLabel={downloadSvgLabel}
            rawPngLabel={openRawPngLabel}
          />
          <BrandTileResourceCard
            title={i18n._(
              msg({
                message: "Square tile",
                comment: "@context: Title for the square tile asset card",
              }),
            )}
            usage={i18n._(
              msg({
                message: "Hard edge",
                comment: "@context: Usage label for the square tile asset card",
              }),
            )}
            body={i18n._(
              msg({
                message:
                  "White logo on the Jant green square tile for platforms and layouts that expect a true edge-to-edge square.",
                comment: "@context: Description for the square tile asset card",
              }),
            )}
            badge="512"
            pngHref={squareTilePngHref}
            pngFilename={squareTilePngFilename}
            svgHref={squareTileSvgHref}
            svgFilename={squareTileSvgFilename}
            downloadPngLabel={downloadPngLabel}
            downloadSvgLabel={downloadSvgLabel}
            rawPngLabel={openRawPngLabel}
            previewClassName="brand-icon-preview-tile-square"
          />
          <BrandTileResourceCard
            title={i18n._(
              msg({
                message: "Circle tile",
                comment: "@context: Title for the circle tile asset card",
              }),
            )}
            usage={i18n._(
              msg({
                message: "Avatar-ready",
                comment: "@context: Usage label for the circle tile asset card",
              }),
            )}
            body={i18n._(
              msg({
                message:
                  "White logo on the Jant green circle for profile images, badges, and other round placements where you want a ready-made asset.",
                comment: "@context: Description for the circle tile asset card",
              }),
            )}
            badge="512"
            pngHref={circleTilePngHref}
            pngFilename={circleTilePngFilename}
            svgHref={circleTileSvgHref}
            svgFilename={circleTileSvgFilename}
            downloadPngLabel={downloadPngLabel}
            downloadSvgLabel={downloadSvgLabel}
            rawPngLabel={openRawPngLabel}
            previewClassName="brand-icon-preview-tile-circle"
          />
          <IconResourceCard
            title={i18n._(
              msg({
                message: "Favicon",
                comment: "@context: Title for the favicon asset card",
              }),
            )}
            usage={i18n._(
              msg({
                message: "Browser tab",
                comment: "@context: Usage label for the favicon asset card",
              }),
            )}
            body={i18n._(
              msg({
                message: "Small browser icon used in tabs and bookmarks.",
                comment: "@context: Description for the favicon asset card",
              }),
            )}
            asset="favicon"
            href={faviconAssetHref}
            filename={faviconAssetFilename}
            badge="ICO"
            downloadLabel={downloadFileLabel}
            rawLabel={openRawAssetLabel}
          />
          <IconResourceCard
            title={i18n._(
              msg({
                message: "Apple touch icon",
                comment: "@context: Title for the apple touch icon asset card",
              }),
            )}
            usage={i18n._(
              msg({
                message: "iOS home screen",
                comment:
                  "@context: Usage label for the apple touch icon asset card",
              }),
            )}
            body={i18n._(
              msg({
                message: "Home screen icon for iPhone and iPad shortcuts.",
                comment:
                  "@context: Description for the apple touch icon asset card",
              }),
            )}
            asset="appleTouch"
            href={appleTouchHref}
            filename={appleTouchFilename}
            badge="180"
            downloadLabel={downloadFileLabel}
            rawLabel={openRawAssetLabel}
          />
          <IconResourceCard
            title={i18n._(
              msg({
                message: "Social preview image",
                comment:
                  "@context: Title for the social preview image asset card",
              }),
            )}
            usage={i18n._(
              msg({
                message: "Shared links",
                comment:
                  "@context: Usage label for the social preview image asset card",
              }),
            )}
            body={i18n._(
              msg({
                message:
                  "Default preview image for social shares and link unfurls.",
                comment:
                  "@context: Description for the social preview image asset card",
              }),
            )}
            asset="socialImage"
            href={socialImageHref}
            filename={socialImageFilename}
            badge="512"
            downloadLabel={downloadFileLabel}
            rawLabel={openRawAssetLabel}
          />
        </div>
      </section>
    </div>
  );
}
