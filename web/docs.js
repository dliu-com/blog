import { flow, tiers, stats, table, callout, more } from './diagram.js';
import { renderNav } from './docs-nav.js';

const { t } = window.BlogI18n;
const TABS = ['architecture', 'cost', 'security'];
const TITLES = {
  architecture: () => t('技术架构', 'Technical architecture'),
  cost: () => t('运行成本', 'Cost'),
  security: () => t('安全', 'Security'),
};
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
    [t('0 台服务器', '0 servers'), t('没人写作时什么都不运行', 'nothing runs while nobody is writing'), 'power'],
    [t('1 个 Lambda', '1 Lambda'), t('用于作者、心情和文章页的分享预览', 'for the author, reactions and post pages’ share previews'), 'lambda'],
    [t('3 张表', '3 tables'), t('DynamoDB 保存文章、草稿和心情（另有一张已停用的旧令牌表）', 'DynamoDB holds posts, drafts and reactions (plus a retired token table)'), 'dynamodb'],
    [t('1 个 CloudFront', '1 CloudFront'), t('提供每个页面、文章、图片和网站 API 调用', 'serves every page, post, picture and website API call'), 'cloudfront'],
  ]));

  root.append(tiers({
    title: t('组件', 'Components'),
    rows: [
      {
        label: t('用户', 'People'), badge: t('浏览器', 'Browser'), tone: 'untrusted',
        nodes: [
          { icon: 'users', title: t('读者', 'Readers'), text: t('浏览文章列表、打开文章并点心情；无需账号', 'Read the list of posts, open a post and react to it; no account') },
          { icon: 'pen', title: t('作者', 'Author'), text: t('用 Microsoft 登录后写作、发布和上传附件', 'Signs in with Microsoft to write, publish and attach files') },
          { icon: 'bot', title: t('AI 助手', 'AI agent'), text: t('用作者的 Microsoft 访问令牌，通过 Microsoft API 替作者写文章', 'Writes posts for the author through the Microsoft API, with the author’s Microsoft access token') },
        ],
      },
      {
        label: t('边缘', 'Edge'), badge: t('CDN', 'CDN'), tone: 'edge', link: t('HTTPS 访问 blog.dliu.com', 'HTTPS to blog.dliu.com'),
        nodes: [
          { icon: 'cloudfront', title: t('CloudFront', 'CloudFront'), text: t('TLS、HTTP/3、所有边缘节点缓存、安全响应头；网站的唯一入口', 'TLS, HTTP/3, caching at every edge location, security headers; the website’s only entry point') },
          { icon: 'shield', title: t('API Gateway', 'API Gateway'), text: t('助手专用的 Microsoft API：先检查 Microsoft 访问令牌和该路由所需的权限，再调用 Lambda', 'The Microsoft API for agents: checks the Microsoft access token and the route’s permission before calling the Lambda') },
          { icon: 'code', title: t('查看器函数', 'Viewer function'), text: t('提供 /<postId>、/admin 和 /docs；跳转旧链接；为心情限流记下读者 IP', 'Serves /<postId>, /admin and /docs; redirects old links; passes the reader’s IP on for the reactions limit') },
          { icon: 'page', title: t('文章页缓存', 'Post-page cache'), text: t('每篇文章页连同分享预览缓存五分钟', 'Each post page with its share preview, kept five minutes') },
        ],
      },
      {
        label: t('静态文件', 'Static files'), badge: 'S3', tone: 'private', link: t('源站访问控制（签名请求）', 'Origin access control (signed requests)'),
        nodes: [
          { icon: 's3', title: t('网站存储桶', 'Site bucket'), text: t('index.html、app.js、style.css、文档', 'index.html, app.js, style.css, docs') },
          { icon: 's3', title: t('内容存储桶', 'Content bucket'), text: t('已发布文章的 JSON、图片和文件', 'Published posts as JSON, pictures and files') },
        ],
      },
      {
        label: t('作者 API', 'Author API'), badge: t('按需运行', 'On demand'), tone: 'app', link: t('/api/*、/auth/*、缓存未命中的文章页，以及 Microsoft API', '/api/*, /auth/*, post pages on a cache miss, and the Microsoft API'),
        nodes: [
          { icon: 'lambda', title: t('API Lambda', 'API Lambda'), text: t('登录、文章、上传、心情、文章页分享标签；只在被调用时运行', 'Sign-in, posts, uploads, reactions, post-page share tags; runs only when called') },
          { icon: 'dynamodb', title: t('DynamoDB', 'DynamoDB'), text: t('文章、草稿和心情计数；按需计费', 'Posts, drafts and reaction counts; on-demand billing') },
          { icon: 'ssm', title: t('Parameter Store', 'Parameter Store'), text: t('Microsoft 应用 ID 和客户端密钥', 'Microsoft app ID and client secret') },
          { icon: 'entra', title: t('Microsoft Entra ID', 'Microsoft Entra ID'), text: t('确认登录者身份', 'Who is signing in') },
        ],
      },
    ],
    note: t('首页和文章都是作者发布时由 API 写出的文件。读者只向 Lambda 要两样东西：文章页的分享预览（每个 CloudFront 节点每篇文章每五分钟最多一次），以及文章的心情。如果 Lambda 出错，CloudFront 会返回普通页面，心情按钮则不显示。', 'The home page and posts are files that the API writes when the author publishes. Readers ask the Lambda for two things: a post page’s share preview, at most once per post every five minutes per CloudFront location, and the post’s reactions. If the Lambda fails, CloudFront serves the plain page and the reaction buttons stay hidden.'),
  }));

  add('h2', t('阅读博客', 'Reading the blog'));
  root.append(flow({
    title: t('打开一篇文章', 'Opening a post'),
    numbered: true,
    steps: [
      { icon: 'browser', title: t('浏览器', 'Browser'), text: t('请求 /2026102701', 'Asks for /2026102701') },
      { icon: 'cloudfront', title: t('CloudFront', 'CloudFront'), text: t('返回带有文章标题、摘要和图片的 index.html，用于链接预览（来自缓存，或由 Lambda 加上）', 'Serves index.html with the post’s title, text and picture for link previews (from cache, or the Lambda adds them)') },
      { icon: 'page', title: t('应用', 'App'), text: t('app.js 加载 /content/posts/2026102701.json', 'app.js loads /content/posts/2026102701.json') },
      { icon: 'image', title: t('媒体', 'Media'), text: t('图片和文件来自 /media/…，缓存一天', 'Pictures and files come from /media/…, cached for a day') },
      { icon: 'lambda', title: t('心情', 'Reactions'), text: t('app.js 向 /api/reactions/2026102701 获取计数和读者自己的心情', 'app.js asks /api/reactions/2026102701 for the counts and the reader’s own reaction') },
    ],
    note: t('首页读取 /content/index.json，这是所有已发布文章的标题和日期列表。没有分页；博客不大。', 'The home page reads /content/index.json, a list of every published post with its title and date. There is no paging; the blog is small.'),
  }));

  add('h2', t('写文章', 'Writing a post'));
  add('p', t('流程和熟悉的一样：写草稿、预览、附上图片或文件，然后发布。更新已发布的文章会重写它的文件；撤回或删除会把文件移除。', 'The workflow is the familiar one: write a draft, preview it, attach pictures or files, then publish. Updating a published post rewrites its file; unpublishing or deleting removes it.'));
  root.append(flow({
    title: t('从草稿到发布', 'Draft to published'),
    numbered: true,
    steps: [
      { icon: 'entra', title: t('登录', 'Sign in'), text: t('Microsoft 登录；API 设置会话 Cookie', 'Microsoft sign-in; the API sets a session cookie') },
      { icon: 'pen', title: t('新文章', 'New post'), text: t('获取当天的下一个文章 ID，例如 2026102700', 'Gets the next post ID for today, e.g. 2026102700') },
      { icon: 'upload', title: t('附件', 'Attach'), text: t('浏览器用短时有效的地址直接上传到 S3', 'The browser uploads straight to S3 with a short-lived URL') },
      { icon: 'dynamodb', title: t('保存草稿', 'Save draft'), text: t('只存在 DynamoDB 中；读者看不到', 'Saved in DynamoDB only; readers can’t see it') },
      { icon: 'check', title: t('发布', 'Publish'), text: t('API 把文章 JSON 和更新后的列表写入 S3', 'The API writes the post JSON and the updated list to S3') },
    ],
  }));

  add('h2', t('供 AI 助手使用的 API', 'API for AI agents'));
  add('p', t('作者可以让另一个 AI 助手或脚本写文章，而不必给它浏览器。作者在 auth.dliu.com 用 Microsoft 登录并导出访问令牌（见 auth.dliu.com/docs/api），然后只把 API 指南 /docs/api.md 和具体任务交给本机受信任的助手。助手调用单独的 Microsoft API（API Gateway），在 Authorization 请求头中带上令牌。博客不签发、也不保存任何 API 令牌。', 'The author can let another AI agent or script write posts without giving it a browser. The author signs in with Microsoft on auth.dliu.com and exports an access token (see auth.dliu.com/docs/api), then gives a trusted local agent only the API guide, /docs/api.md, and a specific task. The agent calls the separate Microsoft API (API Gateway) with the token in an Authorization header. The blog issues and stores no API tokens.'));
  root.append(flow({
    title: t('AI 助手写文章', 'An agent writing a post'),
    numbered: true,
    steps: [
      { icon: 'entra', title: t('Microsoft', 'Microsoft'), text: t('auth.dliu.com 为已分配的用户取得带 blog.* 权限的访问令牌', 'auth.dliu.com gets an access token with blog.* permissions for an assigned user') },
      { icon: 'bot', title: t('助手', 'Agent'), text: t('阅读 /docs/api.md，然后带令牌调用 Microsoft API', 'Reads /docs/api.md, then calls the Microsoft API with the token') },
      { icon: 'shield', title: t('API Gateway', 'API Gateway'), text: t('检查签名、颁发者、受众、有效期和该路由的权限', 'Checks signature, issuer, audience, expiry and the route’s permission') },
      { icon: 'lambda', title: t('API', 'API'), text: t('再检查租户、客户端、用户、api.access 角色和权限，然后保存文章', 'Checks tenant, client, user, the api.access role and the permission again, then saves the post') },
    ],
    note: t('Microsoft API 只提供九个文章和文件路由（见 /docs/api），不提供心情、登录或网站页面，也从不读取 Cookie。网站的 /api/* 只认会话 Cookie，不接受持有者令牌。', 'The Microsoft API serves only nine post and file routes (see /docs/api), never reactions, sign-in or site pages, and never reads cookies. The website’s /api/* knows only the session cookie and accepts no bearer tokens.'),
  }));

  add('h2', t('心情', 'Reactions'));
  add('p', t('读者无需账号，就能在每篇文章下点 👍 赞、❤️ 爱心、😂 哈哈或 😢 难过。每位读者每篇文章只有一个心情：选另一个会切换，再点同一个会取消。按钮下方有一行字说明读者的选择，例如“你赞了这篇文章”。', 'Under each post, readers can react with 👍 Like, ❤️ Love, 😂 Haha or 😢 Sad, without an account. Each reader has one reaction per post: choosing another switches it, and clicking the same one again removes it. A line under the buttons says what the reader chose, such as “You liked this post”.'));
  add('p', t('读者通过 dl_vid Cookie 区分，这是流量监控为整个 dliu.com 设置的访客 ID（HttpOnly，有效一年）。没有该 Cookie 的读者在第一次点心情时会得到一个。心情表为每篇文章保存一条计数，为每位读者和文章保存一条记录；一次条件事务同时更新读者的记录和两个计数，所以计数不会出错。为了减缓刷数，每个 IP 地址每小时最多点 60 次；地址只以 SHA-256 哈希保存，所在时间窗口两小时后过期。', 'Readers are told apart by the dl_vid cookie, the same visitor ID the traffic monitor sets for all of dliu.com (HttpOnly, one year). A reader who has none gets one on their first reaction. The Reactions table keeps one count item per post and one item per reader and post; a single conditional transaction moves the reader’s item and both counts, so the counts never drift. To slow down count inflation, each IP address may react at most 60 times an hour; the address is stored only as a SHA-256 hash, in a window that expires after two hours.'));
  add('p', t('已登录的作者还会在按钮下方看到“谁点了心情”：每位读者的心情和时间，以及他们的访客 ID，链接到流量监控里该访客的页面（traffic.dliu.com/visitor，需单独用 Microsoft 365 登录）。这些来自 /api/posts/<postId>/reactions，需要网站会话；访客和读者只会拿到计数和自己的心情，Microsoft API 也不提供它。', 'Signed-in authors also see a “Who reacted” box under the buttons: each reader’s reaction and time, and their visitor ID linked to that visitor’s page in the traffic monitor (traffic.dliu.com/visitor, behind its own Microsoft 365 sign-in). The box comes from /api/posts/<postId>/reactions, which needs the website session; guests and readers only ever get the counts and their own reaction, and the Microsoft API doesn’t serve it.'));

  add('h2', t('文章 ID', 'Post IDs'));
  add('p', t('每篇文章的 ID 由创建日期和两位序号组成：2026 年 10 月 27 日的第一篇是 2026102700，当天下一篇是 2026102701，依此类推，最多到 99。日期按 UTC 计算。ID 不会改变，它也是文章的地址：blog.dliu.com/2026102701。', 'Every post gets an ID made of the date it was created and a two-digit counter: the first post of 27 October 2026 is 2026102700, the next one that day 2026102701, and so on up to 99. The date is in UTC. The ID never changes, and it is also the post’s address: blog.dliu.com/2026102701.'));
  root.append(table([t('创建的文章', 'Post created'), t('ID', 'ID')], [
    [t('2026 年 10 月 27 日第一篇', 'First post on 27 Oct 2026'), mono('2026102700')],
    [t('同一天第二篇', 'Second post the same day'), mono('2026102701')],
    [t('2026 年 10 月 28 日第一篇', 'First post on 28 Oct 2026'), mono('2026102800')],
  ]));
  add('p', t('DynamoDB 只在 ID 未被使用时才创建文章，所以同时开始的两篇文章不会拿到相同的 ID。', 'DynamoDB creates a post only if its ID is unused, so two posts started at the same moment never share an ID.'), 'dg-note');

  add('h2', t('各部分放在哪里', 'Where things live'));
  root.append(table([t('路径', 'Path'), t('来源', 'Served from'), t('缓存', 'Caching')], [
    [mono(t('/、/admin…', '/, /admin…')), t('网站存储桶：index.html（单页应用）', 'Site bucket: index.html (single-page app)'), t('每次访问都重新验证', 'Revalidated on every visit')],
    [mono(t('/<postId>', '/<postId>')), t('API Lambda：带文章分享标签的 index.html；如果文章未发布或 Lambda 出错，则用网站存储桶的 index.html', 'API Lambda: index.html with the post’s share tags; site bucket’s index.html if the post isn’t published or the Lambda fails'), t('CloudFront 缓存五分钟，浏览器重新验证', 'Five minutes at CloudFront, revalidated by browsers')],
    [mono(t('/docs', '/docs')), t('网站存储桶：docs.html', 'Site bucket: docs.html'), t('每次访问都重新验证', 'Revalidated on every visit')],
    [mono(t('/docs/api、/docs/api.md', '/docs/api, /docs/api.md')), t('网站存储桶：API 指南的网页版和供助手使用的 Markdown 版', 'Site bucket: API guide as a page and as Markdown for agents'), t('网页每次访问都重新验证；Markdown 与下方脚本相同', 'Page revalidated on every visit; Markdown as for scripts below')],
    [mono(t('脚本、样式、图片', 'Scripts, styles, images')), t('网站存储桶', 'Site bucket'), t('CloudFront 缓存一天，每次部署时清除；浏览器缓存五分钟', 'A day at CloudFront, cleared by each deploy; five minutes in browsers')],
    [mono(t('/content/index.json', '/content/index.json')), t('内容存储桶：已发布文章列表', 'Content bucket: list of published posts'), t('重新验证，所以改动立即可见', 'Revalidated, so changes show at once')],
    [mono(t('/content/posts/<postId>.json', '/content/posts/<postId>.json')), t('内容存储桶：一篇已发布文章', 'Content bucket: one published post'), t('重新验证', 'Revalidated')],
    [mono(t('/media/<postId>/<file>/<name>', '/media/<postId>/<file>/<name>')), t('内容存储桶：图片和附件', 'Content bucket: pictures and attachments'), t('一天；删除后约两分钟内从 CloudFront 清除', 'A day; deletes cleared at CloudFront within about two minutes')],
    [mono(t('/api/reactions/<postId>', '/api/reactions/<postId>')), t('API Lambda：任何人都能看心情计数；无需账号即可点心情', 'API Lambda: reaction counts for anyone; react without an account'), t('从不缓存', 'Never cached')],
    [mono(t('/api/*、/auth/*', '/api/*, /auth/*')), t('API Lambda（仅限已登录的作者）', 'API Lambda (signed-in author only)'), t('从不缓存', 'Never cached')],
    [mono(t('Microsoft API', 'Microsoft API')), t('API Gateway → API Lambda：供助手使用的文章和文件路由，地址见 /docs/api', 'API Gateway → API Lambda: post and file routes for agents, address in /docs/api'), t('从不缓存', 'Never cached')],
  ]));
  add('p', t('CloudFront 只有在文件被改动或删除、而没有其他机制清除时才需要自动清除。每个月免费的 1,000 个清除路径由所有 dliu.com 网站共用，所以博客只为 media/ 使用：删除和控制台改动先在队列中等待一分钟，再合并为一个路径（一个文件夹或一篇文章用一个通配符），通常每月只用几个。', 'CloudFront only needs automatic clearing where a file can change or be deleted without anything else clearing it. The 1,000 free invalidation paths a month are shared by every dliu.com site, so the blog uses them for media/ only: deletes and console changes wait a minute in a queue and are cleared together, one wildcard per file folder or per post, usually a few paths a month.'));
  root.append(table([t('文件', 'Files'), t('CloudFront 保留', 'Kept at CloudFront'), t('如何清除改动', 'How changes are cleared')], [
    [t('网站存储桶：脚本、样式、图片、docs/api.md', 'Site bucket: scripts, styles, images, docs/api.md'), t('一天', 'A day'), t('每次部署清除 /*；只有部署会改动这些文件，所以不需要自动清除', 'Each deploy clears /*. Only a deploy changes them, so no automatic clearing')],
    [t('网站存储桶：HTML 页面', 'Site bucket: HTML pages'), t('不缓存（每次重新验证）', 'None (revalidated every time)'), t('不需要', 'Not needed')],
    [t('内容存储桶：content/*.json', 'Content bucket: content/*.json'), t('不缓存（每次重新验证）', 'None (revalidated every time)'), t('不需要；发布的改动立即可见', 'Not needed; published changes show at once')],
    [t('内容存储桶：media/', 'Content bucket: media/'), t('一天', 'A day'), t('自动清除：删除文件或文章，或在 S3 控制台改动 media/ 后，约两分钟内清除。应用自己保存文件时总是写入新地址，从未被缓存，所以不清除', 'Automatic: deleting a file or post, or changing media/ in the S3 console, is cleared within about two minutes. The app’s own saves always go to a new address that was never cached, so they are not cleared')],
    [t('内容存储桶：pending/', 'Content bucket: pending/'), t('不对外提供', 'Not served'), t('不需要', 'Not needed')],
    [t('日志存储桶', 'Logging buckets'), t('不对外提供', 'Not served'), t('不需要；文件不断新增', 'Not needed; files are added all the time')],
  ]));
  root.append(table([t('存储', 'Store'), t('保存的内容', 'What it holds'), t('公开', 'Public')], [
    [t('文章表', 'Posts table'), t('每篇文章：标题、Markdown 正文、状态、日期、文件列表', 'Every post: title, Markdown body, status, dates, file list'), t('否', 'No')],
    [t('令牌表（已停用）', 'Tokens table (retired)'), t('旧的博客 API 令牌：名称、密钥的 SHA-256 哈希、有效期。已不再使用，为保留历史而保留', 'The old blog API tokens: name, SHA-256 hash of the secret, expiry. No longer used; kept so its history is not deleted'), t('否', 'No')],
    [t('心情表', 'Reactions table'), t('每篇文章的计数；按访客 ID 保存的每位读者的心情；IP 哈希限流窗口', 'Counts per post; each reader’s reaction by visitor ID; hashed-IP rate-limit windows'), t('计数公开；访客 ID 只给已登录的作者', 'Counts to everyone; visitor IDs to signed-in authors only')],
    [mono(t('content/', 'content/')), t('只有已发布文章的 JSON', 'JSON for published posts only'), t('是，通过 CloudFront', 'Yes, through CloudFront')],
    [mono(t('media/', 'media/')), t('文章附件（随机、未列出的路径）', 'Files attached to posts (random, unlisted paths)'), t('是，通过 CloudFront', 'Yes, through CloudFront')],
    [mono(t('pending/', 'pending/')), t('尚未随文章保存的上传；一天后删除', 'Uploads not yet saved with a post; deleted after a day'), t('否', 'No')],
  ]));

  root.append(more(t('旧链接', 'Old links'),
    list([
      t('/posts/<postId> 跳转到 /<postId>（301）。', '/posts/<postId> redirects to /<postId> (301).'),
      t('旧的 WordPress 文章链接（/<slug>/）跳转到首页；WordPress 文章没有迁移过来。', 'Old WordPress post links (/<slug>/) redirect to the home page; the WordPress posts were not carried over.'),
      t('/yyyy/mm/ 跳转到按该月份筛选的首页。', '/yyyy/mm/ redirects to the home page filtered to that month.'),
      t('/page/2/ 跳转到首页，首页列出所有文章。', '/page/2/ redirects to the home page, which lists every post.'),
      t('/wp-admin 和 /wp-login.php 跳转到作者的文章列表。', '/wp-admin and /wp-login.php go to the author’s list of posts.'),
    ]),
  ));

  source(root, t('源码：dliu-com/blog（lib/blog-stack.ts、functions/viewer-request.js、lambda/api、lambda/invalidate、web/app.js、web/docs/api.md）。', 'Source: dliu-com/blog (lib/blog-stack.ts, functions/viewer-request.js, lambda/api, lambda/invalidate, web/app.js, web/docs/api.md).'));
}

