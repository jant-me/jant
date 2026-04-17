import { describe, expect, it } from "vitest";
import type { GitHubClient } from "../../lib/github-api.js";
import {
  classifyRepoForSync,
  JANT_MANAGED_GLOBS,
  JANT_SYNC_MARKER_PATH,
  JANT_SYNC_MARKER_SCHEMA_VERSION,
  type JantSyncMarker,
} from "../github-sync.js";

/**
 * Minimal in-memory stub — only implements the client methods the
 * classifier actually calls. Missing methods throw if touched so a
 * future refactor can't silently pass over unverified API calls.
 */
function stubClient(overrides: {
  defaultBranch?: string;
  refExists?: boolean;
  markerFile?: { content: string; encoding: "utf-8" | "base64" } | null;
}): GitHubClient {
  const unreachable = (name: string) => () => {
    throw new Error(`unexpected call to ${name}`);
  };
  return {
    async getRepo() {
      return {
        default_branch: overrides.defaultBranch ?? "main",
        full_name: "acme/site",
      };
    },
    async getRef() {
      if (overrides.refExists === false) {
        throw new Error("ref not found");
      }
      return { sha: "headsha" };
    },
    async getFileContent(_o, _r, path) {
      if (path !== JANT_SYNC_MARKER_PATH) return null;
      if (!overrides.markerFile) return null;
      return { sha: "blobsha", ...overrides.markerFile };
    },
    getCommit: unreachable("getCommit"),
    updateRef: unreachable("updateRef"),
    createRef: unreachable("createRef"),
    createOrUpdateFile: unreachable("createOrUpdateFile"),
    deleteFile: unreachable("deleteFile"),
    createBlob: unreachable("createBlob"),
    createTree: unreachable("createTree"),
    createCommit: unreachable("createCommit"),
    createWebhook: unreachable("createWebhook"),
    listWebhooks: unreachable("listWebhooks"),
    deleteWebhook: unreachable("deleteWebhook"),
  };
}

function encodeBase64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

function markerJson(overrides: Partial<JantSyncMarker> = {}): string {
  const marker: JantSyncMarker = {
    schema_version: JANT_SYNC_MARKER_SCHEMA_VERSION,
    site_id: "sit_testsiteid000000000000000",
    site_host: "blog.example.com",
    created_at: 1713225600,
    managed_globs: [...JANT_MANAGED_GLOBS],
    ...overrides,
  };
  return JSON.stringify(marker, null, 2);
}

describe("classifyRepoForSync", () => {
  const siteId = "sit_testsiteid000000000000000";

  it("returns 'empty' when the default branch has no ref", async () => {
    const client = stubClient({ refExists: false });
    const result = await classifyRepoForSync(client, "acme", "site", siteId);
    expect(result).toEqual({ kind: "empty" });
  });

  it("returns 'foreign' when the repo has commits but no marker file", async () => {
    const client = stubClient({ refExists: true, markerFile: null });
    const result = await classifyRepoForSync(client, "acme", "site", siteId);
    expect(result).toEqual({ kind: "foreign", defaultBranch: "main" });
  });

  it("returns 'foreign' when the marker file exists but is malformed", async () => {
    const client = stubClient({
      refExists: true,
      markerFile: { content: "not json", encoding: "utf-8" },
    });
    const result = await classifyRepoForSync(client, "acme", "site", siteId);
    expect(result).toEqual({ kind: "foreign", defaultBranch: "main" });
  });

  it("returns 'owned' when the marker's site_id matches", async () => {
    const content = encodeBase64(markerJson({ site_id: siteId }));
    const client = stubClient({
      refExists: true,
      markerFile: { content, encoding: "base64" },
    });
    const result = await classifyRepoForSync(client, "acme", "site", siteId);
    expect(result.kind).toBe("owned");
    if (result.kind === "owned") {
      expect(result.marker.site_id).toBe(siteId);
      expect(result.marker.site_host).toBe("blog.example.com");
    }
  });

  it("returns 'owned-by-other-site' when site_id differs", async () => {
    const content = encodeBase64(
      markerJson({
        site_id: "sit_othersiteid00000000000000",
        site_host: "other.example.com",
      }),
    );
    const client = stubClient({
      refExists: true,
      markerFile: { content, encoding: "base64" },
    });
    const result = await classifyRepoForSync(client, "acme", "site", siteId);
    expect(result.kind).toBe("owned-by-other-site");
    if (result.kind === "owned-by-other-site") {
      expect(result.marker.site_host).toBe("other.example.com");
    }
  });

  it("handles utf-8-encoded marker content (non-base64 path)", async () => {
    const client = stubClient({
      refExists: true,
      markerFile: {
        content: markerJson({ site_id: siteId }),
        encoding: "utf-8",
      },
    });
    const result = await classifyRepoForSync(client, "acme", "site", siteId);
    expect(result.kind).toBe("owned");
  });

  it("accepts a legacy v1 marker as 'owned' (no managed_globs field)", async () => {
    // Pre-v2 markers have no managed_globs. Classification must still
    // match on site_id so existing connections keep working; pushFullSync
    // handles the v1 → v2 layout migration on the next push.
    const legacyMarker = JSON.stringify(
      {
        schema_version: 1,
        site_id: siteId,
        site_host: "blog.example.com",
        created_at: 1713225600,
      },
      null,
      2,
    );
    const client = stubClient({
      refExists: true,
      markerFile: {
        content: encodeBase64(legacyMarker),
        encoding: "base64",
      },
    });
    const result = await classifyRepoForSync(client, "acme", "site", siteId);
    expect(result.kind).toBe("owned");
    if (result.kind === "owned") {
      expect(result.marker.schema_version).toBe(1);
      expect(result.marker.managed_globs).toBeUndefined();
    }
  });

  it("preserves managed_globs from a v2 marker when owned", async () => {
    const client = stubClient({
      refExists: true,
      markerFile: {
        content: markerJson({ site_id: siteId }),
        encoding: "utf-8",
      },
    });
    const result = await classifyRepoForSync(client, "acme", "site", siteId);
    expect(result.kind).toBe("owned");
    if (result.kind === "owned") {
      expect(result.marker.schema_version).toBe(2);
      expect(result.marker.managed_globs).toEqual([...JANT_MANAGED_GLOBS]);
      // The hard list should include themes/jant/** — the load-bearing
      // path for the theme-packaging model.
      expect(result.marker.managed_globs).toContain("themes/jant/**");
    }
  });
});
