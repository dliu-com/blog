# DL blog API

This guide is for AI agents and scripts that write posts on https://blog.dliu.com on the owner's behalf. It is plain Markdown so that agents can read it directly: https://blog.dliu.com/docs/api.md

With an API token you can list, read, create and edit posts, publish and unpublish them, and attach pictures and files. You cannot delete posts or manage tokens; only the owner can, in the browser.

## Quick rules

1. Base URL: `https://blog.dliu.com`. All API paths start with `/api/`.
2. Send the token on every request: `Authorization: Bearer <token>`.
3. Every POST, PUT and DELETE must also send `x-amz-content-sha256: <hex SHA-256 of the exact request body bytes>`. For an empty body use `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. Without it the request fails with HTTP 403 and a message about a signature. GET requests don't need it.
4. Request bodies are JSON: `Content-Type: application/json`, UTF-8, at most 300 KB.
5. Responses are JSON. Errors look like `{"error": "message"}`.
6. The token is in the credentials file `~/.dliu_credentials` (see Authentication). Read it from there for each request. Never print it, log it, copy it elsewhere, commit it or put it in a post.
7. Save new posts as drafts (the default) unless the owner asked you to publish.
8. Before you edit a post, GET it and change its current text, so you don't overwrite the owner's edits.
9. Send one request at a time; this is a small personal site.

## Authentication

The owner creates tokens at https://blog.dliu.com/admin/tokens. A token is `blog_`, 12 hexadecimal characters, `_` and 64 more hexadecimal characters. It expires on the date the owner chose (or never) and the owner can revoke it at any time. A missing, wrong, expired or revoked token gets HTTP 401.

### Where the token is stored

Like `~/.aws/credentials`, the token lives in an INI-style credentials file that only the owner's user account can read:

- Path: `~/.dliu_credentials` (or the path in the environment variable `DLIU_CREDENTIALS_FILE`, if set).
- Permissions: `600` (read and write by the owner only).
- Contents: a `[blog]` section with a `token` key. Other sections may exist for other apps; leave them alone.

```ini
[blog]
token = blog_0123456789ab_...
```

The owner saves it with this command (bash or zsh). It asks for the token without showing it, keeps any other sections, never puts the token in the shell history and clears the clipboard on macOS:

```bash
(umask 077 && f=~/.dliu_credentials && printf 'Paste the blog token, then press Return: ' && read -rs t && echo && case "$t" in blog_*) ;; *) echo 'That is not a blog token' >&2; exit 1;; esac && touch "$f" && chmod 600 "$f" && T="$t" awk '/^[[:space:]]*\[/{s=($0 ~ /^[[:space:]]*\[blog\][[:space:]]*$/)} !s{print; last=$0} END{if (last != "") print ""; print "[blog]"; print "token = " ENVIRON["T"]}' "$f" > "$f.new" && mv "$f.new" "$f" && { command -v pbcopy >/dev/null && pbcopy </dev/null; true; } && echo "Saved to $f")
```

Rules for agents:

- Read the token from the file only at the moment you send a request, as the helpers below do. Don't `cat` the file, echo the token, or keep it in your notes, so that it never appears in your output or conversation.
- Don't put the token in command-line arguments, URLs or any other file.
- If the file or its `[blog]` token is missing, or the API returns 401, stop and ask the owner for a new token. Never ask the owner to paste the token into the chat.

Check that the token works:

```
GET /api/me
```

```json
{"signedIn": true, "user": "owner@example.com", "name": "Dewei Liu",
 "token": {"id": "0123456789ab", "name": "Writing agent", "expiresAt": "2027-01-26T10:00:00.000Z"}}
```

## Helpers

### Bash (curl)

```bash
BLOG=https://blog.dliu.com
DLIU_CREDENTIALS_FILE="${DLIU_CREDENTIALS_FILE:-$HOME/.dliu_credentials}"