// ---------------------------------------------------------------- Cost
function cost(root) {
  const add = writer(root);

  root.append(stats([
    ['$0', t('计算资源的固定月费', 'fixed monthly fee for compute'), 'budget'],
    ['≈ $0.023', t('每 GB 图片和文件每月', 'per GB of pictures and files per month'), 's3'],
    [t('1 TB 免费', '1 TB free'), t('每月 CloudFront 流量', 'of CloudFront delivery each month'), 'cloudfront'],
    ['$0', t('阅读一篇文章，在免费额度内', 'to read a post, in the free tier'), 'users'],
  ]));

  add('h2', t('各部分费用', 'What each part costs'));
  add('p', t('价格为 eu-west-1（爱尔兰）的标价。免费额度按 AWS 账号计算，所以和 dliu.com 其他网站共用。', 'Prices are list prices for eu-west-1 (Ireland). Free tiers are per AWS account, so they are shared with the other dliu.com sites.'));
  root.append(table([t('部分', 'Part'), t('计费方式', 'How it is billed'), t('典型月份', 'Typical month')], [
    [t('S3 存储', 'S3 storage'), t('S3 标准存储，图片、文件和文章 JSON 每 GB 每月 $0.023；网站本身只有几百 KB', 'S3 Standard, $0.023 per GB-month for pictures, files and post JSON; the site itself is a few hundred KB'), num(t('≈ $0.023 / GB', '≈ $0.023 / GB'))],
    [t('S3 请求', 'S3 requests'), t('每 1,000 次 PUT $0.005（每次上传和每次发布改动各一次）；CloudFront 缓存未命中时每 1,000 次 GET $0.0004', '$0.005 per 1,000 PUTs (one per upload and per published change); $0.0004 per 1,000 GETs on CloudFront cache misses'), num('$0')],
    [t('CloudFront', 'CloudFront'), t('每月免费：1 TB 流出、1000 万次请求、200 万次函数运行。超出后每 GB $0.085，每 10,000 次请求约 $0.01', 'Free each month: 1 TB out, 10 million requests, 2 million function runs. Then $0.085 per GB and about $0.01 per 10,000 requests'), num('$0')],
    [t('CloudFront 清除', 'CloudFront invalidations'), t('每月前 1,000 个路径免费（所有 dliu.com 网站共用），之后每个路径 $0.005。每次部署用一个；删除或在控制台改动的媒体再用几个。S3 事件、队列和清除函数都在免费额度内', 'First 1,000 paths a month free (shared by all dliu.com sites), then $0.005 per path. Deploys use one; deleted or console-changed media a few more. S3 events, the queue and the clearing function stay in their free tiers'), num('$0')],
    [t('CloudFront Functions', 'CloudFront Functions'), t('页面和访客 ID 函数：免费 200 万次之后每百万次 $0.10', 'Page and visitor-ID functions: $0.10 per million runs after the free 2 million'), num('$0')],
    [t('API Lambda', 'API Lambda'), t('每百万次调用 $0.20，每 GB 秒 $0.0000167（512 MB）。每月免费：100 万次调用和 400,000 GB 秒。读者为文章页分享标签调用它（由 CloudFront 缓存），每次浏览文章还会为心情调用一次', '$0.20 per million calls and $0.0000167 per GB-second (512 MB). Free each month: 1 million calls and 400,000 GB-seconds. Readers call it for post-page share tags, which CloudFront caches, and once per post view for reactions'), num('$0')],
    [t('API Gateway', 'API Gateway'), t('Microsoft API（HTTP API）：每百万次请求 $1.00；只有助手调用它', 'Microsoft API (HTTP API): $1.00 per million requests; only agents call it'), num('$0')],
    [t('DynamoDB', 'DynamoDB'), t('按需计费：每百万次写入 $1.25，每百万次读取 $0.25；25 GB 存储免费。浏览一篇文章读取 2 条记录；点一次心情约写入 4 条', 'On demand: $1.25 per million writes and $0.25 per million reads; 25 GB of storage free. A post view reads 2 items; a reaction writes about 4'), num('$0')],
    [t('DynamoDB 备份', 'DynamoDB backups'), t('时间点恢复：表数据每 GB 每月 $0.20；每篇文章只有几 KB', 'Point-in-time recovery: $0.20 per GB-month of table data; posts are a few KB each'), num('< $0.01')],
    [t('Parameter Store 和 KMS', 'Parameter Store and KMS'), t('标准参数免费；AWS 托管密钥解密客户端密钥，每月 20,000 次请求免费', 'Standard parameters are free; the AWS-managed key decrypts the client secret, 20,000 free requests a month'), num('$0')],
    [t('CloudWatch Logs', 'CloudWatch Logs'), t('Lambda 日志保留一个月；每 GB $0.57，每月只有几 KB', 'Lambda logs kept one month; $0.57 per GB, a few KB a month'), num('$0')],
    [t('证书（ACM）和 DNS', 'Certificate (ACM) and DNS'), t('公共证书免费；指向 CloudFront 的别名记录在现有 dliu.com 区域中免费解析', 'Public certificates are free; alias records to CloudFront answer free in the existing dliu.com zone'), num('$0')],
    [t('流量日志', 'Traffic logs'), t('计入流量监控：日志每 GB $0.25', 'Billed to the traffic monitor: $0.25 per GB of log lines'), num('< $0.01')],
  ]));
  root.append(callout('power', t('没有 EC2、容器、负载均衡器、文件系统、NAT 网关或数据库服务器，所以不会因为“存在”而花钱。不存图片时，账单实际上是 $0。', 'There is no EC2, container, load balancer, file system, NAT gateway or database server, so nothing costs money just by existing. With no pictures stored, the bill is effectively $0.')));

  add('h2', t('与 WordPress 对比', 'Compared with WordPress'));
  add('p', t('之前的博客在 ECS 容器主机上运行 WordPress Docker 镜像，用 EFS 文件系统存上传文件，再加一个 MySQL 数据库。无论有没有人访问，容器都全天运行，所以大部分费用花在空转上。新博客保留了同样的写作流程，只在有人阅读或写作时付费。', 'The previous blog ran the WordPress Docker image on an ECS container host, with an EFS file system for uploads and a MySQL database. The container ran around the clock whether anyone visited or not, so most of the bill paid for idle time. The new blog keeps the same writing workflow and pays only when someone reads or writes.'));
  root.append(table(['', t('ECS 上的 WordPress', 'WordPress on ECS'), t('无服务器博客', 'Serverless blog')], [
    [t('空闲时的计算', 'Compute while idle'), t('全天候运行的 WordPress 容器', 'A WordPress container running 24/7'), num('$0')],
    [t('存储', 'Storage'), t('EFS 存放上传文件、主题和插件', 'EFS for uploads, themes and plugins'), t('S3 存放图片和文件', 'S3 for pictures and files')],
    [t('阅读文章', 'Reading a post'), t('PHP 渲染页面并查询 MySQL', 'PHP renders the page, queries MySQL'), t('CloudFront 直接提供文件', 'CloudFront serves files')],
    [t('打补丁', 'Patching'), t('WordPress、插件、PHP、MySQL、主机', 'WordPress, plugins, PHP, MySQL, the host'), t('只有 AWS 托管的运行时', 'AWS-managed runtime only')],
  ]));

  add('h2', t('示例', 'Examples'));
  root.append(table([t('情况', 'Situation'), t('估算', 'Estimate')], [
    [t('一个月没人写作', 'A month with nobody writing'), num(t('$0 + 存储费', '$0 + storage'))],
    [t('存了 500 MB 图片', '500 MB of pictures stored'), num(t('≈ $0.01 / 月', '≈ $0.01 / month'))],
    [t('写并发布一篇带 10 张图片的文章（约 30 次 API 调用）', 'Writing and publishing a post with 10 pictures (about 30 API calls)'), num('< $0.0001')],
    [t('每月 10,000 次页面浏览', '10,000 page views a month'), num(t('免费额度内 $0', '$0 in the free tier'))],
    [t('每月 1,000 次心情', '1,000 reactions a month'), num('≈ $0.005')],
  ]));

  root.append(flow({
    title: t('账单为什么小', 'What keeps the bill small'),
    steps: [
      { icon: 'power', title: t('没有空转的服务器', 'No idle servers'), text: t('Lambda 只在被调用时运行', 'The Lambda runs only when called') },
      { icon: 'page', title: t('读者看到的是静态文件', 'Static for readers'), text: t('已发布文章是发布时写出的文件；只有心情需要 Lambda', 'Published posts are files written on publish; only reactions need the Lambda') },
      { icon: 'upload', title: t('直接上传', 'Direct uploads'), text: t('文件从浏览器直接传到 S3，不经过 Lambda', 'Files go from the browser to S3, not through Lambda') },
      { icon: 'clock', title: t('清理', 'Clean-up'), text: t('未保存的上传一天后删除', 'Unsaved uploads are deleted after a day') },
    ],
  }));

  add('p', t('价格于 2026 年 10 月按 eu-west-1 核对（不含增值税）。AWS 可能调整价格；见 aws.amazon.com/pricing。', 'Prices checked in October 2026 for eu-west-1 (excluding VAT). AWS may change them; see aws.amazon.com/pricing.'), 'dg-note');
  source(root, t('源码：dliu-com/blog（lib/blog-stack.ts、lambda/api/s3.js）。', 'Source: dliu-com/blog (lib/blog-stack.ts, lambda/api/s3.js).'));
}

