/**
 * Dashboard Index Route
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { DashLayout } from "../../theme/layouts/index.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const dashIndexRoute = new Hono<Env>();

dashIndexRoute.get("/", async (c) => {
  const siteName = (await c.var.services.settings.get("SITE_NAME")) ?? "Jant";

  // Get some stats
  const allPosts = await c.var.services.posts.list({ limit: 1000 });
  const publishedPosts = allPosts.filter((p) => p.visibility !== "draft");
  const draftPosts = allPosts.filter((p) => p.visibility === "draft");

  return c.html(
    <DashLayout title="Dashboard" siteName={siteName}>
      <h1 class="text-2xl font-semibold mb-6">Dashboard</h1>

      <div class="grid gap-4 md:grid-cols-3">
        <div class="card">
          <header>
            <h2>Published</h2>
          </header>
          <section>
            <p class="text-3xl font-bold">{publishedPosts.length}</p>
          </section>
        </div>

        <div class="card">
          <header>
            <h2>Drafts</h2>
          </header>
          <section>
            <p class="text-3xl font-bold">{draftPosts.length}</p>
          </section>
        </div>

        <div class="card">
          <header>
            <h2>Quick Actions</h2>
          </header>
          <section>
            <a href="/dash/posts/new" class="btn w-full">
              New Post
            </a>
          </section>
        </div>
      </div>
    </DashLayout>
  );
});
