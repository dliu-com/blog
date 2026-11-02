import { flow, tiers, stats, table, callout, more } from './diagram.js';
import { renderNav } from './docs-nav.js';

const TABS = ['architecture', 'cost', 'security'];
const TITLES = { architecture: 'Technical architecture', cost: 'Cost', security: 'Security' };
const num = (text) => ({ text, className: 'num' });
const mono = (text) => ({ text, className: 'mono' });

function writer(root) {
  return (tag, text, className) => {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    root.append(node);
    return node;
  };
}

function list(items) {
  const ul = document.createElement('ul');
  for (const text of items) {
    const li = document.createElement('li');
    li.textContent = text;
    ul.append(li);
  }
  return ul;
}

function source(root, text) {
  const footer = document.createElement('p');
  footer.className = 'source';
  footer.textContent = text;
  root.append(footer);
}

// ---------------------------------------------------------------- Architecture
function architecture(root) {
  const add = writer(root);

  root.append(stats([
    ['0 servers', 'nothing runs while nobody is writing', 'power'],
    ['1 Lambda', 'for the author, reactions and post pages’ share previews', 'lambda'],
    ['3 tables', 'DynamoDB holds posts, drafts and reactions (plus a retired token table)', 'dynamodb'],
    ['1 CloudFront', 'serves every page, post, picture and website API call', 'cloudfront'],
  ]));

  root.append(tiers({
    title: 'Components',
    rows: [
      {
        label: 'People', badge: 'Browser', tone: 'untrusted',
        nodes: [
          { icon: 'users', title: 'Readers', text: 'Read the list of posts, open a post and react to it; no account' },
          { icon: 'pen', title: 'Author', text: 'Signs in with Microsoft to write, publish and attach files' },
          { icon: 'bot', title: 'AI agent', text: 'Writes posts for the author through the Microsoft API, with the author’s Microsoft access token' },
        ],
      },
      {
        label: 'Edge', badge: 'CDN', tone: 'edge', link: 'HTTPS to blog.dliu.com',
        nodes: [
          { icon: 'cloudfront', title: 'CloudFront', text: 'TLS, HTTP/3, caching at every edge location, security headers; the website’s only entry point' },
          { icon: 'shield', title: 'API Gateway', text: 'The Microsoft API for agents: checks the Microsoft access token and the route’s permission before calling the Lambda' },
          { icon: 'code', title: 'Viewer function', text: 'Serves /<postId>, /admin and /docs; redirects old links; passes the reader’s IP on for the reactions limit' },
          { icon: 'page', title: 'Post-page cache', text: 'Each post page with its share preview, kept five minutes' },
        ],
      },
      {
        label: 'Static files', badge: 'S3', tone: 'private', link: 'Origin access control (signed requests)',
        nodes: [
          { icon: 's3', title: 'Site bucket', text: 'index.html, app.js, style.css, docs' },
          { icon: 's3', title: 'Content bucket', text: 'Published posts as JSON, pictures and files' },
        ],
      },
      {
        label: 'Author API', badge: 'On demand', tone: 'app', link: '/api/*, /auth/*, post pages on a cache miss, and the Microsoft API',
        nodes: [
          { icon: 'lambda', title: 'API Lambda', text: 'Sign-in, posts, uploads, reactions, post-page share tags; runs only when called' },
          { icon: 'dynamodb', title: 'DynamoDB', text: 'Posts, drafts and reaction counts; on-demand billing' },
          { icon: 'ssm', title: 'Parameter Store', text: 'Microsoft app ID and client secret' },
          { icon: 'entra', title: 'Microsoft Entra ID', text: 'Who is signing in' },
        ],
      },
    ],
    note: 'The home page and posts are files that the API writes when the author publishes. Readers ask the Lambda for two things: a post page’s share preview, at most once per post every five minutes per CloudFront location, and the post’s reactions. If the Lambda fails, CloudFront serves the plain page and the reaction buttons stay hidden.',
  }));

  add('h2', 'Reading the blog');
  root.append(flow({
    title: 'Opening a post',
    numbered: true,
    steps: [
      { icon: 'browser', title: 'Browser', text: 'Asks for /2026102701' },
      { icon: 'cloudfront', title: 'CloudFront', text: 'Serves index.html with the post’s title, text and picture for link previews (from cache, or the Lambda adds them)' },
      { icon: 'page', title: 'App', text: 'app.js loads /content/posts/2026102701.json' },
      { icon: 'image', title: 'Media', text: 'Pictures and files come from /media/…, cached for a day' },
      { icon: 'lambda', title: 'Reactions', text: 'app.js asks /api/reactions/2026102701 for the counts and the reader’s own reaction' },
    ],
    note: 'The home page reads /content/index.json, a list of every published post with its title and date. There is no paging; the blog is small.',
  }));

  add('h2', 'Writing a post');
  add('p', 'The workflow is the familiar one: write a draft, preview it, attach pictures or files, then publish. Updating a published post rewrites its file; unpublishing or deleting removes it.');
  root.append(flow({
    title: 'Draft to published',
    numbered: true,
    steps: [
      { icon: 'entra', title: 'Sign in', text: 'Microsoft sign-in; the API sets a session cookie' },
      { icon: 'pen', title: 'New post', text: 'Gets the next post ID for today, e.g. 2026102700' },
      { icon: 'upload', title: 'Attach', text: 'The browser uploads straight to S3 with a short-lived URL' },
      { icon: 'dynamodb', title: 'Save draft', text: 'Saved in DynamoDB only; readers can’t see it' },
      { icon: 'check', title: 'Publish', text: 'The API writes the post JSON and the updated list to S3' },
    ],
  }));

  add('h2', 'API for AI agents');
  add('p', 'The author can let another AI agent or script write posts without giving it a browser. The author signs in with Microsoft on auth.dliu.com and exports an access token (see auth.dliu.com/docs/api), then gives a trusted local agent only the API guide, /docs/api.md, and a specific task. The agent calls the separate Microsoft API (API Gateway) with the token in an Authorization header. The blog issues and stores no API tokens.');
  root.append(flow({
    title: 'An agent writing a post',
    numbered: true,
    steps: [
      { icon: 'entra', title: 'Microsoft', text: 'auth.dliu.com gets an access token with blog.* permissions for an assigned user' },
      { icon: 'bot', title: 'Agent', text: 'Reads /docs/api.md, then calls the Microsoft API with the token' },
      { icon: 'shield', title: 'API Gateway', text: 'Checks signature, issuer, audience, expiry and the route’s permission' },
      { icon: 'lambda', title: 'API', text: 'Checks tenant, client, user, the api.access role and the permission again, then saves the post' },
    ],
    note: 'The Microsoft API serves only nine post and file routes (see /docs/api), never reactions, sign-in or site pages, and never reads cookies. The website’s /api/* knows only the session cookie and accepts no bearer tokens.',
  }));

  add('h2', 'Reactions');
  add('p', 'Under each post, readers can react with 👍 Like, ❤️ Love, 😂 Haha or 😢 Sad, without an account. Each reader has one reaction per post: choosing another switches it, and clicking the same one again removes it. A line under the buttons says what the reader chose, such as “You liked this post”.');
  add('p', 'Readers are told apart by the dl_vid cookie, the same visitor ID the traffic monitor sets for all of dliu.com (HttpOnly, one year). A reader who has none gets one on their first reaction. The Reactions table keeps one count item per post and one item per reader and post; a single conditional transaction moves the reader’s item and both counts, so the counts never drift. To slow down count inflation, each IP address may react at most 60 times an hour; the address is stored only as a SHA-256 hash, in a window that expires after two hours.');
  add('p', 'Signed-in authors also see a “Who reacted” box under the buttons: each reader’s reaction and time, and their visitor ID linked to that visitor’s page in the traffic monitor (traffic.dliu.com/visitor, behind its own Microsoft 365 sign-in). The box comes from /api/posts/<postId>/reactions, which needs the website session; guests and readers only ever get the counts and their own reaction, and the Microsoft API doesn’t serve it.');

  add('h2', 'Post IDs');
  add('p', 'Every post gets an ID made of the date it was created and a two-digit counter: the first post of 27 October 2026 is 2026102700, the next one that day 2026102701, and so on up to 99. The date is in UTC. The ID never changes, and it is also the post’s address: blog.dliu.com/2026102701.');
  root.append(table(['Post created', 'ID'], [
    ['First post on 27 Oct 2026', mono('2026102700')],
    ['Second post the same day', mono('2026102701')],
    ['First post on 28 Oct 2026', mono('2026102800')],
  ]));
  add('p', 'DynamoDB creates a post only if its ID is unused, so two posts started at the same moment never share an ID.', 'dg-note');

  add('h2', 'Where things live');
  root.append(table(['Path', 'Served from', 'Caching'], [
    [mono('/, /admin…'), 'Site bucket: index.html (single-page app)', 'Revalidated on every visit'],
    [mono('/<postId>'), 'API Lambda: index.html with the post’s share tags; site bucket’s index.html if the post isn’t published or the Lambda fails', 'Five minutes at CloudFront, revalidated by browsers'],
    [mono('/docs'), 'Site bucket: docs.html', 'Revalidated on every visit'],
    [mono('/docs/api, /docs/api.md'), 'Site bucket: API guide as a page and as Markdown for agents', 'Page revalidated on every visit; Markdown as for scripts below'],
    [mono('Scripts, styles, images'), 'Site bucket', 'A day at CloudFront, cleared by each deploy; five minutes in browsers'],
    [mono('/content/index.json'), 'Content bucket: list of published posts', 'Revalidated, so changes show at once'],
    [mono('/content/posts/<postId>.json'), 'Content bucket: one published post', 'Revalidated'],
    [mono('/media/<postId>/<file>/<name>'), 'Content bucket: pictures and attachments', 'A day; deletes cleared at CloudFront within about two minutes'],
    [mono('/api/reactions/<postId>'), 'API Lambda: reaction counts for anyone; react without an account', 'Never cached'],
    [mono('/api/*, /auth/*'), 'API Lambda (signed-in author only)', 'Never cached'],
    [mono('Microsoft API'), 'API Gateway → API Lambda: post and file routes for agents, address in /docs/api', 'Never cached'],
  ]));
  add('p', 'CloudFront only needs automatic clearing where a file can change or be deleted without anything else clearing it. The 1,000 free invalidation paths a month are shared by every dliu.com site, so the blog uses them for media/ only: deletes and console changes wait a minute in a queue and are cleared together, one wildcard per file folder or per post, usually a few paths a month.');
  root.append(table(['Files', 'Kept at CloudFront', 'How changes are cleared'], [
    ['Site bucket: scripts, styles, images, docs/api.md', 'A day', 'Each deploy clears /*. Only a deploy changes them, so no automatic clearing'],
    ['Site bucket: HTML pages', 'None (revalidated every time)', 'Not needed'],
    ['Content bucket: content/*.json', 'None (revalidated every time)', 'Not needed; published changes show at once'],
    ['Content bucket: media/', 'A day', 'Automatic: deleting a file or post, or changing media/ in the S3 console, is cleared within about two minutes. The app’s own saves always go to a new address that was never cached, so they are not cleared'],
    ['Content bucket: pending/', 'Not served', 'Not needed'],
    ['Logging buckets', 'Not served', 'Not needed; files are added all the time'],
  ]));
  root.append(table(['Store', 'What it holds', 'Public'], [
    ['Posts table', 'Every post: title, Markdown body, status, dates, file list', 'No'],
    ['Tokens table (retired)', 'The old blog API tokens: name, SHA-256 hash of the secret, expiry. No longer used; kept so its history is not deleted', 'No'],
    ['Reactions table', 'Counts per post; each reader’s reaction by visitor ID; hashed-IP rate-limit windows', 'Counts to everyone; visitor IDs to signed-in authors only'],
    [mono('content/'), 'JSON for published posts only', 'Yes, through CloudFront'],
    [mono('media/'), 'Files attached to posts (random, unlisted paths)', 'Yes, through CloudFront'],
    [mono('pending/'), 'Uploads not yet saved with a post; deleted after a day', 'No'],
  ]));

  root.append(more('Old links',
    list([
      '/posts/<postId> redirects to /<postId> (301).',
      'Old WordPress post links (/<slug>/) redirect to the home page; the WordPress posts were not carried over.',
      '/yyyy/mm/ redirects to the home page filtered to that month.',
      '/page/2/ redirects to the home page, which lists every post.',
      '/wp-admin and /wp-login.php go to the author’s list of posts.',
    ]),
  ));

  source(root, 'Source: dliu-com/blog (lib/blog-stack.ts, functions/viewer-request.js, lambda/api, lambda/invalidate, web/app.js, web/docs/api.md).');
}

