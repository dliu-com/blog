# DL blog API

This reference is for trusted tools, scripts and AI agents that manage posts on https://blog.dliu.com for the owner. The same guide is available as plain Markdown at https://blog.dliu.com/docs/api.md, so an agent can read it directly.

The managed API accepts Microsoft-issued user access tokens. It can read and list posts (drafts included), create and edit posts, publish and unpublish them, attach pictures and files, and delete files or posts when the token has the corresponding permission.

**Authentication is required:** configure your requester using the [Auth API documentation](https://auth.dliu.com/docs/api). That is the canonical guide for credentials, token acquisition, expiry and authenticated request setup; this reference covers only the Blog API.

## Quick rules

1. The managed API origin is `{{MICROSOFT_API_URL}}` (the deployment output `MicrosoftApiUrl`). All nine managed routes are listed below. Send API requests only to this origin.
2. Configure authentication according to the [Auth API documentation](https://auth.dliu.com/docs/api) before using any route. Blog website sign-in is not API authentication, and `https://blog.dliu.com/api/*` accepts only website cookies: do not send bearer requests there.
3. Request bodies are JSON objects with `Content-Type: application/json`, UTF-8, at most 300 KB. Do not send file bytes to this API; they go straight to storage (see Pictures and files).
4. Requests do not need `Origin`, website cookies or `x-amz-content-sha256`.
5. Responses are JSON. Errors come either from the gateway (`{"message": "..."}`) or from the blog (`{"error": "..."}`).
6. Do only what the owner asked. Save new posts as drafts (the default) unless the owner asked you to publish; publishing makes a post public, and deleting cannot be undone. Do not run write or delete examples just to check a token: use `GET /api/me`.
7. Before you edit a post, GET it and change its current text, so you don't overwrite the owner's edits. There is no ETag or conditional update; send one request at a time.
8. Treat presigned upload URLs as credentials: never put them in chat, posts, logs or saved settings. Do not follow redirects with credentials.

## Endpoint summary

- `GET /api/me`, scope `blog.read`: Read the authenticated user identity
- `GET /api/posts`, scope `blog.read`: List all posts, drafts included (no body text)
- `GET /api/posts/<id>`, scope `blog.read`: Read a post, including body and files
- `POST /api/posts`, scope `blog.write`: Create a post
- `PUT /api/posts/<id>`, scope `blog.write`: Edit, publish or unpublish a post
- `POST /api/posts/<id>/files`, scope `blog.write`: Start a picture or file upload
- `PUT /api/posts/<id>/files/<fileId>`, scope `blog.write`: Attach a finished upload to the post
- `DELETE /api/posts/<id>/files/<fileId>`, scope `blog.delete`: Remove a file from a post and delete it
- `DELETE /api/posts/<id>`, scope `blog.delete`: Delete a post and all its files

`blog.write` does not include `blog.delete`. There are no token-management, sign-in, reaction or comment routes on the managed API; any other method or path gets HTTP 404.

## Authentication

Follow the required [Auth API documentation](https://auth.dliu.com/docs/api) before calling the Blog API. Credential lookup, token storage, expiry and renewal, and authorization-header construction belong there, not in this site-specific guide.

The gateway validates the Microsoft signature, the tenant-specific v2 issuer, the audience, the token times and the route's scope. The blog then also requires the configured gateway, tenant, audience, the approved client (`azp`), the user's object and subject IDs, and the Microsoft-assigned user role **dliu API user** (`api.access`, shared by all dliu.com APIs; the route's `blog.*` scope still limits what the token can do). Only accounts assigned this role can use the API; other organisation accounts can still use the website but not this API. Website cookies never act as a fallback on this API. An ID token, Microsoft Graph token, app-only token or blog session cookie does not work.

Tokens come only from Central Microsoft sign-in at https://auth.dliu.com; the blog has no API sign-in, token issuing, refresh or revocation of its own. When a token expires, the owner gets a new one there.

The blog keeps no application-wide cache of bearer tokens, does not store them and does not log authorization headers or whole requests. Request data may stay in a warm function's memory until it is reused; this is not a forensic erasure guarantee.

Check that authentication works (read-only):

```
GET /api/me
```

```json
{"signedIn": true, "user": "<Microsoft object ID>", "name": "Dewei Liu"}
```

`user` is the stable Microsoft object ID of the signed-in account. Posts and uploads created through the API record it, and edits are marked as made through the Microsoft API.

## Workflow for a trusted local AI agent

1. The owner signs in at https://auth.dliu.com and saves or copies a token as that site describes.
2. The owner gives a trusted AI agent on their own computer only this guide (https://blog.dliu.com/docs/api.md) and a specific task, for example "draft a post about our trip with these three photos; don't publish it".
3. The agent reads this guide and the [Auth API documentation](https://auth.dliu.com/docs/api), uses the saved credentials as described there, and calls only the routes the task needs.
4. The agent reports the post's ID and, if the owner asked to publish it, its link `https://blog.dliu.com/<id>`.

The agent needs no AWS credentials and no other API address. It must never print, paste or store the token, ask the owner to paste it into the chat, or send it anywhere other than the managed API origin above. If the credentials are missing or expired, or the API returns 401, it stops and asks the owner to get a fresh token at auth.dliu.com.

### Optional command-line client

The blog's source repository includes `scripts/api-client.js` (Node.js 22 or later, no dependencies). It reads the saved credentials as described in the Auth documentation for every request, checks the method and path against the nine routes, refuses redirects and never prints the token. From a checkout of the blog repository:

```bash
export BLOG_API_URL='{{MICROSOFT_API_URL}}'
node scripts/api-client.js GET /api/me
node scripts/api-client.js GET /api/posts
# Only when the owner asked for it:
node scripts/api-client.js POST /api/posts '{"title":"Autumn in Dublin","body":"Draft in progress."}'
node scripts/api-client.js upload 2026102801 park.jpg image/jpeg
```

`BLOG_API_ACCESS_TOKEN` (a token copied from auth.dliu.com) and `BLOG_API_TOKEN_FILE` (an absolute path to a saved credentials file) override the default credentials file, as for the Video client in the Auth documentation.

## Posts

A post:

```json
{
  "id": "2026102801",
  "title": "Autumn in Dublin",
  "body": "Markdown text ...",
  "status": "draft",
  "files": [{"id": "Ab3dEf6hIj9kLm0n", "name": "park.jpg", "type": "image/jpeg", "size": 482113,
             "url": "/media/2026102801/Ab3dEf6hIj9kLm0n/park.jpg", "uploadedAt": "2026-10-28T10:05:00.000Z"}],
  "author": "<Microsoft object ID or the owner's sign-in>",
  "authorName": "Dewei Liu",
  "createdAt": "2026-10-28T10:00:00.000Z",
  "updatedAt": "2026-10-28T10:05:00.000Z",
  "publishedAt": ""
}
```

- `id` is the creation date (UTC) plus a two-digit number for that day: `yyyymmddNN`, e.g. `2026102800`, `2026102801`. The server assigns it.
- `status` is `draft` (seen only by the owner and the API) or `published` (public).
- A published post is at `https://blog.dliu.com/<id>`, e.g. https://blog.dliu.com/2026102801.
- `publishedAt` is set the first time a post is published and kept if it is unpublished and published again.
- Limits: title 200 characters, body 200 KB, 100 files a post, 100 MB a file, 100 new posts a day.

### List posts

```
GET /api/posts
```

Returns `{"posts": [{"id", "title", "status", "authorName", "createdAt", "updatedAt", "publishedAt"}, ...]}`, drafts included, newest first. The list has no body text; GET a post for that.

### Read a post

```
GET /api/posts/<id>
```

Returns the full post, including `body` and `files`.

### Create a post

```
POST /api/posts
{"title": "Autumn in Dublin", "body": "Markdown text ..."}
```

Returns HTTP 201 and the new post (read its `id`). It is a draft unless you also send `"status": "published"`.

### Edit, publish or unpublish

```
PUT /api/posts/<id>
{"title": "...", "body": "...", "status": "published"}
```

Send only the fields you want to change; the others are kept. `body` replaces the whole text. Use `"status": "published"` to publish and `"status": "draft"` to take a post off the public site. Returns the updated post.

### Delete a post

```
DELETE /api/posts/<id>
```

Requires `blog.delete`. Deletes the post and all its files permanently and returns `{"deleted": "<id>"}`. Only do this when the owner explicitly asked to delete that post; to take a post down temporarily, set `"status": "draft"` instead.

## Pictures and files

Uploading is three steps. The file itself goes straight to storage, not through the API.

1. Ask for an upload URL. `size` is the exact number of bytes, `type` the MIME type:

   ```
   POST /api/posts/<id>/files
   {"name": "park.jpg", "size": 482113, "type": "image/jpeg"}
   ```

   Returns HTTP 201: `{"fileId": "Ab3dEf6hIj9kLm0n", "uploadUrl": "https://...", "uploadHeaders": {"content-type": "image/jpeg"}}`.

2. Within 15 minutes, PUT the raw bytes to `uploadUrl` with exactly the `uploadHeaders` and no other headers. Never send the Microsoft token to storage. The size and type must match step 1.

   ```bash
   curl -sS --fail -X PUT "$UPLOAD_URL" -H "content-type: image/jpeg" --data-binary @park.jpg
   ```

3. Attach the upload to the post:

   ```
   PUT /api/posts/<id>/files/<fileId>
   {"name": "park.jpg"}
   ```

   Returns HTTP 201 and the post. The new entry in `files` has the file's `url`, e.g. `/media/2026102801/Ab3dEf6hIj9kLm0n/park.jpg`.

To show a picture inside the text, add it to the body with its `url`, then PUT the body:

```
![Phoenix Park in October](/media/2026102801/Ab3dEf6hIj9kLm0n/park.jpg)
```

Link other files the same way without the `!`: `[Route map (PDF)](/media/...)`. Pictures not used in the text appear in a gallery under the post, and other files in a list of attachments.

Remove a file from a post (requires `blog.delete`; this also deletes the file):

```
DELETE /api/posts/<id>/files/<fileId>
```

Returns the updated post.

## Writing posts

The body is Markdown. Supported: `#` headings, paragraphs, line breaks, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, fenced code blocks, `>` quotes, `-` and `1.` lists (nest by indenting), `---` rules, `[links](https://...)`, `![pictures](/media/...)` and bare https:// links.

Videos: put a video link from https://video.dliu.com on a line by itself to show the player, for example `https://video.dliu.com/2025010100` (also `/watch?v=ID`, `/embed/ID`, or `[Title](https://video.dliu.com/ID)` to set the player title). The embed code copied from a video page works too. Player options: `?t=SECONDS` (start time), `autoplay=1` (starts muted), `muted=1`, `loop=1`. Videos from other sites are shown as links.

Not supported: raw HTML (shown as text) and tables. Links must be https://, http://, mailto: or start with `/`.

The title is plain text; don't repeat it as a `#` heading at the top of the body.

## Example: draft a post with a picture

With the command-line client (publish only if the owner asked):

```bash
node scripts/api-client.js POST /api/posts '{"title":"Autumn in Dublin","body":"Draft in progress."}'   # note the id
node scripts/api-client.js upload 2026102801 park.jpg image/jpeg                                       # note the url
node scripts/api-client.js PUT /api/posts/2026102801 '{"body":"A walk through Phoenix Park.\n\n![Phoenix Park in October](/media/2026102801/Ab3dEf6hIj9kLm0n/park.jpg)\n\nThe deer were out."}'
node scripts/api-client.js PUT /api/posts/2026102801 '{"status":"published"}'
```

The IDs above are examples; use the ones returned for your task.

## Errors

- 400 `{"error": ...}`: invalid input; the message says what to fix.
- 401 `{"message": "Unauthorized"}`: no valid Microsoft access token for this API (missing, expired, wrong audience or issuer). Get a fresh token as described in the [Auth API documentation](https://auth.dliu.com/docs/api).
- 401 `{"error": "Microsoft access token required"}`: the token passed the gateway but is not a user token for this tenant and API.
- 403 `{"message": "Forbidden"}`: the token lacks the route's scope (`blog.read`, `blog.write` or `blog.delete`).
- 403 `{"error": "Blog API permission required"}`: the token is from another client, or the account is not assigned the **dliu API user** (`api.access`) role.
- 404: no such post, file, method or path.
- 409: too many posts created today.
- 413: request or post too large, or too many files.
- 415: the body was not sent as `Content-Type: application/json`.
- 500 or 503: try again later; if it keeps failing, tell the owner.
