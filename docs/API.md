# Jant API Reference

This document describes the REST API endpoints available in Jant.

## Authentication

All POST, PUT, and DELETE endpoints require authentication using session cookies from better-auth.

To authenticate:

1. Sign in via `/signin` (web UI)
2. Use the session cookie in subsequent API requests

Unauthenticated requests to protected endpoints will receive a `401 Unauthorized` response.

---

## Posts API

Base path: `/api/posts`

### List Posts

```
GET /api/posts
```

**Query Parameters:**

- `type` (optional): Filter by post type (`note`, `article`, `link`, `quote`, `image`, `page`)
- `visibility` (optional): Filter by visibility (`featured`, `quiet`, `unlisted`, `draft`)
- `cursor` (optional): Pagination cursor (sqid format)
- `limit` (optional): Number of posts to return (default: 100, max: 100)

**Response:**

```json
{
  "posts": [
    {
      "id": 1,
      "sqid": "jR3k",
      "type": "note",
      "title": "Post Title",
      "content": "Post content",
      "contentHtml": "<p>Post content</p>",
      "visibility": "featured",
      "publishedAt": 1704067200,
      "createdAt": 1704067200,
      "updatedAt": 1704067200
    }
  ],
  "nextCursor": "k3Rj" // null if no more posts
}
```

### Get Single Post

```
GET /api/posts/:id
```

**Parameters:**

- `id`: Post ID in sqid format (e.g., `jR3k`)

**Response:**

```json
{
  "id": 1,
  "sqid": "jR3k",
  "type": "note",
  "title": "Post Title",
  "content": "Post content",
  "contentHtml": "<p>Post content</p>",
  "visibility": "featured",
  "publishedAt": 1704067200,
  "createdAt": 1704067200,
  "updatedAt": 1704067200
}
```

**Error Responses:**

- `400 Bad Request`: Invalid ID format
- `404 Not Found`: Post not found

### Create Post

```
POST /api/posts
```

**Authentication Required:** Yes

**Request Body:**

```json
{
  "type": "note",
  "title": "Post Title",
  "content": "Post content",
  "visibility": "featured",
  "sourceUrl": "https://example.com",
  "sourceName": "Example Source",
  "path": "custom-url-path",
  "replyToId": "jR3k",
  "publishedAt": 1704067200
}
```

**Required Fields:**

- `type`: One of `note`, `article`, `link`, `quote`, `image`, `page`
- `content`: Post content (Markdown)
- `visibility`: One of `featured`, `quiet`, `unlisted`, `draft`

**Optional Fields:**

- `title`: Post title
- `sourceUrl`: Source URL (must be valid URL or empty)
- `sourceName`: Source name
- `path`: Custom URL path (lowercase, numbers, hyphens only)
- `replyToId`: Reply to another post (sqid format)
- `publishedAt`: Unix timestamp (seconds)

**Response:**

```json
{
  "id": 1,
  "sqid": "jR3k",
  "type": "note",
  "title": "Post Title",
  "content": "Post content",
  "contentHtml": "<p>Post content</p>",
  "visibility": "featured",
  "publishedAt": 1704067200,
  "createdAt": 1704067200,
  "updatedAt": 1704067200
}
```

**Status Code:** `201 Created`

**Error Responses:**

- `400 Bad Request`: Validation failed (see `details` field)
- `401 Unauthorized`: Not authenticated

### Update Post

```
PUT /api/posts/:id
```

**Authentication Required:** Yes

**Parameters:**

- `id`: Post ID in sqid format

**Request Body:**
Same as Create Post, but all fields are optional (partial update).

**Response:**
Same as Get Single Post.

**Error Responses:**

- `400 Bad Request`: Invalid ID or validation failed
- `401 Unauthorized`: Not authenticated
- `404 Not Found`: Post not found

### Delete Post

```
DELETE /api/posts/:id
```

**Authentication Required:** Yes

**Parameters:**

- `id`: Post ID in sqid format

**Response:**

```json
{
  "success": true
}
```

**Error Responses:**

- `400 Bad Request`: Invalid ID
- `401 Unauthorized`: Not authenticated
- `404 Not Found`: Post not found

---

## Upload API

Base path: `/api/upload`

All upload endpoints require authentication.

### Upload File

```
POST /api/upload
```

**Authentication Required:** Yes

**Request:**

- Content-Type: `multipart/form-data`
- Field name: `file`

**File Requirements:**

- **Allowed types:** JPEG, PNG, GIF, WebP, SVG
- **Max size:** 10 MB

**Response:**

```json
{
  "id": 1,
  "filename": "1704067200-abc123.jpg",
  "url": "https://cdn.example.com/uploads/1704067200-abc123.jpg",
  "mimeType": "image/jpeg",
  "size": 102400
}
```

**Error Responses:**

- `400 Bad Request`: No file provided, file type not allowed, or file too large
- `401 Unauthorized`: Not authenticated
- `500 Internal Server Error`: R2 storage not configured or upload failed

### List Uploaded Files

```
GET /api/upload
```

**Authentication Required:** Yes

**Query Parameters:**

- `limit` (optional): Number of files to return (default: 50)

**Response:**

```json
{
  "media": [
    {
      "id": 1,
      "filename": "1704067200-abc123.jpg",
      "url": "https://cdn.example.com/uploads/1704067200-abc123.jpg",
      "mimeType": "image/jpeg",
      "size": 102400,
      "createdAt": 1704067200
    }
  ]
}
```

### Delete File

```
DELETE /api/upload/:id
```

**Authentication Required:** Yes

**Parameters:**

- `id`: Media ID (integer)

**Response:**

```json
{
  "success": true
}
```

**Error Responses:**

- `400 Bad Request`: Invalid ID
- `401 Unauthorized`: Not authenticated
- `404 Not Found`: File not found

---

## Search API

Base path: `/api/search`

### Search Posts

```
GET /api/search
```

**Query Parameters:**

- `q` (required): Search query
- `limit` (optional): Number of results (default: 20, max: 100)

**Response:**

```json
{
  "results": [
    {
      "id": 1,
      "sqid": "jR3k",
      "type": "note",
      "title": "Matching Post",
      "excerpt": "...highlighted excerpt...",
      "publishedAt": 1704067200,
      "rank": 0.95
    }
  ],
  "query": "search terms",
  "total": 42
}
```

**Error Responses:**

- `400 Bad Request`: Missing or invalid query parameter

---

## Error Format

All API errors follow this format:

```json
{
  "error": "Error message",
  "details": {
    // Additional error details (for validation errors)
  }
}
```

Common HTTP status codes:

- `200 OK`: Success
- `201 Created`: Resource created
- `400 Bad Request`: Invalid request
- `401 Unauthorized`: Authentication required
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

---

## Rate Limiting

Currently, there is no rate limiting on API endpoints. This may be added in future versions.

## Versioning

The API is currently unversioned. Breaking changes will be communicated in release notes.
