/**
 * Upload API Routes
 *
 * Handles file uploads to R2 storage
 */

import { Hono } from "hono";
import type { Bindings } from "../../types.js";
import type { AppVariables } from "../../app.js";
import { requireAuthApi } from "../../middleware/auth.js";

type Env = { Bindings: Bindings; Variables: AppVariables };

export const uploadApiRoutes = new Hono<Env>();

// Require auth for all upload routes
uploadApiRoutes.use("*", requireAuthApi());

// Upload a file
uploadApiRoutes.post("/", async (c) => {
  if (!c.env.R2) {
    return c.json({ error: "R2 storage not configured" }, 500);
  }

  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return c.json({ error: "No file provided" }, 400);
  }

  // Validate file type
  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
  if (!allowedTypes.includes(file.type)) {
    return c.json({ error: "File type not allowed" }, 400);
  }

  // Validate file size (max 10MB)
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    return c.json({ error: "File too large (max 10MB)" }, 400);
  }

  // Generate unique filename
  const ext = file.name.split(".").pop() || "bin";
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const filename = `${timestamp}-${random}.${ext}`;
  const r2Key = `uploads/${filename}`;

  try {
    // Upload to R2
    await c.env.R2.put(r2Key, file.stream(), {
      httpMetadata: {
        contentType: file.type,
      },
    });

    // Get image dimensions if it's an image
    let width: number | undefined;
    let height: number | undefined;

    // Save to database
    const media = await c.var.services.media.create({
      filename,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      r2Key,
      width,
      height,
    });

    // Build public URL
    const publicUrl = c.env.R2_PUBLIC_URL
      ? `${c.env.R2_PUBLIC_URL}/${r2Key}`
      : `/media/${filename}`;

    return c.json({
      id: media.id,
      filename: media.filename,
      url: publicUrl,
      mimeType: media.mimeType,
      size: media.size,
    });
  } catch (err) {
    console.error("Upload error:", err);
    return c.json({ error: "Upload failed" }, 500);
  }
});

// List uploaded files
uploadApiRoutes.get("/", async (c) => {
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const mediaList = await c.var.services.media.list(limit);

  return c.json({
    media: mediaList.map((m) => ({
      id: m.id,
      filename: m.filename,
      url: c.env.R2_PUBLIC_URL
        ? `${c.env.R2_PUBLIC_URL}/${m.r2Key}`
        : `/media/${m.filename}`,
      mimeType: m.mimeType,
      size: m.size,
      createdAt: m.createdAt,
    })),
  });
});

// Delete a file
uploadApiRoutes.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (isNaN(id)) {
    return c.json({ error: "Invalid ID" }, 400);
  }

  const media = await c.var.services.media.getById(id);
  if (!media) {
    return c.json({ error: "Not found" }, 404);
  }

  // Delete from R2
  if (c.env.R2) {
    try {
      await c.env.R2.delete(media.r2Key);
    } catch (err) {
      console.error("R2 delete error:", err);
    }
  }

  // Delete from database
  await c.var.services.media.delete(id);

  return c.json({ success: true });
});
