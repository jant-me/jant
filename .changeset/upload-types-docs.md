---
"@jant/core": patch
"create-jant": patch
---

The API reference lists the image, video, and audio types uploads take: JPEG, PNG, and WebP images, MP4 video, and MP4 audio. It said "a broad set", and a script uploading a GIF, HEIC, MOV, or MP3 got `400` without knowing why. The upload examples name the file's type, since curl declares a `.webp` file as `application/octet-stream` and the upload was then stored as a download rather than an image.

**Upgrade notes**

- No database migrations.