sha256() { if command -v sha256sum >/dev/null; then sha256sum | cut -d' ' -f1; else shasum -a 256 | cut -d' ' -f1; fi; }

# Prints the token from the [blog] section. Only ever pipe it into curl.
blog_token() {
  awk '/^[[:space:]]*\[/{s=($0 ~ /^[[:space:]]*\[blog\][[:space:]]*$/); next}
       s && /^[[:space:]]*token[[:space:]]*=/{sub(/^[^=]*=[[:space:]]*/, ""); sub(/[[:space:]]+$/, ""); print; exit}' \
    "$DLIU_CREDENTIALS_FILE" 2>/dev/null
}

# blog METHOD API_PATH [JSON_BODY]
# The token goes from the file to curl through a pipe (-H @file), so it is
# never printed, stored in a variable or visible in the process list.
blog() {
  local method="$1" route="$2" body="${3-}"
  [ -n "$(blog_token)" ] || { echo "No [blog] token in $DLIU_CREDENTIALS_FILE; ask the owner for a token" >&2; return 1; }
  local args=(-sS -X "$method" "$BLOG$route" -H "Accept: application/json")
  if [ "$method" != GET ]; then
    args+=(-H "x-amz-content-sha256: $(printf '%s' "$body" | sha256)")
    if [ -n "$body" ]; then args+=(-H "Content-Type: application/json" --data-binary "$body"); fi
  fi
  curl "${args[@]}" -H @<(printf 'Authorization: Bearer %s\n' "$(blog_token)")
}

blog GET /api/me
```

This works in bash and zsh (curl 7.55 or later).

Build JSON with `jq` so that quotes and newlines in the text are escaped correctly:

```bash
blog POST /api/posts "$(jq -n --arg title 'Autumn in Dublin' --rawfile body post.md '{title: $title, body: $body}')"
```

### Python (standard library only)

```python
import configparser, hashlib, json, os, urllib.request, urllib.error

BLOG = "https://blog.dliu.com"
CREDENTIALS_FILE = os.path.expanduser(os.environ.get("DLIU_CREDENTIALS_FILE", "~/.dliu_credentials"))

def blog_token():
    config = configparser.ConfigParser(interpolation=None)
    config.read(CREDENTIALS_FILE)
    return config.get("blog", "token", fallback="").strip()

def blog(method, path, data=None):
    body = b"" if data is None else json.dumps(data).encode("utf-8")
    token = blog_token()  # read per request; never print it
    if not token:
        raise RuntimeError("No [blog] token in " + CREDENTIALS_FILE + "; ask the owner for a token")
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    if method != "GET":
        headers["x-amz-content-sha256"] = hashlib.sha256(body).hexdigest()
        if data is not None:
            headers["Content-Type"] = "application/json"
    request = urllib.request.Request(BLOG + path, data=body if method != "GET" else None, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"{method} {path} -> {error.code}: {error.read().decode()}") from None

print(blog("GET", "/api/me"))
```

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
  "author": "owner@example.com",
  "authorName": "Dewei Liu",
  "createdAt": "2026-10-28T10:00:00.000Z",
  "updatedAt": "2026-10-28T10:05:00.000Z",
  "publishedAt": ""
}
```

- `id` is the creation date (UTC) plus a two-digit number for that day: `yyyymmddNN`, e.g. `2026102800`, `2026102801`. The server assigns it.
- `status` is `draft` (seen only by the owner and by tokens) or `published` (public).
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

### Delete

Not allowed with a token (HTTP 403). To take a post down, set `"status": "draft"` and tell the owner, who can delete it in the browser.

## Pictures and files

Uploading is three steps. The file itself goes straight to storage, not through the API.

1. Ask for an upload URL. `size` is the exact number of bytes, `type` the MIME type:

   ```
   POST /api/posts/<id>/files
   {"name": "park.jpg", "size": 482113, "type": "image/jpeg"}
   ```

   Returns HTTP 201: `{"fileId": "Ab3dEf6hIj9kLm0n", "uploadUrl": "https://...", "uploadHeaders": {"content-type": "image/jpeg"}}`.