// ---------------------------------------------------------------- Cost
function cost(root) {
  const add = writer(root);

  root.append(stats([
    ['$0', 'fixed monthly fee for compute', 'budget'],
    ['≈ $0.023', 'per GB of pictures and files per month', 's3'],
    ['1 TB free', 'of CloudFront delivery each month', 'cloudfront'],
    ['$0', 'to read a post, in the free tier', 'users'],
  ]));

  add('h2', 'What each part costs');
  add('p', 'Prices are list prices for eu-west-1 (Ireland). Free tiers are per AWS account, so they are shared with the other dliu.com sites.');
  root.append(table(['Part', 'How it is billed', 'Typical month'], [
    ['S3 storage', 'S3 Standard, $0.023 per GB-month for pictures, files and post JSON; the site itself is a few hundred KB', num('≈ $0.023 / GB')],
    ['S3 requests', '$0.005 per 1,000 PUTs (one per upload and per published change); $0.0004 per 1,000 GETs on CloudFront cache misses', num('$0')],
    ['CloudFront', 'Free each month: 1 TB out, 10 million requests, 2 million function runs. Then $0.085 per GB and about $0.01 per 10,000 requests', num('$0')],
    ['CloudFront invalidations', 'First 1,000 paths a month free (shared by all dliu.com sites), then $0.005 per path. Deploys use one; deleted or console-changed media a few more. S3 events, the queue and the clearing function stay in their free tiers', num('$0')],
    ['CloudFront Functions', 'Page and visitor-ID functions: $0.10 per million runs after the free 2 million', num('$0')],
    ['API Lambda', '$0.20 per million calls and $0.0000167 per GB-second (512 MB). Free each month: 1 million calls and 400,000 GB-seconds. Readers call it for post-page share tags, which CloudFront caches, and once per post view for reactions', num('$0')],
    ['API Gateway', 'Microsoft API (HTTP API): $1.00 per million requests; only agents call it', num('$0')],
    ['DynamoDB', 'On demand: $1.25 per million writes and $0.25 per million reads; 25 GB of storage free. A post view reads 2 items; a reaction writes about 4', num('$0')],
    ['DynamoDB backups', 'Point-in-time recovery: $0.20 per GB-month of table data; posts are a few KB each', num('< $0.01')],
    ['Parameter Store and KMS', 'Standard parameters are free; the AWS-managed key decrypts the client secret, 20,000 free requests a month', num('$0')],
    ['CloudWatch Logs', 'Lambda logs kept one month; $0.57 per GB, a few KB a month', num('$0')],
    ['Certificate (ACM) and DNS', 'Public certificates are free; alias records to CloudFront answer free in the existing dliu.com zone', num('$0')],
    ['Traffic logs', 'Billed to the traffic monitor: $0.25 per GB of log lines', num('< $0.01')],
  ]));
  root.append(callout('power', 'There is no EC2, container, load balancer, file system, NAT gateway or database server, so nothing costs money just by existing. With no pictures stored, the bill is effectively $0.'));

  add('h2', 'Compared with WordPress');
  add('p', 'The previous blog ran the WordPress Docker image on an ECS container host, with an EFS file system for uploads and a MySQL database. The container ran around the clock whether anyone visited or not, so most of the bill paid for idle time. The new blog keeps the same writing workflow and pays only when someone reads or writes.');
  root.append(table(['', 'WordPress on ECS', 'Serverless blog'], [
    ['Compute while idle', 'A WordPress container running 24/7', num('$0')],
    ['Storage', 'EFS for uploads, themes and plugins', 'S3 for pictures and files'],
    ['Reading a post', 'PHP renders the page, queries MySQL', 'CloudFront serves files'],
    ['Patching', 'WordPress, plugins, PHP, MySQL, the host', 'AWS-managed runtime only'],
  ]));

  add('h2', 'Examples');
  root.append(table(['Situation', 'Estimate'], [
    ['A month with nobody writing', num('$0 + storage')],
    ['500 MB of pictures stored', num('≈ $0.01 / month')],
    ['Writing and publishing a post with 10 pictures (about 30 API calls)', num('< $0.0001')],
    ['10,000 page views a month', num('$0 in the free tier')],
    ['1,000 reactions a month', num('≈ $0.005')],
  ]));

  root.append(flow({
    title: 'What keeps the bill small',
    steps: [
      { icon: 'power', title: 'No idle servers', text: 'The Lambda runs only when called' },
      { icon: 'page', title: 'Static for readers', text: 'Published posts are files written on publish; only reactions need the Lambda' },
      { icon: 'upload', title: 'Direct uploads', text: 'Files go from the browser to S3, not through Lambda' },
      { icon: 'clock', title: 'Clean-up', text: 'Unsaved uploads are deleted after a day' },
    ],
  }));

  add('p', 'Prices checked in October 2026 for eu-west-1 (excluding VAT). AWS may change them; see aws.amazon.com/pricing.', 'dg-note');
  source(root, 'Source: dliu-com/blog (lib/blog-stack.ts, lambda/api/s3.js).');
}

