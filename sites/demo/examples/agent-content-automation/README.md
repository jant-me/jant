# Agent Content Automation

This folder shows the shortest path for content automation in a generated Jant site.

All content operations go through the HTTP API. Use MCP (`/api/mcp`) only when the caller already speaks MCP.

Set these once:

```bash
export JANT_URL="https://your-site.example"
export JANT_API_TOKEN="jnt_..."
```

For local development, `JANT_URL=http://localhost:8787` and `JANT_API_TOKEN=$DEV_API_TOKEN`.

## Publish a note from JSON

```bash
curl -X POST "$JANT_URL/api/posts" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @./examples/agent-content-automation/note.json
```

## Publish a quote from JSON

```bash
curl -X POST "$JANT_URL/api/posts" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @./examples/agent-content-automation/quote.json
```

## Update site settings from JSON

```bash
curl -X PUT "$JANT_URL/api/settings" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @./examples/agent-content-automation/site-settings.json
```

## Upload an image, then attach it to a post

Upload the file:

```bash
curl -X POST "$JANT_URL/api/upload" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -F "file=@./path/to/photo.webp;type=image/webp" \
  -F "alt=Cover image"
```

That returns a `med_*` ID. Use it in a post payload:

```json
{
  "format": "note",
  "title": "A post with media",
  "bodyMarkdown": "Uploaded through the HTTP API.",
  "status": "published",
  "visibility": "public",
  "attachments": [{ "type": "media", "mediaId": "med_..." }]
}
```

Then publish it:

```bash
curl -X POST "$JANT_URL/api/posts" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"format":"note","title":"A post with media","bodyMarkdown":"Uploaded through the HTTP API.","status":"published","visibility":"public","attachments":[{"type":"media","mediaId":"med_..."}]}'
```

## Inline text attachments stay in the post payload

File uploads create reusable media records. Inline reading notes and markdown snippets stay inside the post payload itself:

```json
{
  "format": "note",
  "bodyMarkdown": "A note with an attached markdown excerpt.",
  "status": "published",
  "visibility": "public",
  "attachments": [
    {
      "type": "text",
      "contentFormat": "markdown",
      "content": "## Reading note\n\nKeep this attached to the post."
    }
  ]
}
```

## MCP example

Initialize:

```bash
curl -X POST "$JANT_URL/api/mcp" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'
```

Create a post through `tools/call`:

```bash
curl -X POST "$JANT_URL/api/mcp" \
  -H "Authorization: Bearer $JANT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"jant_posts_create","arguments":{"format":"note","bodyMarkdown":"Created through MCP.","status":"published","visibility":"public"}}}'
```
