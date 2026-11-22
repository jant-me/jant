/**
 * Machine-readable Agent Discovery Helpers
 *
 * Builds the standards-based discovery documents and HTTP Link headers that let
 * AI assistants discover a Jant site's Skill, API catalog, Markdown endpoints,
 * and MCP OAuth 2.1 metadata from its URL alone.
 */

import type { AppConfig } from "../types/config.js";
import { getJantDocsUrl } from "./jant-docs.js";
import { renderSiteSkill } from "./site-skill.js";
import { toAbsoluteSiteUrl, toPublicPath } from "./url.js";

const AGENT_SKILLS_SCHEMA_URL =
  "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

const SITE_SKILL_DESCRIPTION =
  "Work with this Jant site through its HTTP API or MCP interface: read, publish, edit, organize, search, or migrate content, upload media, manage Collections, and update site settings.";

export interface AgentSkillDiscoveryEntry {
  name: string;
  type: "skill-md";
  description: string;
  url: string;
  digest: string;
}

export interface AgentSkillsIndexDocument {
  $schema: string;
  skills: AgentSkillDiscoveryEntry[];
}

export interface ApiCatalogLinkTarget {
  href: string;
  type?: string;
}

export interface ApiCatalogLinksetEntry {
  anchor: string;
  "service-doc"?: ApiCatalogLinkTarget[];
  describedby?: ApiCatalogLinkTarget[];
}

export interface ApiCatalogDocument {
  linkset: ApiCatalogLinksetEntry[];
}

export interface OAuthProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported: string[];
}

export interface OAuthAuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  scopes_supported: string[];
}

