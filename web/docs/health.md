# How to test blog.dliu.com

This is the full technical version of https://blog.dliu.com/docs#health (the Testing tab), for machines and AI agents. It follows the
dliu.com health contract: an anonymous guest (status.dliu.com) checks that the blog works, without signing in and
without AWS access. This is separate from the managed API in https://blog.dliu.com/docs/api.md, which is for signed-in
users changing content; the two share no routes and no credentials.

## Functions

| Key | Name | What it does | Critical |
| --- | --- | --- | --- |
| `pages` | Pages | The home page, post pages and the editor are one single-page app (`index.html`) on CloudFront and S3. | yes |
| `posts` | Posts | Published posts: a list (`/content/index.json`) and one file per post in S3, written from the posts database when the owner saves. | yes |
| `storage` | Published content storage | The S3 storage that holds the published posts, pictures and files readers open. | yes |
| `reactions` | Reactions | Readers' reactions (love, like…) on each post, kept in a DynamoDB table; no sign-in. | no |
| `api` | Blog API | The website's API Lambda (`/api/*`): sign-in state, reactions, and the owner's editing. | yes |
| `signin` | Microsoft sign-in | The owner signs in with Microsoft Entra ID (`/auth/login`), using settings read from SSM Parameter Store. | no |
| `docs` | Docs | The documentation pages (`/docs`; `/docs/api` and `/docs/health` redirect to its `#api` and `#health` tabs). | no |

The site is "down" when a critical function fails.

## Guest checks

Every request is an anonymous `GET` or `HEAD`: no cookies, no `Authorization` header, no query string, and redirects
are not followed. Send the user agent `dliu-status-bot/1.0 (+https://status.dliu.com/docs)`. "Body" is a fixed text
the body contains, or a top-level JSON key; for a redirect it is the start of the `Location` header. "Slow after" is
the response time above which the check counts as slow (degraded).

| Function | Method | URL | Status | Content type | Body or Location | Slow after |
| --- | --- | --- | --- | --- | --- | --- |
| `pages` | GET | https://blog.dliu.com/ | 200 | `text/html` | contains `dl-footer` | 2000 ms |
| `posts` | GET | https://blog.dliu.com/content/index.json | 200 | `application/json` | JSON key `posts` | 2000 ms |
| `reactions` | GET | https://blog.dliu.com/api/reactions/2026103100 | 200 | `application/json` | JSON key `counts` | 3000 ms |
| `api` | GET | https://blog.dliu.com/api/me | 200 | `application/json` | JSON key `signedIn` (value `false`) | 3000 ms |
| `signin` | GET | https://blog.dliu.com/auth/login | 302 | (none) | `Location` starts with `https://login.microsoftonline.com/` | 3000 ms |
| `docs` | GET | https://blog.dliu.com/docs | 200 | `text/html` | contains `dl-tabs` | 2000 ms |

Notes:

- `GET /api/reactions/<postId>` only reads the counts; it works for any well-formed post ID, so it stays `200` even if
  that post is deleted. Never send `POST` to it: that is a reader's reaction.
- `GET /auth/login` only builds the Microsoft sign-in link (and sets short-lived sign-in state cookies the bot can
  ignore); nothing signs in.
- `GET /health` is described below. Its function keys are `posts`, `reactions`, `storage` and `signin`.

## Health endpoint

`GET https://blog.dliu.com/health` (also `HEAD`). No authentication.

- CloudFront's `/health` behaviour has a cache policy keyed on nothing and no origin request policy, so no cookies, no
  `Authorization` header and no query string reach the Lambda, and the handler reads none of them. `/health/`
  redirects (`301`) to `/health`.
- Cached for 60 seconds at CloudFront (`Cache-Control: public, max-age=60`), so the checks run at most about once a
  minute however often it is requested. The `Age` response header shows how old the cached copy is.
- `Content-Type: application/health+json`. HTTP `200` when `status` is `pass` or `warn`, `503` when it is `fail`.
- Every check runs in parallel with its own 2 s timeout, so the response is ready in about 2 s at most (plus a Lambda
  cold start). A check that takes longer than 1 s is `warn` with output `slow`; one that fails is `fail` with output
  `timeout` or `read failed`. The top-level `status` is the worst of the functions'.
- Read only: no writes, no S3 LIST, no calls to Microsoft or any other third party. The response names no table,
  bucket or function and contains no counts, user data or stack traces.

| Key | Name | What the check reads |
| --- | --- | --- |
| `posts` | Posts | DynamoDB `GetItem` of a fixed key (`health-check`, never a real post) on the posts table. |
| `reactions` | Reactions | DynamoDB `GetItem` of a fixed key (`post#health-check`, `counts`) on the reactions table. |
| `storage` | Published content storage | S3 `HeadObject` of the published post list (`content/index.json`). |
| `signin` | Microsoft sign-in | The SSM Parameter Store read the sign-in already does (tenant ID, client ID and secret present; cached 5 minutes in the Lambda). It does not call Microsoft. |

Example response:

```json
{
  "status": "pass",
  "time": "2026-11-04T09:00:00Z",
  "functions": [
    { "key": "posts", "name": "Posts", "status": "pass" },
    { "key": "reactions", "name": "Reactions", "status": "pass" },
    { "key": "storage", "name": "Published content storage", "status": "pass" },
    { "key": "signin", "name": "Microsoft sign-in", "status": "warn", "output": "slow" }
  ]
}
```

## Not tested

A guest can't test anything that needs the owner's Microsoft sign-in or that changes content:

- Signing in itself (it needs the owner's Microsoft account) and the signed-in session.
- Writing, editing, publishing, unpublishing and deleting posts.
- Uploading pictures and files to a post, and deleting them.
- The managed Microsoft API for AI agents (it needs a Microsoft access token; see /docs/api.md).
- Sending a reaction (a write) and its rate limit.
- Clearing CloudFront's copy of deleted or changed media (it runs after the owner deletes something).
- The link preview of a particular post (posts can be unpublished or deleted).

## Rules

- The tests are read only and must never change content: `GET` and `HEAD` only, never `POST`, `PUT` or `DELETE`.
- No cookies, no `Authorization` header and no credentials of any kind.
- At most one run every 15 minutes (plus one retry of a failed check).