2. Within 15 minutes, PUT the raw bytes to `uploadUrl`, with the `uploadHeaders` and no other headers: no Authorization and no x-amz-content-sha256. The size and type must match step 1.

   ```bash
   curl -sS -X PUT "$UPLOAD_URL" -H "content-type: image/jpeg" --data-binary @park.jpg
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

Remove a file from a post (this also deletes it):

```
DELETE /api/posts/<id>/files/<fileId>
```

In Python:

```python
import os, urllib.request

def upload(post_id, path, mime_type):
    name = os.path.basename(path)
    data = open(path, "rb").read()
    start = blog("POST", f"/api/posts/{post_id}/files", {"name": name, "size": len(data), "type": mime_type})
    put = urllib.request.Request(start["uploadUrl"], data=data, method="PUT", headers=start["uploadHeaders"])
    urllib.request.urlopen(put).close()
    post = blog("PUT", f"/api/posts/{post_id}/files/{start['fileId']}", {"name": name})
    return next(f for f in post["files"] if f["id"] == start["fileId"])["url"]
```

## Writing posts

The body is Markdown. Supported: `#` headings, paragraphs, line breaks, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, fenced code blocks, `>` quotes, `-` and `1.` lists (nest by indenting), `---` rules, `[links](https://...)`, `![pictures](/media/...)` and bare https:// links.

Videos: put a video link from https://video.dliu.com on a line by itself to show the player, for example `https://video.dliu.com/2025010100` (also `/watch?v=ID`, `/embed/ID`, or `[Title](https://video.dliu.com/ID)` to set the player title). The embed code copied from a video page works too. Player options: `?t=SECONDS` (start time), `autoplay=1` (starts muted), `muted=1`, `loop=1`. Videos from other sites are shown as links.

Not supported: raw HTML (shown as text) and tables. Links must be https://, http://, mailto: or start with `/`.

The title is plain text; don't repeat it as a `#` heading at the top of the body.

## Example: write a post with a picture and publish it

```python
post = blog("POST", "/api/posts", {"title": "Autumn in Dublin", "body": "Draft in progress."})
url = upload(post["id"], "park.jpg", "image/jpeg")
body = "A walk through Phoenix Park.\n\n![Phoenix Park in October](" + url + ")\n\nThe deer were out."
blog("PUT", f"/api/posts/{post['id']}", {"body": body})
# Only if the owner asked you to publish:
blog("PUT", f"/api/posts/{post['id']}", {"status": "published"})
print("https://blog.dliu.com/" + post["id"])
```

## Errors

- 400: invalid input; the message says what to fix.
- 401: missing, wrong, expired or revoked token. Ask the owner to save a new one in `~/.dliu_credentials`.
- 403 `{"error": ...}`: not allowed with a token (deleting posts, managing tokens).
- 403 `{"message": "...signature..."}`: the `x-amz-content-sha256` header is missing or doesn't match the body. Hash the exact bytes you send.
- 404: no such post, file or path.
- 405: wrong method for the path.
- 409: too many posts created today.
- 413: request or post too large, or too many files.
- 415: the body was not sent as `Content-Type: application/json`.
- 500 or 503: try again later; if it keeps failing, tell the owner.

## Endpoint summary

- `GET /api/me`: check the token.
- `GET /api/posts`: list posts (no body text).
- `POST /api/posts`: create a post (`title`, `body`, optional `status`).
- `GET /api/posts/<id>`: read a post.
- `PUT /api/posts/<id>`: change `title`, `body` and/or `status`.
- `POST /api/posts/<id>/files`: start an upload (`name`, `size`, `type`).
- `PUT /api/posts/<id>/files/<fileId>`: attach a finished upload (`name`).
- `DELETE /api/posts/<id>/files/<fileId>`: remove a file.