// ---------------------------------------------------------------- Security
const LOW = { text: 'Low', className: 'risk-low' };
const MEDIUM = { text: 'Medium', className: 'risk-medium' };

function security(root) {
  const add = writer(root);

  root.append(stats([
    ['1 author', 'only dliu.com Microsoft accounts can write', 'entra'],
    ['0 public buckets', 'S3 is reachable only through CloudFront', 'lock'],
    ['Scoped API', 'the Microsoft API needs an assigned user and the route’s exact permission', 'key'],
    ['Drafts private', 'draft text never leaves DynamoDB', 'eye'],
  ]));

  add('h2', 'Who can do what');
  root.append(table(['Who', 'Can', 'How it is enforced'], [
    ['Anyone', 'Read published posts, pictures and files', 'CloudFront serves content/ and media/ read-only'],
    ['Any reader', 'One reaction per published post, changed or removed at will; see the counts', 'Keyed by the dl_vid visitor cookie; at most 60 reactions an hour per IP address; same-site requests only'],
    ['Signed-in dliu.com account', 'Write, publish, unpublish and delete posts; upload files', 'Session cookie checked on every API call'],
    ['An app with the author’s Microsoft access token', 'blog.read: list and read posts (drafts too); blog.write: create, edit, publish and unpublish posts and upload files; blog.delete: delete posts and files', 'API Gateway checks the token and the route’s permission; the Lambda checks tenant, client, user, the api.access role and the exact permission again'],
    ['Any other Microsoft account', 'Nothing more than a reader', 'Refused after sign-in: wrong tenant or domain'],
  ]));

  add('h2', 'Signing in');
  root.append(flow({
    title: 'Microsoft sign-in (OpenID Connect)',
    numbered: true,
    steps: [
      { icon: 'browser', title: 'Sign in', text: '/auth/login sends the browser to Microsoft with state, nonce and PKCE' },
      { icon: 'entra', title: 'Microsoft', text: 'The author signs in to the dliu.com tenant' },
      { icon: 'lambda', title: 'Callback', text: 'The API swaps the code for an ID token and checks its signature, issuer, tenant, audience, nonce and expiry' },
      { icon: 'cookie', title: 'Session', text: 'HMAC-signed __Host- cookie: HttpOnly, Secure, SameSite=Lax, 30 days' },
    ],
    note: 'The client secret is a SecureString in Parameter Store; the session key is derived from it, so rotating the secret signs everyone out.',
  }));

  add('h2', 'Microsoft API');
  add('p', 'Agents and scripts use a separate Microsoft API (an API Gateway HTTP API). Tokens are issued by Microsoft Entra and obtained through auth.dliu.com; the blog neither issues nor stores them.');
  root.append(table(['Area', 'Control'], [
    ['Tokens', 'Microsoft access tokens (v2) from the dliu.com tenant for the dliu API app, obtained by the user on the auth.dliu.com console'],
    ['Gateway checks', 'The JWT authorizer checks Microsoft’s signature, issuer, audience, expiry and the blog.read, blog.write or blog.delete permission the route needs; the Lambda never runs otherwise'],
    ['Lambda checks', 'The request must come from this API, and the token must be v2, from the right tenant, audience and client app, with a user ID, the api.access role and the exact permission'],
    ['Users', 'api.access (dliu API user) is one app role for users only, shared by all dliu.com APIs; only the account assigned it can use this API (other organisation accounts keep website sign-in only), and the blog.* permissions still decide what a token can do here'],
    ['Routes', 'Only nine post and file routes; reactions, sign-in and site pages are not on this API. Deleting needs the separate blog.delete permission'],
    ['No fallback', 'The Microsoft API never reads cookies; the website’s /api/* never reads bearer tokens'],
    ['Audit', 'Posts saved through the Microsoft API record “Microsoft API” in updatedVia; the Authorization header and full requests are never logged'],
    ['Old tokens', 'The former blog_… API tokens are no longer accepted and /admin/tokens is gone; their table is retained, unused, so no history is deleted'],
  ]));

  add('h2', 'Controls');
  root.append(table(['Area', 'Control'], [
    ['Accounts', 'Single-tenant Entra app; only accounts ending in @dliu.com are accepted'],
    ['Cross-site requests', 'Every change made with the session cookie must come from https://blog.dliu.com (Origin check) and the cookie is SameSite=Lax. The Microsoft API is another origin with no CORS, and needs a bearer token that browsers never add on their own'],
    ['Origins', 'Both buckets and the Lambda Function URL accept only CloudFront, signed with origin access control'],
    ['Buckets', 'Block all public access, S3-managed encryption, HTTPS only'],
    ['Uploads', 'Presigned PUT URLs valid 15 minutes, fixed size and type, at most 100 MB a file and 100 files a post'],
    ['File types', 'Only pictures, PDF, plain text, audio and video open in the browser; anything else (including HTML and SVG) downloads'],
    ['Post text', 'Markdown is rendered without raw HTML; links and pictures must be http(s), mailto or same-site; videos only from video.dliu.com, rebuilt from the video ID'],
    ['Headers', 'Content-Security-Policy (scripts from the site and the traffic monitor only, styles from the site only, frames from video.dliu.com only), HSTS, X-Frame-Options DENY, nosniff, strict referrer'],
    ['Data', 'DynamoDB with deletion protection, point-in-time recovery and retain-on-delete'],
    ['Lambda', 'Reserved concurrency of 10 caps runaway cost; logs kept one month'],
    ['Reactions', 'Same-site JSON POST only; one of four values; published posts only; 60 an hour per IP, taken from CloudFront’s view of the connection (the viewer function overwrites x-blog-viewer, so clients can’t choose it); IPs kept only as hashes for two hours'],
  ]));
  root.append(callout('shield', 'The text of drafts and unpublished posts exists only in DynamoDB, which readers cannot reach; publishing is the only step that copies it to the public bucket. Files attached to a draft are already under /media, at addresses with a random 16-character ID that are not listed anywhere until the post is published.'));

  add('h2', 'Threat model');
  add('p', 'What could go wrong, what stops it, and how much risk is left. It assumes the attacker has read the source code, which is public on GitHub. The biggest risk is a Microsoft access token for the API: until it expires, whoever holds one with blog.write can publish as the author.');
  root.append(table(['Scenario', 'Residual risk', 'Controls'], [
    ['A Microsoft access token leaks from the agent’s computer, chat history or a script', MEDIUM, 'Tokens expire after about an hour; only their permissions work (no deleting without blog.delete); removing the user’s api.access assignment stops new ones. Kept as the Auth guide says, never in chat or output. Until it expires, the holder can do whatever its permissions allow'],
    ['A prompt-injected or confused agent publishes unwanted text or overwrites the author’s edits', MEDIUM, 'Agents are told to save drafts unless asked to publish and to read a post before editing it; nothing can be deleted without blog.delete; updatedVia shows “Microsoft API”; point-in-time recovery restores the table. Edits have no version check, so the last save wins'],
    ['Other software running as the same user reads the saved token', MEDIUM, 'Same exposure as ~/.aws/credentials: file permissions stop other users, not the owner’s own processes. The token expires soon; store it as auth.dliu.com/docs/api says'],
    ['A leaked token is used to fill the bucket with uploads', LOW, 'Uploads are capped at 100 MB a file and 100 files a post; unsaved uploads are deleted after a day; uploads stop when the token expires; S3 storage costs about $0.023 per GB-month'],
    ['Someone forges a token, or uses one meant for another app, tenant or site', LOW, 'API Gateway checks Microsoft’s signature, issuer, audience, expiry and permission; the Lambda checks the API ID, tenant, client, user and api.access role. A mismatch gets 401 or 403 and never falls back to the cookie'],
    ['A bearer token is sent to the website’s /api/*, or another route is called on the Microsoft API', LOW, 'The website knows only the session cookie, so a bearer token is ignored (CloudFront replaces Authorization anyway). The Microsoft API has only nine routes, and the Lambda also refuses any route not in routes.json'],
    ['A malicious site makes the author’s browser change posts (CSRF)', LOW, 'Origin check and SameSite=Lax cookie; the Microsoft API reads no cookies and allows no CORS'],
    ['The session cookie is read from the traffic logs', LOW, 'CloudFront logs the whole Cookie header (for the visitor ID). The traffic monitor keeps only the visitor ID before filing each log, and on 28 October 2026 it removed the session cookies from the logs it had already kept; sessions from before then were ended. The unprocessed file lasts seconds in a private bucket'],
    ['A stolen or forged session cookie', LOW, 'HMAC-signed with a key from Parameter Store, compared in constant time; HttpOnly, Secure, __Host- prefix; expires in 30 days; rotating the client secret signs everyone out'],
    ['Someone who has read the public source replays the sign-in cookie that /auth/login gives anyone as a session cookie', LOW, 'Fixed on 28 October 2026 after a penetration test. Sign-in and session cookies are now signed with different keys and carry a type that is checked; a session must name a user. Every session from before the fix was ended. Tests replay the sign-in cookie and other forged payloads'],
    ['Sign-in is tampered with: forged callback, stolen code or open redirect', LOW, 'state, nonce and PKCE; ID token signature, issuer, tenant and audience checked; return paths must be on this site'],
    ['A post or upload runs script in readers’ browsers (stored XSS)', LOW, 'Markdown rendered with DOM methods and no raw HTML; safe link schemes only; CSP allows scripts from the site and traffic.dliu.com only; HTML and SVG uploads download instead of opening'],
    ['An agent puts a picture from another site in a post to track readers', LOW, 'Pictures may come from any https address, so that site sees readers’ IP addresses; review agent posts before publishing'],
    ['A post embeds a player that misbehaves or loads another site', LOW, 'Only video.dliu.com, the owner’s own site, can be framed (CSP frame-src). The player address is rebuilt from a 10-digit video ID and a few checked options; nothing else from a pasted embed code is used'],
    ['The author’s pages are framed to trick the author into clicking (clickjacking)', LOW, 'X-Frame-Options DENY and CSP frame-ancestors none'],
    ['Readers flood post pages to use up the Lambda, or poison a cached share preview', LOW, 'CloudFront caches each post page for five minutes, and serves the plain page if the Lambda fails, so posts stay readable. The page is keyed by a post-ID header that only the viewer function sets; one sent by a reader is dropped. Only published posts get tags, built from their escaped title, excerpt and own picture'],
    ['Someone calls the Lambda URL or the buckets directly', LOW, 'Origin access control: they accept only requests signed by this CloudFront distribution'],
    ['A flood of API requests runs up the bill', LOW, 'Reserved concurrency of 10; API Gateway refuses bad Microsoft tokens before the Lambda runs; reactions are limited to 60 an hour per IP'],
    ['Someone inflates reaction counts by clearing cookies or forging visitor IDs', MEDIUM, 'One reaction per dl_vid, but anyone can drop or invent the cookie, so the 60-an-hour limit per IP is the real cap; many IPs (a botnet, or switching networks) can still add more. Counts are for fun and grant nothing; the author can delete the post’s reactions by deleting it, or edit the table'],
    ['Someone changes another reader’s reaction', LOW, 'Only by knowing that reader’s dl_vid, which is HttpOnly, random and sent only to dliu.com over HTTPS. The traffic monitor makes these IDs with Math.random, so they are not secret-grade; the worst outcome is a changed reaction'],
    ['Reactions are used to track readers', LOW, 'A reaction is stored with the reader’s dl_vid, which the traffic monitor already links to their visits; no name, email or IP is kept. Reacting is optional'],
    ['Reaction traffic uses up the Lambda the author needs', LOW, 'Reserved concurrency of 10 is shared; reaction counts are loaded after the post, and if the Lambda is busy the buttons stay hidden while the post still reads normally. Author requests retry'],
    ['Secrets leak through the source code', LOW, 'The source is public, so security does not rely on hiding it. The Microsoft client secret is a SecureString in Parameter Store; the blog stores no API tokens, and the tenant and app IDs are not secrets'],
    ['A draft is seen before publishing', LOW, 'Draft text stays in DynamoDB; draft files are at random, unlisted URLs'],
  ]));

  add('h2', 'Accepted residual risks');
  root.append(list([
    'No WAF; the only per-client rate limit is for reactions, and reserved Lambda concurrency is the backstop.',
    'Reaction counts can be inflated from many IP addresses; they are not proof of anything.',
    'Sessions cannot be revoked one by one; rotating the client secret ends all of them.',
    'A Microsoft access token cannot be revoked on its own before it expires (about an hour); removing the user’s api.access assignment stops new ones.',
    'A token with blog.read can read every draft, and one with blog.write can publish; there is no draft-only permission.',
    'There is no per-caller upload quota or approval step before an agent’s post goes live.',
    'The old token table is kept but unused; expired old token records are still removed by its existing TTL.',
    'A deleted picture leaves CloudFront within about two minutes, but a browser that already showed it may keep it for up to a day.',
    'Heavy reader traffic beyond the free tier is billed; pages are cached at the edge, but each post view also loads its reactions from the Lambda.',
  ]));

  source(root, 'Source: dliu-com/blog (lambda/api/auth.js, lambda/api/index.js, lambda/api/api-access.js, lambda/api/routes.json, lambda/api/reactions.js, lambda/api/s3.js, functions/viewer-request.js, web/markdown.js, lib/blog-stack.ts).');
}

renderNav();
architecture(document.getElementById('architecture'));
cost(document.getElementById('cost'));
security(document.getElementById('security'));

function show(scroll) {
  const current = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : TABS[0];
  for (const id of TABS) document.getElementById(id).hidden = id !== current;
  for (const tab of document.querySelectorAll('.info-tabs a')) {
    if (tab.dataset.tab === current) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  document.title = `${TITLES[current]} · Docs · DL blog`;
  if (scroll) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => show(true));
show(false);