// ---------------------------------------------------------------- Security
function security(root) {
  const LOW = { text: t('低', 'Low'), className: 'risk-low' };
  const MEDIUM = { text: t('中', 'Medium'), className: 'risk-medium' };
  const add = writer(root);

  root.append(stats([
    [t('1 位作者', '1 author'), t('只有 dliu.com 的 Microsoft 账号能写作', 'only dliu.com Microsoft accounts can write'), 'entra'],
    [t('0 个公开存储桶', '0 public buckets'), t('S3 只能通过 CloudFront 访问', 'S3 is reachable only through CloudFront'), 'lock'],
    [t('按权限授权', 'Scoped API'), t('Microsoft API 需要已分配的用户和该路由的确切权限', 'the Microsoft API needs an assigned user and the route’s exact permission'), 'key'],
    [t('草稿私密', 'Drafts private'), t('草稿内容从不离开 DynamoDB', 'draft text never leaves DynamoDB'), 'eye'],
  ]));

  add('h2', t('谁能做什么', 'Who can do what'));
  root.append(table([t('谁', 'Who'), t('能做什么', 'Can'), t('如何保证', 'How it is enforced')], [
    [t('任何人', 'Anyone'), t('阅读已发布的文章、图片和文件', 'Read published posts, pictures and files'), t('CloudFront 只读地提供 content/ 和 media/', 'CloudFront serves content/ and media/ read-only')],
    [t('任何读者', 'Any reader'), t('每篇已发布文章一个心情，可随时更改或取消；查看计数', 'One reaction per published post, changed or removed at will; see the counts'), t('以 dl_vid 访客 Cookie 区分；每个 IP 每小时最多 60 次；只接受同站请求', 'Keyed by the dl_vid visitor cookie; at most 60 reactions an hour per IP address; same-site requests only')],
    [t('已登录的 dliu.com 账号', 'Signed-in dliu.com account'), t('撰写、发布、撤回和删除文章；上传文件', 'Write, publish, unpublish and delete posts; upload files'), t('每次 API 调用都检查会话 Cookie', 'Session cookie checked on every API call')],
    [t('带作者 Microsoft 访问令牌的程序', 'An app with the author’s Microsoft access token'), t('blog.read：列出和阅读文章（包括草稿）；blog.write：创建、编辑、发布、撤回文章和上传文件；blog.delete：删除文章和文件', 'blog.read: list and read posts (drafts too); blog.write: create, edit, publish and unpublish posts and upload files; blog.delete: delete posts and files'), t('API Gateway 检查令牌和该路由的权限；Lambda 再检查租户、客户端、用户、api.access 角色和确切权限', 'API Gateway checks the token and the route’s permission; the Lambda checks tenant, client, user, the api.access role and the exact permission again')],
    [t('其他 Microsoft 账号', 'Any other Microsoft account'), t('和普通读者一样', 'Nothing more than a reader'), t('登录后被拒绝：租户或域名不符', 'Refused after sign-in: wrong tenant or domain')],
  ]));

  add('h2', t('登录', 'Signing in'));
  root.append(flow({
    title: t('Microsoft 登录（OpenID Connect）', 'Microsoft sign-in (OpenID Connect)'),
    numbered: true,
    steps: [
      { icon: 'browser', title: t('登录', 'Sign in'), text: t('/auth/login 带着 state、nonce 和 PKCE 把浏览器转到 Microsoft', '/auth/login sends the browser to Microsoft with state, nonce and PKCE') },
      { icon: 'entra', title: t('Microsoft', 'Microsoft'), text: t('作者登录 dliu.com 租户', 'The author signs in to the dliu.com tenant') },
      { icon: 'lambda', title: t('回调', 'Callback'), text: t('API 用授权码换取 ID 令牌，并检查签名、颁发者、租户、受众、nonce 和有效期', 'The API swaps the code for an ID token and checks its signature, issuer, tenant, audience, nonce and expiry') },
      { icon: 'cookie', title: t('会话', 'Session'), text: t('HMAC 签名的 __Host- Cookie：HttpOnly、Secure、SameSite=Lax，30 天', 'HMAC-signed __Host- cookie: HttpOnly, Secure, SameSite=Lax, 30 days') },
    ],
    note: t('客户端密钥以 SecureString 存在 Parameter Store；会话密钥由它派生，所以轮换密钥会让所有人退出登录。', 'The client secret is a SecureString in Parameter Store; the session key is derived from it, so rotating the secret signs everyone out.'),
  }));

  add('h2', t('Microsoft API', 'Microsoft API'));
  add('p', t('助手和脚本使用单独的 Microsoft API（API Gateway HTTP API）。令牌由 Microsoft Entra 签发，通过 auth.dliu.com 取得；博客不签发也不保存令牌。', 'Agents and scripts use a separate Microsoft API (an API Gateway HTTP API). Tokens are issued by Microsoft Entra and obtained through auth.dliu.com; the blog neither issues nor stores them.'));
  root.append(table([t('方面', 'Area'), t('措施', 'Control')], [
    [t('令牌', 'Tokens'), t('dliu.com 租户的 Microsoft 访问令牌（v2），受众是 dliu API 应用，由 auth.dliu.com 控制台为本人取得', 'Microsoft access tokens (v2) from the dliu.com tenant for the dliu API app, obtained by the user on the auth.dliu.com console')],
    [t('网关检查', 'Gateway checks'), t('JWT 授权方检查 Microsoft 签名、颁发者、受众、有效期，以及该路由需要的 blog.read、blog.write 或 blog.delete 权限；不通过时 Lambda 不会运行', 'The JWT authorizer checks Microsoft’s signature, issuer, audience, expiry and the blog.read, blog.write or blog.delete permission the route needs; the Lambda never runs otherwise')],
    [t('Lambda 检查', 'Lambda checks'), t('请求必须来自这个 API，令牌必须是 v2、来自正确的租户、受众和客户端应用，带有用户 ID、api.access 角色和确切权限', 'The request must come from this API, and the token must be v2, from the right tenant, audience and client app, with a user ID, the api.access role and the exact permission')],
    [t('用户', 'Users'), t('api.access（dliu API user）是所有 dliu.com API 共用的一个只能分配给用户的应用角色；只有被分配的账号能使用这个 API（组织里的其他账号仍可登录网站，但没有 API 权限），在这里能做什么仍由 blog.* 权限决定', 'api.access (dliu API user) is one app role for users only, shared by all dliu.com APIs; only the account assigned it can use this API (other organisation accounts keep website sign-in only), and the blog.* permissions still decide what a token can do here')],
    [t('路由', 'Routes'), t('只有九个文章和文件路由；心情、登录和网站页面不在这个 API 上。删除需要单独的 blog.delete 权限', 'Only nine post and file routes; reactions, sign-in and site pages are not on this API. Deleting needs the separate blog.delete permission')],
    [t('不混用', 'No fallback'), t('Microsoft API 从不读取 Cookie；网站的 /api/* 从不读取持有者令牌', 'The Microsoft API never reads cookies; the website’s /api/* never reads bearer tokens')],
    [t('审计', 'Audit'), t('通过 Microsoft API 保存的文章在 updatedVia 中记为 “Microsoft API”；不记录 Authorization 请求头或完整请求', 'Posts saved through the Microsoft API record “Microsoft API” in updatedVia; the Authorization header and full requests are never logged')],
    [t('旧令牌', 'Old tokens'), t('以前的 blog_… API 令牌不再被接受，/admin/tokens 已移除；它们的表被保留（未使用），不删除历史数据', 'The former blog_… API tokens are no longer accepted and /admin/tokens is gone; their table is retained, unused, so no history is deleted')],
  ]));

  add('h2', t('防护措施', 'Controls'));
  root.append(table([t('方面', 'Area'), t('措施', 'Control')], [
    [t('账号', 'Accounts'), t('单租户 Entra 应用；只接受以 @dliu.com 结尾的账号', 'Single-tenant Entra app; only accounts ending in @dliu.com are accepted')],
    [t('跨站请求', 'Cross-site requests'), t('用会话 Cookie 做的每项改动都必须来自 https://blog.dliu.com（检查 Origin），且 Cookie 为 SameSite=Lax。Microsoft API 是另一个源，不允许 CORS，需要浏览器从不自动添加的持有者令牌', 'Every change made with the session cookie must come from https://blog.dliu.com (Origin check) and the cookie is SameSite=Lax. The Microsoft API is another origin with no CORS, and needs a bearer token that browsers never add on their own')],
    [t('源站', 'Origins'), t('两个存储桶和 Lambda 函数 URL 都只接受经源站访问控制签名的 CloudFront 请求', 'Both buckets and the Lambda Function URL accept only CloudFront, signed with origin access control')],
    [t('存储桶', 'Buckets'), t('阻止所有公开访问，S3 托管加密，只允许 HTTPS', 'Block all public access, S3-managed encryption, HTTPS only')],
    [t('上传', 'Uploads'), t('预签名 PUT 地址 15 分钟有效，大小和类型固定，每个文件最多 100 MB，每篇文章最多 100 个文件', 'Presigned PUT URLs valid 15 minutes, fixed size and type, at most 100 MB a file and 100 files a post')],
    [t('文件类型', 'File types'), t('只有图片、PDF、纯文本、音频和视频会在浏览器中打开；其他文件（包括 HTML 和 SVG）一律下载', 'Only pictures, PDF, plain text, audio and video open in the browser; anything else (including HTML and SVG) downloads')],
    [t('文章正文', 'Post text'), t('渲染 Markdown 时不允许原始 HTML；链接和图片必须是 http(s)、mailto 或本站地址；视频只能来自 video.dliu.com，并根据视频 ID 重新生成', 'Markdown is rendered without raw HTML; links and pictures must be http(s), mailto or same-site; videos only from video.dliu.com, rebuilt from the video ID')],
    [t('响应头', 'Headers'), t('Content-Security-Policy（脚本只能来自本站和流量监控，样式只能来自本站，框架只能来自 video.dliu.com）、HSTS、X-Frame-Options DENY、nosniff、严格的 Referrer 策略', 'Content-Security-Policy (scripts from the site and the traffic monitor only, styles from the site only, frames from video.dliu.com only), HSTS, X-Frame-Options DENY, nosniff, strict referrer')],
    [t('数据', 'Data'), t('DynamoDB 开启删除保护、时间点恢复，删除堆栈时保留', 'DynamoDB with deletion protection, point-in-time recovery and retain-on-delete')],
    [t('Lambda', 'Lambda'), t('预留并发 10，防止费用失控；日志保留一个月', 'Reserved concurrency of 10 caps runaway cost; logs kept one month')],
    [t('心情', 'Reactions'), t('只接受同站 JSON POST；四种取值之一；只限已发布文章；每个 IP 每小时 60 次，IP 取自 CloudFront 看到的连接（查看器函数会覆盖 x-blog-viewer，客户端无法伪造）；IP 只以哈希形式保存两小时', 'Same-site JSON POST only; one of four values; published posts only; 60 an hour per IP, taken from CloudFront’s view of the connection (the viewer function overwrites x-blog-viewer, so clients can’t choose it); IPs kept only as hashes for two hours')],
  ]));
  root.append(callout('shield', t('草稿和未发布文章的正文只存在读者无法访问的 DynamoDB 中；只有发布这一步会把它复制到公开存储桶。草稿的附件已经在 /media 下，但地址带有随机的 16 位 ID，在文章发布前不会出现在任何列表中。', 'The text of drafts and unpublished posts exists only in DynamoDB, which readers cannot reach; publishing is the only step that copies it to the public bucket. Files attached to a draft are already under /media, at addresses with a random 16-character ID that are not listed anywhere until the post is published.')));

  add('h2', t('威胁模型', 'Threat model'));
  add('p', t('可能出什么问题、靠什么阻止，以及还剩多少风险。这里假设攻击者读过源码，因为源码公开在 GitHub 上。最大的风险来自 API 的 Microsoft 访问令牌：在它过期之前，持有带 blog.write 权限令牌的人可以以作者身份发布。', 'What could go wrong, what stops it, and how much risk is left. It assumes the attacker has read the source code, which is public on GitHub. The biggest risk is a Microsoft access token for the API: until it expires, whoever holds one with blog.write can publish as the author.'));
  root.append(table([t('场景', 'Scenario'), t('剩余风险', 'Residual risk'), t('防护措施', 'Controls')], [
    [t('Microsoft 访问令牌从助手的电脑、聊天记录或脚本中泄露', 'A Microsoft access token leaks from the agent’s computer, chat history or a script'), MEDIUM, t('令牌大约一小时后过期；只有其中的权限可用（没有 blog.delete 就不能删除）；取消用户的 api.access 分配可阻止新令牌。按 Auth 指南保存，不放进聊天或输出。过期之前，持有者可以做权限允许的一切', 'Tokens expire after about an hour; only their permissions work (no deleting without blog.delete); removing the user’s api.access assignment stops new ones. Kept as the Auth guide says, never in chat or output. Until it expires, the holder can do whatever its permissions allow')],
    [t('被提示注入或理解错误的助手发布了不想要的内容，或覆盖了作者的修改', 'A prompt-injected or confused agent publishes unwanted text or overwrites the author’s edits'), MEDIUM, t('助手被告知除非要求发布，否则只保存草稿，并在编辑前先读取文章；没有 blog.delete 就不能删除；updatedVia 显示 “Microsoft API”；时间点恢复可以还原整张表。编辑没有版本检查，最后一次保存为准', 'Agents are told to save drafts unless asked to publish and to read a post before editing it; nothing can be deleted without blog.delete; updatedVia shows “Microsoft API”; point-in-time recovery restores the table. Edits have no version check, so the last save wins')],
    [t('以同一用户身份运行的其他软件读取保存的令牌', 'Other software running as the same user reads the saved token'), MEDIUM, t('和 ~/.aws/credentials 的风险相同：文件权限挡得住其他用户，挡不住本人的进程。令牌很快过期；按 auth.dliu.com/docs/api 保存', 'Same exposure as ~/.aws/credentials: file permissions stop other users, not the owner’s own processes. The token expires soon; store it as auth.dliu.com/docs/api says')],
    [t('用泄露的令牌上传大量文件塞满存储桶', 'A leaked token is used to fill the bucket with uploads'), LOW, t('每个文件最多 100 MB，每篇文章最多 100 个文件；未保存的上传一天后删除；令牌过期后无法再上传；S3 存储约每 GB 每月 $0.023', 'Uploads are capped at 100 MB a file and 100 files a post; unsaved uploads are deleted after a day; uploads stop when the token expires; S3 storage costs about $0.023 per GB-month')],
    [t('有人伪造令牌，或使用给其他应用、租户或网站的令牌', 'Someone forges a token, or uses one meant for another app, tenant or site'), LOW, t('API Gateway 检查 Microsoft 签名、颁发者、受众、有效期和权限；Lambda 再检查 API ID、租户、客户端、用户和 api.access 角色。不符时返回 401 或 403，绝不退回使用 Cookie', 'API Gateway checks Microsoft’s signature, issuer, audience, expiry and permission; the Lambda checks the API ID, tenant, client, user and api.access role. A mismatch gets 401 or 403 and never falls back to the cookie')],
    [t('把持有者令牌发到网站的 /api/*，或在 Microsoft API 上调用其他路由', 'A bearer token is sent to the website’s /api/*, or another route is called on the Microsoft API'), LOW, t('网站只认会话 Cookie，持有者令牌会被忽略（CloudFront 本来就会替换 Authorization）。Microsoft API 只有九个路由，Lambda 也拒绝 routes.json 之外的路由', 'The website knows only the session cookie, so a bearer token is ignored (CloudFront replaces Authorization anyway). The Microsoft API has only nine routes, and the Lambda also refuses any route not in routes.json')],
    [t('恶意网站让作者的浏览器修改文章（CSRF）', 'A malicious site makes the author’s browser change posts (CSRF)'), LOW, t('检查 Origin，Cookie 为 SameSite=Lax；Microsoft API 不读 Cookie，也不允许 CORS', 'Origin check and SameSite=Lax cookie; the Microsoft API reads no cookies and allows no CORS')],
    [t('从流量日志中读取会话 Cookie', 'The session cookie is read from the traffic logs'), LOW, t('CloudFront 会记录整个 Cookie 请求头（为了访客 ID）。流量监控在归档每份日志前只保留访客 ID，并于 2026 年 10 月 28 日从已保存的日志中删除了会话 Cookie；在此之前的会话都已结束。未处理的文件只在私有存储桶中存在几秒', 'CloudFront logs the whole Cookie header (for the visitor ID). The traffic monitor keeps only the visitor ID before filing each log, and on 28 October 2026 it removed the session cookies from the logs it had already kept; sessions from before then were ended. The unprocessed file lasts seconds in a private bucket')],
    [t('会话 Cookie 被盗或被伪造', 'A stolen or forged session cookie'), LOW, t('用 Parameter Store 中的密钥做 HMAC 签名，恒定时间比较；HttpOnly、Secure、__Host- 前缀；30 天过期；轮换客户端密钥会让所有人退出登录', 'HMAC-signed with a key from Parameter Store, compared in constant time; HttpOnly, Secure, __Host- prefix; expires in 30 days; rotating the client secret signs everyone out')],
    [t('读过公开源码的人把 /auth/login 发给任何人的登录 Cookie 当作会话 Cookie 重放', 'Someone who has read the public source replays the sign-in cookie that /auth/login gives anyone as a session cookie'), LOW, t('2026 年 10 月 28 日渗透测试后已修复。登录 Cookie 和会话 Cookie 现在用不同的密钥签名，并带有会被检查的类型；会话必须指明用户。修复前的所有会话都已结束。测试会重放登录 Cookie 和其他伪造内容', 'Fixed on 28 October 2026 after a penetration test. Sign-in and session cookies are now signed with different keys and carry a type that is checked; a session must name a user. Every session from before the fix was ended. Tests replay the sign-in cookie and other forged payloads')],
    [t('登录被篡改：伪造回调、窃取授权码或开放重定向', 'Sign-in is tampered with: forged callback, stolen code or open redirect'), LOW, t('state、nonce 和 PKCE；检查 ID 令牌的签名、颁发者、租户和受众；返回路径必须在本站', 'state, nonce and PKCE; ID token signature, issuer, tenant and audience checked; return paths must be on this site')],
    [t('文章或上传文件在读者浏览器中运行脚本（存储型 XSS）', 'A post or upload runs script in readers’ browsers (stored XSS)'), LOW, t('用 DOM 方法渲染 Markdown，不允许原始 HTML；只允许安全的链接协议；CSP 只允许本站和 traffic.dliu.com 的脚本；HTML 和 SVG 上传文件一律下载而不打开', 'Markdown rendered with DOM methods and no raw HTML; safe link schemes only; CSP allows scripts from the site and traffic.dliu.com only; HTML and SVG uploads download instead of opening')],
    [t('助手在文章中放入其他网站的图片来追踪读者', 'An agent puts a picture from another site in a post to track readers'), LOW, t('图片可以来自任何 https 地址，那个网站会看到读者的 IP 地址；发布前请审阅助手写的文章', 'Pictures may come from any https address, so that site sees readers’ IP addresses; review agent posts before publishing')],
    [t('文章嵌入的播放器行为异常或加载其他网站', 'A post embeds a player that misbehaves or loads another site'), LOW, t('只有作者自己的网站 video.dliu.com 可以被嵌入（CSP frame-src）。播放器地址根据 10 位视频 ID 和少数经过检查的选项重新生成；粘贴的嵌入代码中的其他内容一概不用', 'Only video.dliu.com, the owner’s own site, can be framed (CSP frame-src). The player address is rebuilt from a 10-digit video ID and a few checked options; nothing else from a pasted embed code is used')],
    [t('作者页面被嵌入框架，诱骗作者点击（点击劫持）', 'The author’s pages are framed to trick the author into clicking (clickjacking)'), LOW, t('X-Frame-Options DENY 和 CSP frame-ancestors none', 'X-Frame-Options DENY and CSP frame-ancestors none')],
    [t('读者大量请求文章页以耗尽 Lambda，或污染缓存的分享预览', 'Readers flood post pages to use up the Lambda, or poison a cached share preview'), LOW, t('CloudFront 把每篇文章页缓存五分钟，Lambda 出错时返回普通页面，所以文章始终可读。缓存键是只有查看器函数会设置的文章 ID 请求头；读者发送的会被丢弃。只有已发布文章才有分享标签，由转义后的标题、摘要和文章自己的图片生成', 'CloudFront caches each post page for five minutes, and serves the plain page if the Lambda fails, so posts stay readable. The page is keyed by a post-ID header that only the viewer function sets; one sent by a reader is dropped. Only published posts get tags, built from their escaped title, excerpt and own picture')],
    [t('有人直接调用 Lambda URL 或存储桶', 'Someone calls the Lambda URL or the buckets directly'), LOW, t('源站访问控制：它们只接受这个 CloudFront 分发签名的请求', 'Origin access control: they accept only requests signed by this CloudFront distribution')],
    [t('大量 API 请求推高账单', 'A flood of API requests runs up the bill'), LOW, t('预留并发 10；API Gateway 在 Lambda 运行前拒绝无效的 Microsoft 令牌；心情每个 IP 每小时限 60 次', 'Reserved concurrency of 10; API Gateway refuses bad Microsoft tokens before the Lambda runs; reactions are limited to 60 an hour per IP')],
    [t('有人通过清除 Cookie 或伪造访客 ID 刷心情计数', 'Someone inflates reaction counts by clearing cookies or forging visitor IDs'), MEDIUM, t('每个 dl_vid 一个心情，但任何人都能丢弃或捏造这个 Cookie，所以真正的上限是每个 IP 每小时 60 次；很多 IP（僵尸网络或切换网络）仍然可以刷更多。计数只是图个乐，不带来任何权限；作者可以删除文章以删除其心情，或直接编辑表', 'One reaction per dl_vid, but anyone can drop or invent the cookie, so the 60-an-hour limit per IP is the real cap; many IPs (a botnet, or switching networks) can still add more. Counts are for fun and grant nothing; the author can delete the post’s reactions by deleting it, or edit the table')],
    [t('有人修改其他读者的心情', 'Someone changes another reader’s reaction'), LOW, t('只有知道那位读者的 dl_vid 才行，而它是 HttpOnly 的随机值，只通过 HTTPS 发送给 dliu.com。流量监控用 Math.random 生成这些 ID，所以算不上密钥级别；最坏结果是心情被改', 'Only by knowing that reader’s dl_vid, which is HttpOnly, random and sent only to dliu.com over HTTPS. The traffic monitor makes these IDs with Math.random, so they are not secret-grade; the worst outcome is a changed reaction')],
    [t('心情被用来追踪读者', 'Reactions are used to track readers'), LOW, t('心情和读者的 dl_vid 一起保存，而流量监控本来就会把它和读者的访问关联起来；不保存姓名、邮箱或 IP。点心情是自愿的', 'A reaction is stored with the reader’s dl_vid, which the traffic monitor already links to their visits; no name, email or IP is kept. Reacting is optional')],
    [t('心情请求耗尽作者需要的 Lambda', 'Reaction traffic uses up the Lambda the author needs'), LOW, t('预留并发 10 是共用的；心情计数在文章之后加载，如果 Lambda 繁忙，按钮就不显示，文章照常可读。作者的请求会重试', 'Reserved concurrency of 10 is shared; reaction counts are loaded after the post, and if the Lambda is busy the buttons stay hidden while the post still reads normally. Author requests retry')],
    [t('密钥通过源码泄露', 'Secrets leak through the source code'), LOW, t('源码是公开的，所以安全不依赖隐藏源码。Microsoft 客户端密钥以 SecureString 存在 Parameter Store；博客不保存 API 令牌，租户和应用 ID 不是秘密', 'The source is public, so security does not rely on hiding it. The Microsoft client secret is a SecureString in Parameter Store; the blog stores no API tokens, and the tenant and app IDs are not secrets')],
    [t('草稿在发布前被看到', 'A draft is seen before publishing'), LOW, t('草稿正文留在 DynamoDB；草稿文件位于随机、未列出的网址', 'Draft text stays in DynamoDB; draft files are at random, unlisted URLs')],
  ]));

  add('h2', t('接受的剩余风险', 'Accepted residual risks'));
  root.append(list([
    t('没有 WAF；只有心情有按客户端的限流，Lambda 预留并发是最后防线。', 'No WAF; the only per-client rate limit is for reactions, and reserved Lambda concurrency is the backstop.'),
    t('心情计数可以从很多 IP 地址刷高；它不能证明任何事情。', 'Reaction counts can be inflated from many IP addresses; they are not proof of anything.'),
    t('会话无法单独撤销；轮换客户端密钥会结束所有会话。', 'Sessions cannot be revoked one by one; rotating the client secret ends all of them.'),
    t('Microsoft 访问令牌在过期（约一小时）前不能单独撤销；取消用户的 api.access 分配可阻止新令牌。', 'A Microsoft access token cannot be revoked on its own before it expires (about an hour); removing the user’s api.access assignment stops new ones.'),
    t('有 blog.read 的令牌能读取所有草稿，有 blog.write 的能发布；没有只能写草稿的权限。', 'A token with blog.read can read every draft, and one with blog.write can publish; there is no draft-only permission.'),
    t('没有按调用者的上传配额，助手的文章上线前也没有审批步骤。', 'There is no per-caller upload quota or approval step before an agent’s post goes live.'),
    t('旧令牌表被保留但不再使用；过期的旧令牌记录仍会按原有的 TTL 自动删除。', 'The old token table is kept but unused; expired old token records are still removed by its existing TTL.'),
    t('删除的图片约两分钟内从 CloudFront 清除，但已经显示过它的浏览器可能最多保留一天。', 'A deleted picture leaves CloudFront within about two minutes, but a browser that already showed it may keep it for up to a day.'),
    t('超出免费额度的大量阅读流量会计费；页面在边缘缓存，但每次浏览文章还会从 Lambda 加载心情。', 'Heavy reader traffic beyond the free tier is billed; pages are cached at the edge, but each post view also loads its reactions from the Lambda.'),
  ]));

  source(root, t('源码：dliu-com/blog（lambda/api/auth.js、lambda/api/index.js、lambda/api/api-access.js、lambda/api/routes.json、lambda/api/reactions.js、lambda/api/s3.js、functions/viewer-request.js、web/markdown.js、lib/blog-stack.ts）。', 'Source: dliu-com/blog (lambda/api/auth.js, lambda/api/index.js, lambda/api/api-access.js, lambda/api/routes.json, lambda/api/reactions.js, lambda/api/s3.js, functions/viewer-request.js, web/markdown.js, lib/blog-stack.ts).'));
}

// Each article starts with its heading and lead from docs.html (translated by i18n.js); the rest is drawn here.
const PAGES = { architecture, cost, security };
const kept = Object.fromEntries(TABS.map((id) => [id, document.getElementById(id).children.length]));
function draw() {
  renderNav();
  for (const id of TABS) {
    const root = document.getElementById(id);
    while (root.children.length > kept[id]) root.lastElementChild.remove();
    PAGES[id](root);
  }
}
draw();

function show(scroll) {
  const current = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : TABS[0];
  for (const id of TABS) document.getElementById(id).hidden = id !== current;
  for (const tab of document.querySelectorAll('.info-tabs a')) {
    if (tab.dataset.tab === current) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  document.title = `${TITLES[current]()} · ${t('文档', 'Docs')} · ${t('DL 博客', 'DL blog')}`;
  if (scroll) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => show(true));
window.addEventListener('blog-language-change', () => { draw(); show(false); });
show(false);
