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
    ['1 Lambda', 'only for sign-in and the author’s changes', 'lambda'],
    ['2 tables', 'DynamoDB holds posts, drafts and API tokens', 'dynamodb'],
    ['1 CloudFront', 'serves every page, post, picture and API call', 'cloudfront'],
  ]));

  root.append(tiers({
    title: 'Components',
    rows: [
      {
        label: 'People', badge: 'Browser', tone: 'untrusted',
        nodes: [
          { icon: 'users', title: 'Readers', text: 'Read the list of posts and open a post; no account' },
          { icon: 'pen', title: 'Author', text: 'Signs in with Microsoft to write, publish and attach files' },
          { icon: 'bot', title: 'AI agent', text: 'Writes posts for the author through the API, with an API token' },
        ],
      },
      {
        label: 'Edge', badge: 'CDN', tone: 'edge', link: 'HTTPS to blog.dliu.com',
        nodes: [
          { icon: 'cloudfront', title: 'CloudFront', text: 'TLS, caching, security headers; the only public entry point' },
          { icon: 'code', title: 'Viewer function', text: 'Serves /<postId>, /admin and /docs; redirects old links; passes API tokens on' },
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
        label: 'Author API', badge: 'On demand', tone: 'app', link: 'Only /api/* and /auth/*',
        nodes: [
          { icon: 'lambda', title: 'API Lambda', text: 'Sign-in, posts, uploads; runs only when called' },
          { icon: 'dynamodb', title: 'DynamoDB', text: 'Posts, drafts and hashed API tokens; on-demand billing' },
          { icon: 'ssm', title: 'Parameter Store', text: 'Microsoft app ID and client secret' },
          { icon: 'entra', title: 'Microsoft Entra ID', text: 'Who is signing in' },
        ],
      },
    ],
    note: 'Readers never reach the Lambda or the database: the home page and posts are files that the API writes when the author publishes.',
  }));

  add('h2', 'Reading the blog');
  root.append(flow({
    title: 'Opening a post',
    numbered: true,
    steps: [
      { icon: 'browser', title: 'Browser', text: 'Asks for /2026102701' },
      { icon: 'cloudfront', title: 'CloudFront', text: 'The viewer function maps it to index.html' },
      { icon: 'page', title: 'App', text: 'app.js loads /content/posts/2026102701.json' },
      { icon: 'image', title: 'Media', text: 'Pictures and files come from /media/…, cached for a day' },
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
  add('p', 'The author can let another AI agent or script write posts without giving it a browser. On /admin/tokens the author generates an API token, saves it in ~/.dliu_credentials on the agent’s computer (like ~/.aws/credentials) and points the agent at the API guide, /docs/api.md, which is plain Markdown written for agents. The agent then calls the same API as the browser, sending the token in an Authorization header.');
  root.append(flow({
    title: 'An agent writing a post',
    numbered: true,
    steps: [
      { icon: 'key', title: 'Token', text: 'Generated on /admin/tokens; shown once' },
      { icon: 'lock', title: 'Credentials file', text: '[blog] token in ~/.dliu_credentials, mode 600' },
      { icon: 'bot', title: 'Agent', text: 'Reads /docs/api.md, then calls /api/* with the token' },
      { icon: 'cloudfront', title: 'CloudFront', text: 'The viewer function moves the token to x-blog-token' },
      { icon: 'lambda', title: 'API', text: 'Checks the token’s hash and expiry, then saves the post' },
    ],
    note: 'CloudFront signs requests to the Lambda with origin access control, which replaces the Authorization header, so the viewer function copies the token to its own header first.',
  }));

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
    [mono('/, /<postId>, /admin…'), 'Site bucket: index.html (single-page app)', 'Revalidated on every visit'],
    [mono('/docs'), 'Site bucket: docs.html', 'Revalidated on every visit'],
    [mono('/docs/api, /docs/api.md'), 'Site bucket: API guide as a page and as Markdown for agents', 'Revalidated on every visit'],
    [mono('/content/index.json'), 'Content bucket: list of published posts', 'Revalidated, so changes show at once'],
    [mono('/content/posts/<postId>.json'), 'Content bucket: one published post', 'Revalidated'],
    [mono('/media/<postId>/<file>/<name>'), 'Content bucket: pictures and attachments', 'One day'],
    [mono('/api/*, /auth/*'), 'API Lambda (author and agents only)', 'Never cached'],
  ]));
  root.append(table(['Store', 'What it holds', 'Public'], [
    ['Posts table', 'Every post: title, Markdown body, status, dates, file list', 'No'],
    ['Tokens table', 'API tokens: name, SHA-256 hash of the secret, expiry, last use', 'No'],
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

  source(root, 'Source: dliu-com/blog (lib/blog-stack.ts, functions/viewer-request.js, lambda/api, web/app.js, web/docs/api.md).');
}

// ---------------------------------------------------------------- Cost
function cost(root) {
  const add = writer(root);

  root.append(stats([
    ['$0', 'fixed monthly fee for compute', 'budget'],
    ['≈ $0.023', 'per GB of pictures and files per month', 's3'],
    ['1 TB free', 'of CloudFront delivery each month', 'cloudfront'],
    ['$0', 'to read a post: no code runs', 'users'],
  ]));

  add('h2', 'What each part costs');
  add('p', 'Prices are list prices for eu-west-1 (Ireland). Free tiers are per AWS account, so they are shared with the other dliu.com sites.');
  root.append(table(['Part', 'How it is billed', 'Typical month'], [
    ['S3 storage', 'S3 Standard, $0.023 per GB-month for pictures, files and post JSON; the site itself is a few hundred KB', num('≈ $0.023 / GB')],
    ['S3 requests', '$0.005 per 1,000 PUTs (one per upload and per published change); $0.0004 per 1,000 GETs on CloudFront cache misses', num('$0')],
    ['CloudFront', 'Free each month: 1 TB out, 10 million requests, 2 million function runs. Then $0.085 per GB and about $0.01 per 10,000 requests', num('$0')],
    ['CloudFront Functions', 'Page and visitor-ID functions: $0.10 per million runs after the free 2 million', num('$0')],
    ['API Lambda', '$0.20 per million calls and $0.0000167 per GB-second (512 MB). Free each month: 1 million calls and 400,000 GB-seconds. Readers never call it', num('$0')],
    ['DynamoDB', 'On demand: $1.25 per million writes and $0.25 per million reads; 25 GB of storage free', num('$0')],
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
  ]));

  root.append(flow({
    title: 'What keeps the bill small',
    steps: [
      { icon: 'power', title: 'No idle servers', text: 'The Lambda runs only for the author' },
      { icon: 'page', title: 'Static for readers', text: 'Published posts are files written on publish' },
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
    ['Hashed tokens', 'API tokens are stored only as SHA-256 hashes', 'key'],
    ['Drafts private', 'draft text never leaves DynamoDB', 'eye'],
  ]));

  add('h2', 'Who can do what');
  root.append(table(['Who', 'Can', 'How it is enforced'], [
    ['Anyone', 'Read published posts, pictures and files', 'CloudFront serves content/ and media/ read-only'],
    ['Signed-in dliu.com account', 'Write, publish, unpublish and delete posts; upload files; create and revoke API tokens', 'Session cookie checked on every API call'],
    ['Holder of an API token', 'List and read posts (drafts too), create, edit, publish and unpublish posts, upload files', 'Token hash and expiry checked on every call; cannot delete posts or manage tokens'],
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

  add('h2', 'API tokens');
  add('p', 'API tokens let an AI agent or script write posts without a browser. Only the signed-in author can create or revoke them, on /admin/tokens.');
  root.append(table(['Area', 'Control'], [
    ['Format', mono('blog_<12-hex ID>_<64-hex secret>'), ],
    ['Strength', '256 random bits per secret; the ID only finds the record'],
    ['Storage', 'DynamoDB keeps a SHA-256 hash of the secret; the token is shown once and cannot be shown again'],
    ['Checking', 'Constant-time comparison of hashes; expiry checked on every call; expired records are deleted automatically'],
    ['Lifetime', 'Expires after 7, 30, 90 (default) or 365 days, or never; revoke at any time; at most 20 live tokens'],
    ['Limits', 'Cannot delete posts, create or revoke tokens, or read the token list'],
    ['Transport', 'Accepted only in the Authorization or x-blog-token header, never in a URL or cookie, so it is absent from access logs'],
    ['Header handling', 'The viewer function copies Authorization: Bearer to x-blog-token for /api/* and deletes any x-blog-token a client sent itself'],
    ['Audit', 'Each use is logged with the token’s ID, name, method and path (not the secret); posts saved with a token record it in updatedVia; the token list shows when each was last used'],
    ['On the agent’s computer', 'Kept in ~/.dliu_credentials, mode 600, under [blog]. The save command reads it without echo, keeps it out of the shell history and clears the macOS clipboard. The guide’s helpers pipe it into curl, so it never appears in output or the process list'],
  ]));

  add('h2', 'Controls');
  root.append(table(['Area', 'Control'], [
    ['Accounts', 'Single-tenant Entra app; only accounts ending in @dliu.com are accepted'],
    ['Cross-site requests', 'Every change made with the session cookie must come from https://blog.dliu.com (Origin check) and the cookie is SameSite=Lax. Token requests need a header that browsers never add across sites, and CORS is never allowed'],
    ['Origins', 'Both buckets and the Lambda Function URL accept only CloudFront, signed with origin access control'],
    ['Buckets', 'Block all public access, S3-managed encryption, HTTPS only'],
    ['Uploads', 'Presigned PUT URLs valid 15 minutes, fixed size and type, at most 100 MB a file and 100 files a post'],
    ['File types', 'Only pictures, PDF, plain text, audio and video open in the browser; anything else (including HTML and SVG) downloads'],
    ['Post text', 'Markdown is rendered without raw HTML; links and pictures must be http(s), mailto or same-site'],
    ['Headers', 'Content-Security-Policy (scripts and styles from the site only), HSTS, X-Frame-Options DENY, nosniff, strict referrer'],
    ['Data', 'DynamoDB with deletion protection, point-in-time recovery and retain-on-delete'],
    ['Lambda', 'Reserved concurrency of 10 caps runaway cost; logs kept one month'],
  ]));
  root.append(callout('shield', 'The text of drafts and unpublished posts exists only in DynamoDB, which readers cannot reach; publishing is the only step that copies it to the public bucket. Files attached to a draft are already under /media, at addresses with a random 16-character ID that are not listed anywhere until the post is published.'));

  add('h2', 'Threat model');
  add('p', 'What could go wrong, what stops it, and how much risk is left. The biggest risks come from API tokens: whoever holds one can publish as the author.');
  root.append(table(['Scenario', 'Residual risk', 'Controls'], [
    ['A token leaks from the agent’s computer, chat history or a script', MEDIUM, 'Shown once; kept in a mode-600 file and never in the agent’s instructions or output; expires; revoke on /admin/tokens; last use shown; cannot delete posts or create tokens. Until revoked, the holder can read drafts and publish'],
    ['A prompt-injected or confused agent publishes unwanted text or overwrites the author’s edits', MEDIUM, 'Agents are told to save drafts unless asked to publish and to read a post before editing it; tokens cannot delete; updatedVia and logs show which token changed what; point-in-time recovery restores the table. Edits have no version check, so the last save wins'],
    ['Other software running as the same user reads ~/.dliu_credentials', MEDIUM, 'Same exposure as ~/.aws/credentials: file mode 600 stops other users, not the owner’s own processes. Use short expiry and one token per agent so one can be revoked alone'],
    ['A leaked token is used to fill the bucket with uploads', LOW, 'Uploads are capped at 100 MB a file and 100 files a post; unsaved uploads are deleted after a day; revoking stops new uploads; S3 storage costs about $0.023 per GB-month'],
    ['Someone guesses a token or forges one', LOW, '256-bit secret; only its hash is stored; constant-time comparison; a wrong token gets 401 and never falls back to the cookie'],
    ['A client sends its own x-blog-token header to bypass checks', LOW, 'The viewer function deletes it unless it came from Authorization: Bearer, and the value must still match a stored hash'],
    ['A malicious site makes the author’s browser change posts (CSRF)', LOW, 'Origin check and SameSite=Lax cookie; token requests can’t be forged cross-site because browsers never add the token header for another site'],
    ['A stolen or forged session cookie', LOW, 'HMAC-signed with a key from Parameter Store, compared in constant time; HttpOnly, Secure, __Host- prefix; expires in 30 days; rotating the client secret signs everyone out'],
    ['The session cookie is read from the traffic logs', LOW, 'CloudFront access logs include cookies (for the visitor ID) and keep them up to a year in the private log bucket. Only someone with access to the AWS account can read them, and that person can already change the blog'],
    ['Sign-in is tampered with: forged callback, stolen code or open redirect', LOW, 'state, nonce and PKCE; ID token signature, issuer, tenant and audience checked; return paths must be on this site'],
    ['A post or upload runs script in readers’ browsers (stored XSS)', LOW, 'Markdown rendered with DOM methods and no raw HTML; safe link schemes only; CSP allows scripts from the site only; HTML and SVG uploads download instead of opening'],
    ['The tokens page is framed to trick the author into clicking (clickjacking)', LOW, 'X-Frame-Options DENY and CSP frame-ancestors none'],
    ['Someone calls the Lambda URL or the buckets directly', LOW, 'Origin access control: they accept only requests signed by this CloudFront distribution'],
    ['A flood of API requests runs up the bill', LOW, 'Reserved concurrency of 10; a wrong token costs one DynamoDB read; readers never call the API'],
    ['Secrets leak through the source code', LOW, 'The Microsoft client secret is a SecureString in Parameter Store; tokens exist only on the agent’s computer and as hashes'],
    ['A draft is seen before publishing', LOW, 'Draft text stays in DynamoDB; draft files are at random, unlisted URLs'],
  ]));

  add('h2', 'Accepted residual risks');
  root.append(list([
    'No WAF or per-client rate limit; reserved Lambda concurrency is the backstop.',
    'Sessions cannot be revoked one by one; rotating the client secret ends all of them.',
    'API tokens are not tied to the Microsoft account: signing out or rotating the client secret does not revoke them. Revoke them on /admin/tokens.',
    'A token can be set to never expire; prefer 90 days or less.',
    'A token holder can read every draft and publish; there is no read-only or draft-only token.',
    'There is no per-token upload quota or approval step before an agent’s post goes live.',
    'Pictures deleted from a post can stay in the CloudFront cache for up to a day.',
    'Heavy reader traffic beyond the free tier is billed; everything is cached at the edge and no code runs for readers.',
  ]));

  source(root, 'Source: dliu-com/blog (lambda/api/auth.js, lambda/api/index.js, lambda/api/tokens.js, lambda/api/s3.js, functions/viewer-request.js, web/markdown.js, lib/blog-stack.ts).');
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
  document.title = `${TITLES[current]} · Docs · Dewei Blog`;
  if (scroll) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => show(true));
show(false);