async function sha256Hex(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build the `/.well-known/agent-skills/index.json` document (v0.2.0) for one
 * Jant site, including the SHA-256 digest of its rendered `/skill.md`.
 *
 * @param siteUrl - Public site URL (including any path prefix)
 * @param sitePathPrefix - Configured site path prefix (empty string at root)
 * @returns Agent Skills discovery index document
 * @example
 * ```ts
 * const index = await buildAgentSkillsIndex("https://example.com", "");
 * ```
 */
export async function buildAgentSkillsIndex(
  siteUrl: string,
  sitePathPrefix = "",
): Promise<AgentSkillsIndexDocument> {
  const renderedSkill = renderSiteSkill(siteUrl);
  const digest = await sha256Hex(renderedSkill);
  const skillUrl = toAbsoluteSiteUrl("/skill.md", siteUrl, sitePathPrefix);

  return {
    $schema: AGENT_SKILLS_SCHEMA_URL,
    skills: [
      {
        name: "jant-site",
        type: "skill-md",
        description: SITE_SKILL_DESCRIPTION,
        url: skillUrl,
        digest: `sha256:${digest}`,
      },
    ],
  };
}

/**
 * Build the RFC 9727 `/.well-known/api-catalog` (`application/linkset+json`)
 * document describing the site's HTTP API and MCP endpoints.
 *
 * @param appConfig - Resolved site configuration
 * @returns RFC 9727 API catalog linkset document
 * @example
 * ```ts
 * const catalog = buildApiCatalog(c.var.appConfig);
 * ```
 */
export function buildApiCatalog(
  appConfig: Pick<AppConfig, "siteUrl" | "sitePathPrefix" | "publicApiEnabled">,
): ApiCatalogDocument {
  const { siteUrl, sitePathPrefix, publicApiEnabled } = appConfig;
  const skillUrl = toAbsoluteSiteUrl("/skill.md", siteUrl, sitePathPrefix);
  const llmsUrl = toAbsoluteSiteUrl("/llms.txt", siteUrl, sitePathPrefix);
  const apiDocsUrl = getJantDocsUrl("api");
  const automationDocsUrl = getJantDocsUrl("automation-and-api");

  const linkset: ApiCatalogLinksetEntry[] = [
    {
      anchor: toAbsoluteSiteUrl("/api/mcp", siteUrl, sitePathPrefix),
      "service-doc": [{ href: automationDocsUrl, type: "text/html" }],
      describedby: [{ href: skillUrl, type: "text/markdown" }],
    },
    {
      anchor: toAbsoluteSiteUrl("/api/posts", siteUrl, sitePathPrefix),
      "service-doc": [{ href: apiDocsUrl, type: "text/html" }],
      describedby: [{ href: skillUrl, type: "text/markdown" }],
    },
  ];

  if (publicApiEnabled) {
    linkset.push(
      {
        anchor: toAbsoluteSiteUrl("/api/public/mcp", siteUrl, sitePathPrefix),
        "service-doc": [{ href: automationDocsUrl, type: "text/html" }],
        describedby: [{ href: llmsUrl, type: "text/markdown" }],
      },
      {
        anchor: toAbsoluteSiteUrl(
          "/api/public/threads",
          siteUrl,
          sitePathPrefix,
        ),
        "service-doc": [{ href: apiDocsUrl, type: "text/html" }],
        describedby: [{ href: llmsUrl, type: "text/markdown" }],
      },
    );
  }

  return { linkset };
}

/**
 * Build the RFC 9728 OAuth 2.0 Protected Resource Metadata for `/api/mcp`.
 *
 * @param appConfig - Resolved site configuration
 * @returns Protected resource metadata JSON object
 * @example
 * ```ts
 * const meta = buildOAuthProtectedResourceMetadata(c.var.appConfig);
 * ```
 */
export function buildOAuthProtectedResourceMetadata(
  appConfig: Pick<AppConfig, "siteUrl" | "sitePathPrefix">,
): OAuthProtectedResourceMetadata {
  const { siteUrl, sitePathPrefix } = appConfig;
  const issuer = toAbsoluteSiteUrl("/", siteUrl, sitePathPrefix).replace(
    /\/$/,
    "",
  );
  return {
    resource: toAbsoluteSiteUrl("/api/mcp", siteUrl, sitePathPrefix),
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  };
}

/**
 * Build the RFC 8414 OAuth 2.0 Authorization Server Metadata for MCP OAuth 2.1.
 *
 * @param appConfig - Resolved site configuration
 * @returns Authorization server metadata JSON object
 * @example
 * ```ts
 * const meta = buildOAuthAuthorizationServerMetadata(c.var.appConfig);
 * ```
 */
export function buildOAuthAuthorizationServerMetadata(
  appConfig: Pick<AppConfig, "siteUrl" | "sitePathPrefix">,
): OAuthAuthorizationServerMetadata {
  const { siteUrl, sitePathPrefix } = appConfig;
  const issuer = toAbsoluteSiteUrl("/", siteUrl, sitePathPrefix).replace(
    /\/$/,
    "",
  );
  return {
    issuer,
    authorization_endpoint: toAbsoluteSiteUrl(
      "/_/oauth/authorize",
      siteUrl,
      sitePathPrefix,
    ),
    token_endpoint: toAbsoluteSiteUrl(
      "/api/oauth/token",
      siteUrl,
      sitePathPrefix,
    ),
    registration_endpoint: toAbsoluteSiteUrl(
      "/api/oauth/register",
      siteUrl,
      sitePathPrefix,
    ),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  };
}

/**
 * Build the `WWW-Authenticate` header for unauthenticated `/api/mcp` requests
 * so MCP clients discover OAuth 2.1 automatically (RFC 9728).
 *
 * @param appConfig - Resolved site configuration
 * @returns RFC 9728 Bearer challenge header value
 * @example
 * ```ts
 * c.header("WWW-Authenticate", buildMcpWwwAuthenticateHeader(c.var.appConfig));
 * ```
 */
export function buildMcpWwwAuthenticateHeader(
  appConfig: Pick<AppConfig, "siteUrl" | "sitePathPrefix">,
): string {
  const metadataUrl = toAbsoluteSiteUrl(
    "/.well-known/oauth-protected-resource",
    appConfig.siteUrl,
    appConfig.sitePathPrefix,
  );
  return `Bearer resource_metadata="${metadataUrl}", scope="mcp"`;
}

/**
 * Build RFC 8288 `Link` header entries advertising this site's Agent Skills,
 * API catalog, `/skill.md`, and optional page-specific Markdown or canonical
 * alternates.
 *
 * @param appConfig - Resolved site configuration
 * @param options - Optional page-specific alternate links
 * @returns Comma-joined RFC 8288 Link header value
 * @example
 * ```ts
 * buildDiscoveryLinkHeader(c.var.appConfig, { markdownHref: "/hello.md" });
 * ```
 */
export function buildDiscoveryLinkHeader(
  appConfig: Pick<AppConfig, "sitePathPrefix">,
  options: {
    markdownHref?: string;
    canonicalHref?: string;
  } = {},
): string {
  const prefix = appConfig.sitePathPrefix;
  const links: string[] = [
    `<${toPublicPath("/.well-known/agent-skills/index.json", prefix)}>; rel="agent-skills"`,
    `<${toPublicPath("/.well-known/api-catalog", prefix)}>; rel="api-catalog"`,
    `<${toPublicPath("/skill.md", prefix)}>; rel="describedby"; type="text/markdown"`,
  ];

  if (options.markdownHref) {
    links.push(
      `<${options.markdownHref}>; rel="alternate"; type="text/markdown"`,
    );
  }
  if (options.canonicalHref) {
    links.push(`<${options.canonicalHref}>; rel="canonical"`);
  }

  return links.join(", ");
}
