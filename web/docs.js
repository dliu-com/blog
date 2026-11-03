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
    [t('2 张表', '2 tables'), t('DynamoDB 保存文章、草稿和心情', 'DynamoDB holds posts, drafts and reactions'), 'dynamodb'],
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
    [t('CloudWatch Logs', 'CloudWatch Logs'), t('Lambda 日志保留三个月（90 天）；每 GB $0.57，每月只有几 KB', 'Lambda logs kept three months (90 days); $0.57 per GB, a few KB a month'), num('$0')],
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
    [t('旧令牌', 'Old tokens'), t('以前的 blog_… API 令牌不再被接受；/admin/tokens 和它们的表都已删除', 'The former blog_… API tokens are no longer accepted; /admin/tokens and their table have been deleted')],
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
    [t('Lambda', 'Lambda'), t('预留并发 10，防止费用失控；日志保留 90 天；只能读写所需的 S3 前缀（pending/、media/、content/ 和网站的 index.html）', 'Reserved concurrency of 10 caps runaway cost; logs kept 90 days; S3 access limited to the prefixes it needs (pending/, media/, content/ and the site’s index.html)')],
    [t('Microsoft API 限流', 'Microsoft API throttling'), t('整个 API 每秒最多 10 次请求，突发 20 次；超出的请求在 Lambda 运行前就收到 429，所以泄露的令牌占不满网站共用的 Lambda', 'At most 10 requests a second for the whole API, bursts of 20; anything more gets 429 before the Lambda runs, so a leaked token can’t take over the Lambda the website shares')],
    [t('心情', 'Reactions'), t('只接受同站 JSON POST；四种取值之一；只限已发布文章；每个 IP 每小时 60 次，IP 取自 CloudFront 看到的连接（查看器函数会覆盖 x-blog-viewer，客户端无法伪造）；IP 只以哈希形式保存两小时', 'Same-site JSON POST only; one of four values; published posts only; 60 an hour per IP, taken from CloudFront’s view of the connection (the viewer function overwrites x-blog-viewer, so clients can’t choose it); IPs kept only as hashes for two hours')],
  ]));
  root.append(callout('shield', t('草稿和未发布文章的正文只存在读者无法访问的 DynamoDB 中；只有发布这一步会把它复制到公开存储桶。草稿的附件已经在 /media 下，但地址带有随机的 16 位 ID，在文章发布前不会出现在任何列表中。', 'The text of drafts and unpublished posts exists only in DynamoDB, which readers cannot reach; publishing is the only step that copies it to the public bucket. Files attached to a draft are already under /media, at addresses with a random 16-character ID that are not listed anywhere until the post is published.')));

  add('h2', t('线上渗透测试', 'Live penetration test'));
  add('p', t('2026 年 11 月 3 日用 openssl 和代码库中的 scripts/pentest.mjs（181 项检查，任何人都可以用 node scripts/pentest.mjs 重新运行，不需要凭据；加上 CHECK_AWS=1 会多一项，用只读的 AWS CLI 读取限流配置）针对 https://blog.dliu.com 运行。第二轮更深入的检查发现了三个问题（见下面的代码审查），都已修复并重新测试；现在全部通过。测试没有使用真实的会话或令牌，所以登录之后的行为由单元测试（npm test）覆盖。限流测试用掉了测试者 IP 当个小时的额度；发送的都是空心情，不保存任何内容，所以计数没有变化。', 'Run on 3 November 2026 against https://blog.dliu.com with openssl and scripts/pentest.mjs from the repo (181 checks; anyone can rerun it with node scripts/pentest.mjs, no credentials needed; CHECK_AWS=1 adds one more that reads the throttling setting with the read-only AWS CLI). A second, deeper round found three issues (see Code review below); all were fixed and retested, and everything now passes. No real session or token was used, so what happens after signing in is covered by the unit tests (npm test). The rate-limit test used up the tester’s IP allowance for that hour; it sent empty reactions, which store nothing, so no counts changed.'));
  const PASS = { text: t('✓ 通过 · 2026-11-03', '✓ Pass · 2026-11-03'), className: 'status' };
  root.append(table([t('测试', 'Test'), t('预期结果', 'Expected'), t('实际结果', 'Actual result'), t('状态', 'Status')], [
    [t('HTTP 降级', 'HTTP downgrade'), t('http:// 跳转到 https://；HSTS 一年', 'http:// redirects to https://; HSTS for a year'), t('301 到 https://blog.dliu.com/；max-age=31536000', '301 to https://blog.dliu.com/; max-age=31536000'), PASS],
    [t('旧版 TLS', 'Old TLS versions'), t('拒绝 TLS 1.0 和 1.1', 'TLS 1.0 and 1.1 refused'), t('两者都收到 protocol_version 警报；TLS 1.2 和 1.3 正常', 'Both get a protocol_version alert; TLS 1.2 and 1.3 work'), PASS],
    [t('安全响应头', 'Security headers'), t('每个响应都有 CSP、HSTS、X-Frame-Options DENY、nosniff 和 Permissions-Policy', 'CSP, HSTS, X-Frame-Options DENY, nosniff and Permissions-Policy on every response'), t('首页、文章、/admin、/docs、/docs/api、content/index.json 和 /api/me 都有；脚本只允许本站和 traffic.dliu.com', 'Present on the home page, a post, /admin, /docs, /docs/api, content/index.json and /api/me; scripts only from the site and traffic.dliu.com'), PASS],
    [t('隐藏文件和目录列表', 'Hidden files and listings'), t('拒绝', 'Refused'), t('/.git/config、/.env、package.json、cdk.json、Lambda 源码、content/、media/、pending/ 和未发布文章的 JSON 都返回 403', '/.git/config, /.env, package.json, cdk.json, the Lambda source, content/, media/, pending/ and an unpublished post’s JSON all return 403'), PASS],
    [t('对页面和文件使用其他 HTTP 方法', 'Other HTTP methods on pages and files'), t('拒绝', 'Refused'), t('对页面、content/ 和 media/ 的 POST、PUT、DELETE 和 PATCH 返回 403', 'POST, PUT, DELETE and PATCH on pages, content/ and media/ return 403'), PASS],
    [t('无会话调用网站 API', 'Website API without a session'), t('/api/me 显示未登录；其他调用返回 401', '/api/me says signed out; everything else 401'), t('列出、读取、创建、编辑、删除文章，上传文件和查看谁点了心情都返回 401', 'Listing, reading, creating, editing and deleting posts, uploading and the who-reacted list all return 401'), PASS],
    [t('伪造会话', 'Forged sessions'), t('不被当作已登录', 'Never treated as signed in'), t('随机值、未签名、签名错误、重放的登录 Cookie、被改过的登录 Cookie 和过期内容：全部未登录并返回 401', 'Random, unsigned, wrong signature, a replayed sign-in cookie, an edited sign-in cookie and an expired payload: all signed out and 401'), PASS],
    [t('向网站发送令牌', 'Tokens sent to the website'), t('被忽略', 'Ignored'), t('Authorization 持有者令牌和旧博客令牌的请求头都返回 401', 'An Authorization bearer token and the old blog-token header both get 401'), PASS],
    [t('开始登录', 'Starting sign-in'), t('只去 Microsoft，带 PKCE、state 和 nonce；登录 Cookie 受保护', 'Goes only to Microsoft, with PKCE, state and nonce; the sign-in cookie is protected'), t('302 到 login.microsoftonline.com，PKCE S256，固定的回调地址；__Host- Cookie：HttpOnly、Secure、SameSite=Lax、10 分钟；POST 返回 405', '302 to login.microsoftonline.com, PKCE S256, fixed callback address; __Host- cookie: HttpOnly, Secure, SameSite=Lax, 10 minutes; POST gets 405'), PASS],
    [t('登录回调', 'Sign-in callback'), t('拒绝，不给会话', 'Refused, no session'), t('缺少、伪造或不匹配的 state 返回 400；Microsoft 返回错误时 401；都不设置会话 Cookie', 'Missing, forged or mismatched state returns 400; a Microsoft error 401; no session cookie in any case'), PASS],
    [t('开放重定向', 'Open redirects'), t('只跳转到本站', 'Redirects stay on this site'), t('https://evil.example、//evil.example、/\\evil.example、编码后的斜杠、javascript:、换行和制表符作为返回地址时都回到本站；没有注入响应头', 'https://evil.example, //evil.example, /\\evil.example, encoded slashes, javascript:, line breaks and tabs as return addresses all stay on this site; no header is injected'), PASS],
    [t('心情输入', 'Reaction input'), t('只接受同站的有效请求', 'Only valid same-site requests'), t('跨站或无 Origin 返回 403；无效值、错误 JSON 和 __proto__ 返回 400；未知或未发布的文章返回 404；../ 路径被 CloudFront 拒绝；超过 300 KB 返回 413；计数不变', 'Cross-site or no Origin gets 403; invalid values, bad JSON and __proto__ 400; unknown or unpublished posts 404; ../ paths are refused by CloudFront; over 300 KB 413; counts unchanged'), PASS],
    [t('心情限流', 'Reaction rate limit'), t('每个 IP 每小时 60 次，伪造 IP 请求头无效', '60 an hour per IP, even with forged IP headers'), t('每次请求都伪造 x-blog-viewer 和 X-Forwarded-For：接受 60 次，第 61 次起返回 429', 'Forging x-blog-viewer and X-Forwarded-For on every request: 60 accepted, 429 from the 61st'), PASS],
    [t('Microsoft API 令牌', 'Microsoft API tokens'), t('Lambda 运行前被拒绝', 'Refused before the Lambda runs'), t('无令牌、乱码、alg none、伪造的 RS256 签名和只带网站 Cookie：读取和删除都返回 401', 'No token, garbage, alg none, a forged RS256 signature and the website cookie alone: 401 for reads and deletes'), PASS],
    [t('Microsoft API 其他路由和 CORS', 'Microsoft API: other routes and CORS'), t('不存在；不允许跨源', 'Not there; no cross-origin access'), t('心情、登录、网站页面和 PATCH 返回 404；来自 evil.example 的预检没有 Access-Control-Allow-Origin', 'Reactions, sign-in, site pages and PATCH return 404; a preflight from evil.example gets no Access-Control-Allow-Origin'), PASS],
    [t('绕过 CloudFront', 'Bypassing CloudFront'), t('拒绝', 'Refused'), t('直接调用 Lambda 函数 URL，以及对两个存储桶的列出、读取和写入（包括 HTTP）都返回 403', 'Calling the Lambda function URL directly, and listing, reading and writing both buckets (over HTTP too), all return 403'), PASS],
    [t('分享预览缓存投毒', 'Share-preview cache poisoning'), t('读者无法选择预览的文章', 'Readers can’t choose the previewed post'), t('读者发送的 x-blog-post 被丢弃；查询字符串不会出现在页面中', 'An x-blog-post header sent by a reader is dropped; query strings are not echoed in the page'), PASS],
    [t('旧 WordPress 链接', 'Old WordPress links'), t('跳转到正确位置，不会跳出本站', 'Go to the right place, never off the site'), t('/posts/编号、/编号/、/2025/04/、/page/2/、/wp-admin 和 /wp-login.php 跳转正确；//evil.example 之类的路径返回 403 或留在本站', '/posts/ID, /ID/, /2025/04/, /page/2/, /wp-admin and /wp-login.php redirect correctly; paths such as //evil.example return 403 or stay on the site'), PASS],
    [t('公开代码库中的机密', 'Secrets in the public repo'), t('没有机密或私人信息', 'No secrets or private details'), t('gitleaks 8.30 扫描了全部 git 历史（git log --all，36 个提交）和工作目录：只有一个误报（单元测试中的 S3 对象键，已写入 .gitleaksignore）。另外用正则表达式查找访问密钥、私钥、AWS 账户 ID 和私人邮箱：没有，只有示例占位符', 'gitleaks 8.30 over all git history (git log --all, 36 commits) and the working tree: one false positive only (an S3 object key in a unit test, listed in .gitleaksignore). A regex search for access keys, private keys, the AWS account ID and private email addresses found none, only example placeholders'), PASS],
    [t('依赖', 'Dependencies'), t('网站上没有存在已知漏洞的代码', 'No code with known vulnerabilities on the site'), t('Lambda 只使用 Node.js crypto 和运行时自带的 AWS SDK；浏览器代码没有第三方库。npm audit --omit=dev：aws-cdk-lib 中 2 个中等级别的 minimatch 问题，只在部署时运行。npm audit（含开发依赖）：另有 Jest 测试工具链中的 18 个中等、4 个低等级别问题（minimatch、deepmerge），只在本地测试时运行；没有高危或严重问题', 'The Lambda uses only Node.js crypto and the AWS SDK in the runtime; the browser code has no third-party libraries. npm audit --omit=dev: 2 moderate minimatch issues inside aws-cdk-lib, which runs only at deploy time. npm audit with dev dependencies: also 18 moderate and 4 low in the Jest test tool chain (minimatch, deepmerge), which runs only for local tests; no high or critical issues'), PASS],
    [t('每个网站 API 路由和方法', 'Every website API route and method'), t('过期或伪造的会话一律 401；未知方法被拒绝', 'An expired or forged session gets 401 everywhere; unknown methods refused'), t('九个路由（文章、文件、谁点了心情）带过期的伪造会话都返回 401；PATCH、../ 和已删除的令牌路由都被拒绝（4xx，没有堆栈信息），TRACE 返回 405', 'All nine routes (posts, files, who reacted) with an expired forged session return 401; PATCH, ../ and the deleted token route are refused (4xx, no stack trace), TRACE 405'), PASS],
    [t('Microsoft API 的全部九个路由', 'All nine Microsoft API routes'), t('网关拒绝所有无效令牌', 'The gateway refuses every invalid token'), t('alg none、用猜测的密钥做 HS256 签名、过期、受众错误（Graph）和颁发者错误的令牌：每个路由都返回 401。Lambda 内对 azp、角色和权限的检查由 api-access 单元测试覆盖', 'alg none, HS256 signed with a guessed key, expired, wrong audience (Graph) and wrong issuer: 401 on every route. The Lambda’s own azp, role and permission checks are covered by the api-access unit tests'), PASS],
    [t('Microsoft API 限流', 'Microsoft API throttling'), t('无效令牌在网关被拒绝；有效令牌整个 API 每秒最多 10 次（突发 20）', 'Bad tokens refused at the gateway; valid ones at most 10 a second for the whole API (burst 20)'), t('同时发出 60 个不带令牌的请求：全部在网关返回 401，授权方在限流计数之前就拒绝了它们，Lambda 不会运行。限流只对通过授权的令牌生效，所以用只读的 AWS CLI 确认了配置：ThrottlingRateLimit 10、ThrottlingBurstLimit 20（本轮修复前没有限流）', '60 requests at once without a token: all 401 at the gateway; the authorizer refuses them before throttling counts, and the Lambda never runs. The limit applies only to tokens that pass, so the setting was confirmed with the read-only AWS CLI: ThrottlingRateLimit 10, ThrottlingBurstLimit 20 (there was no throttling before this round’s fix)'), PASS],
    [t('缓存欺骗', 'Cache deception'), t('API 和登录响应从不被缓存', 'API and sign-in responses are never cached'), t('/api/me/x.css、/api/me;x.css、/api/posts.css、/api/posts/编号.json 和 /auth/login.css 都返回 404，第二次请求也不是缓存命中', '/api/me/x.css, /api/me;x.css, /api/posts.css, /api/posts/ID.json and /auth/login.css all return 404, and the second request is not a cache hit'), PASS],
    [t('用转发请求头投毒缓存', 'Cache poisoning with forwarding headers'), t('页面只用本站地址', 'Pages use only the site’s own address'), t('X-Forwarded-Host、X-Host、Forwarded、X-Original-URL、X-Rewrite-URL 和 x-blog-post 都不影响文章页；随后的正常请求也是干净的', 'X-Forwarded-Host, X-Host, Forwarded, X-Original-URL, X-Rewrite-URL and x-blog-post change nothing in the post page; the next normal request is clean too'), PASS],
    [t('默认的 cloudfront.net 域名', 'The default cloudfront.net domain'), t('同样的网站和检查，没有捷径', 'The same site and checks, no shortcut'), t('同样的安全响应头；无会话调用 /api/posts 返回 401；来自该域名的 Origin 写心情返回 403；__Host- Cookie 只属于 blog.dliu.com', 'The same security headers; /api/posts without a session 401; a reaction with that domain as Origin 403; the __Host- cookies belong only to blog.dliu.com'), PASS],
    [t('源码映射、代码库文件和构建输出', 'Source maps, repo files and build output'), t('不发布', 'Not published'), t('*.js.map、README.md、.gitleaksignore、scripts/、tsconfig.json、cdk.out/、test/ 和 .DS_Store 返回 403；/node_modules/ 是旧链接，跳转到首页', '*.js.map, README.md, .gitleaksignore, scripts/, tsconfig.json, cdk.out/, test/ and .DS_Store return 403; /node_modules/ is an old-style link and redirects home'), PASS],
    [t('CRLF 和响应头注入', 'CRLF and header injection'), t('不能注入响应头', 'No header can be injected'), t('登录返回地址、路径和旧链接中的 %0d%0a 都没有产生 Set-Cookie 或 Location', '%0d%0a in the sign-in return address, the path and an old link never produces a Set-Cookie or Location'), PASS],
    [t('错误信息泄露', 'Error message leaks'), t('不暴露堆栈、路径或 AWS 细节', 'No stack traces, paths or AWS details'), t('错误 JSON、4,000 位的文章 ID、错误的内容类型和 Microsoft API 的错误请求只返回简短的 JSON 错误；未知文章显示应用页面', 'Bad JSON, a 4,000-digit post ID, a wrong content type and a bad Microsoft API request return only a short JSON error; an unknown post shows the app page'), PASS],
    [t('登录错误页面', 'Sign-in error page'), t('只显示 OAuth 错误代码', 'Shows only an OAuth error code'), t('?error=<b>…</b> 显示 “unknown_error”，不再显示链接中的文字（本轮修复；以前会转义后显示，可被用来伪造提示）', '?error=<b>…</b> shows “unknown_error” and no longer the text from the link (fixed this round; it used to be shown escaped, which allowed fake messages)'), PASS],
    [t('网站 CORS', 'Website CORS'), t('不向其他网站授权', 'No grants to other sites'), t('来自 evil.example 的预检和 GET 都没有 Access-Control-Allow-Origin 或 Allow-Credentials', 'A preflight and a GET from evil.example get no Access-Control-Allow-Origin or Allow-Credentials'), PASS],
    [t('上传的媒体', 'Uploaded media'), t('固定类型，nosniff', 'Fixed type, nosniff'), t('文章图片以 image/jpeg 和 nosniff 提供；HTML、SVG 和其他类型一律作为附件下载（s3 单元测试）', 'The post’s picture is served as image/jpeg with nosniff; HTML, SVG and other types always download as attachments (s3 unit tests)'), PASS],
    [t('Markdown 和视频嵌入 XSS', 'Markdown and video-embed XSS'), t('任何脚本、事件处理器或外部框架都进不了页面', 'No script, event handler or foreign frame reaches the page'), t('34 个攻击样本（大小写和实体编码的 javascript:、data:、vbscript:、//、属性逃逸、嵌套链接、原始 HTML、带 onload 或 srcdoc 的 iframe、伪造的视频域名）：单元测试检查渲染器创建的每个元素和属性', '34 payloads (javascript: in mixed case and entity-encoded, data:, vbscript:, //, attribute break-outs, nested links, raw HTML, iframes with onload or srcdoc, look-alike video domains): a unit test checks every element and attribute the renderer creates'), PASS],
  ]));

  add('h2', t('威胁模型', 'Threat model'));
  add('p', t('可能出什么问题、靠什么阻止，以及还剩多少风险。这里假设攻击者读过源码，因为源码公开在 GitHub 上。最大的风险来自 API 的 Microsoft 访问令牌：在它过期之前，持有带 blog.write 权限令牌的人可以以作者身份发布。上面的线上渗透测试针对运行中的网站检查了这些措施。', 'What could go wrong, what stops it, and how much risk is left. It assumes the attacker has read the source code, which is public on GitHub. The biggest risk is a Microsoft access token for the API: until it expires, whoever holds one with blog.write can publish as the author. The live penetration test above checks these controls on the running site.'));
  add('h3', t('资产', 'Assets'));
  root.append(table([t('资产', 'Asset'), t('在哪里', 'Where'), t('受损时的影响', 'Harm if compromised')], [
    [t('已发布的文章和媒体', 'Published posts and media'), t('S3 内容存储桶，经 CloudFront 公开', 'The S3 content bucket, public through CloudFront'), t('被篡改或删除（完整性）', 'Defaced or deleted (integrity)')],
    [t('草稿和未发布的文章', 'Drafts and unpublished posts'), t('DynamoDB；附件在未列出的 media/ 地址', 'DynamoDB; attachments at unlisted media/ addresses'), t('提前泄露（机密性）', 'Leaked early (confidentiality)')],
    [t('作者身份', 'The author’s identity'), t('浏览器中的会话 Cookie；助手电脑上的 Microsoft 访问令牌', 'The session cookie in the browser; Microsoft access tokens on the agent’s computer'), t('任何人都能以作者身份发布', 'Anyone could publish as the author')],
    [t('客户端密钥和会话密钥', 'The client secret and session keys'), t('Parameter Store SecureString；会话密钥由它派生', 'Parameter Store SecureString; the session keys are derived from it'), t('可以伪造任何会话', 'Any session could be forged')],
    [t('心情和访客 ID', 'Reactions and visitor IDs'), t('DynamoDB（IP 只以哈希保存两小时）', 'DynamoDB (IPs only as hashes, for two hours)'), t('计数被刷；读者被关联', 'Counts inflated; readers linked')],
    [t('AWS 账单', 'The AWS bill'), t('作者的 AWS 账户', 'The owner’s AWS account'), t('拒绝钱包：被刷流量产生费用', 'Denial of wallet: a flood runs up charges')],
    [t('日志', 'Logs'), t('CloudWatch，保留 90 天', 'CloudWatch, kept 90 days'), t('域名被拒时记录 Microsoft 用户名和对象 ID；不记录 Cookie、令牌或请求体', 'On a domain refusal, a Microsoft user name and object ID; never cookies, tokens or bodies')],
  ]));
  add('h3', t('攻击者', 'Actors'));
  root.append(table([t('谁', 'Who'), t('能接触到什么', 'Can reach'), t('最坏的现实结果', 'Worst realistic outcome')], [
    [t('匿名访客', 'Anonymous visitor'), t('公开页面、/api/reactions、/auth/login、Microsoft API 网关（无有效令牌）', 'Public pages, /api/reactions, /auth/login, the Microsoft API gateway (without a valid token)'), t('刷心情计数；产生 CloudFront 费用', 'Inflate reaction counts; run up CloudFront charges')],
    [t('已登录的非所有者', 'Signed-in non-owner'), t('其他 Microsoft 账号在登录时被拒绝。dliu.com 租户中每个已登录账号都是作者（单作者模式），所以没有“别人的数据”可以越权访问；API 只给分配了 api.access 的账号', 'Other Microsoft accounts are refused at sign-in. Every signed-in dliu.com account is an author (single-author model), so there is no one else’s data to reach (no IDOR surface); the API only serves accounts assigned api.access'), t('不适用', 'Not applicable')],
    [t('所有者（作者）', 'Owner (author)'), t('应用中的一切，以及 AWS 控制台', 'Everything in the app, and the AWS console'), t('被信任', 'Trusted')],
    [t('被盗的 Cookie 或令牌', 'A stolen cookie or token'), t('在过期前以作者身份（Cookie 30 天，令牌约 1 小时，受权限限制）', 'Acts as the author until it expires (cookie 30 days; token about 1 hour, limited to its permissions)'), t('发布、修改或（有 blog.delete 时）删除文章；受上传上限和 API 限流约束', 'Publish, change or (with blog.delete) delete posts; held back by upload caps and API throttling')],
    [t('被入侵的依赖', 'A compromised dependency'), t('只有部署和测试工具，在作者电脑上运行', 'Only deploy and test tools, on the author’s computer'), t('以作者的 AWS 凭据改变部署；运行时没有第三方代码', 'Change a deploy with the author’s AWS credentials; there is no third-party code at run time')],
  ]));
  add('h3', t('信任边界和数据流', 'Trust boundaries and data flows'));
  root.append(list([
    t('互联网 → CloudFront：只允许 TLS 1.2 以上；查看器函数设置 x-blog-viewer 和文章 ID，丢弃读者发送的同名请求头。', 'Internet → CloudFront: TLS 1.2 or later; the viewer function sets x-blog-viewer and the post ID and drops any copies a reader sends.'),
    t('CloudFront → S3 和 Lambda 函数 URL：用源站访问控制（SigV4）签名；源站不接受其他任何请求。', 'CloudFront → S3 and the Lambda Function URL: signed with origin access control (SigV4); the origins accept nothing else.'),
    t('Lambda → DynamoDB、S3、Parameter Store：IAM 角色，只有所需的操作和前缀。', 'Lambda → DynamoDB, S3, Parameter Store: an IAM role with only the actions and prefixes it needs.'),
    t('Lambda ↔ Microsoft Entra：通过 HTTPS 的 OpenID Connect；ID 令牌用 Microsoft 的公钥验证。', 'Lambda ↔ Microsoft Entra: OpenID Connect over HTTPS; ID tokens verified with Microsoft’s public keys.'),
    t('助手 → API Gateway（Entra 访问令牌，JWT 授权方，限流）→ 同一个 Lambda。', 'Agent → API Gateway (Entra access token, JWT authorizer, throttling) → the same Lambda.'),
    t('S3 媒体事件 → EventBridge → SQS → 清除函数 → CloudFront 清除。', 'S3 media events → EventBridge → SQS → invalidator → CloudFront invalidation.'),
    t('读者浏览器 → traffic.dliu.com 脚本和 video.dliu.com 播放器：作者自己的网站，由 CSP 限定。', 'Reader’s browser → the traffic.dliu.com script and video.dliu.com player: the owner’s own sites, pinned by the CSP.'),
  ]));
  add('h3', t('按组件的 STRIDE', 'STRIDE by component'));
  root.append(table([t('组件', 'Component'), t('STRIDE', 'STRIDE'), t('威胁', 'Threat'), t('防护措施', 'Control')], [
    [t('CloudFront 和查看器函数', 'CloudFront and the viewer function'), t('仿冒', 'Spoofing'), t('伪造客户端 IP 以绕过心情限流', 'Spoof the client IP to get round the reaction limit'), t('查看器函数用 CloudFront 看到的连接 IP 覆盖 x-blog-viewer；X-Forwarded-For 被忽略（线上测试）', 'The viewer function overwrites x-blog-viewer with the connection IP CloudFront sees; X-Forwarded-For is ignored (live test)')],
    ['', t('篡改', 'Tampering'), t('用请求头投毒缓存的页面或分享预览', 'Poison a cached page or share preview with headers'), t('缓存键只用查看器函数设置的文章 ID；转发类请求头不进入缓存键，也不影响页面（线上测试）', 'The cache key uses only the post ID set by the viewer function; forwarding headers are not in the key and change nothing (live test)')],
    ['', t('信息泄露', 'Information disclosure'), t('缓存欺骗：让 CloudFront 缓存某人的 API 响应', 'Cache deception: get CloudFront to cache someone’s API response'), t('/api/* 和 /auth/* 不缓存；/api/me.css 之类的路径返回 404（线上测试）', '/api/* and /auth/* are never cached; paths such as /api/me.css return 404 (live test)')],
    ['', t('拒绝服务', 'Denial of service'), t('大量请求', 'Request floods'), t('网络层由免费的 AWS Shield Standard 处理；应用层没有上限（没有 WAF），见下面的拒绝钱包', 'Network-level floods are handled by the free AWS Shield Standard; application-level floods have no cap (no WAF), see Denial of wallet below')],
    [t('S3 存储桶', 'S3 buckets'), t('信息泄露', 'Information disclosure'), t('直接读取存储桶、列出文件或读取草稿', 'Read the buckets directly, list files or read drafts'), t('阻止所有公开访问；只允许这个分发通过 OAC 读取；拒绝非 HTTPS；列目录返回 403；草稿文件在随机的 16 位 ID 下', 'Block all public access; only this distribution may read, via OAC; non-HTTPS denied; listings return 403; draft files sit under random 16-character IDs')],
    ['', t('篡改', 'Tampering'), t('绕过网站覆盖或删除媒体', 'Overwrite or delete media outside the site'), t('只有 API 角色（限定前缀）和作者的 AWS 账号能写；媒体改动后自动清除 CloudFront 副本', 'Only the API role (limited prefixes) and the owner’s AWS account can write; changed media is cleared from CloudFront automatically')],
    ['', t('权限提升', 'Elevation of privilege'), t('上传的 HTML 或 SVG 以本站身份运行', 'An uploaded HTML or SVG file runs as the site'), t('非白名单类型一律作为附件下载，类型固定，nosniff，CSP 在所有响应上', 'Anything not on the list downloads as an attachment, with a fixed type, nosniff and the CSP on every response')],
    [t('网站 API（Lambda 函数 URL）', 'Website API (Lambda Function URL)'), t('仿冒', 'Spoofing'), t('伪造或重放会话 Cookie', 'Forge or replay a session cookie'), t('HMAC 签名，密钥来自 Parameter Store，检查类型和用户，恒定时间比较；线上测试和单元测试都覆盖', 'HMAC-signed with keys from Parameter Store, type and user checked, constant-time compare; covered by live and unit tests')],
    ['', t('篡改', 'Tampering'), t('跨站请求修改文章（CSRF）', 'Change posts from another site (CSRF)'), t('每项改动检查 Origin；Cookie 为 SameSite=Lax', 'Origin checked on every change; SameSite=Lax cookie')],
    ['', t('抵赖', 'Repudiation'), t('说不清是谁改了文章', 'No record of who changed a post'), t('文章保存 updatedAt 和 updatedVia（网站或 Microsoft API）；错误日志保留 90 天。单作者模式，不需要按用户审计', 'Posts keep updatedAt and updatedVia (website or Microsoft API); error logs kept 90 days. Single-author model, so no per-user audit is needed')],
    ['', t('信息泄露', 'Information disclosure'), t('错误信息泄露内部细节', 'Error messages leak internals'), t('客户端只收到简短的 JSON 错误；堆栈只写入私有日志（线上测试）', 'Clients get only a short JSON error; stack traces go only to the private logs (live test)')],
    ['', t('权限提升', 'Elevation of privilege'), t('绕过 CloudFront 直接调用函数 URL', 'Call the Function URL directly, bypassing CloudFront'), t('函数 URL 使用 AWS_IAM 认证，只接受这个分发通过 OAC 签名的请求（线上测试 403）', 'The Function URL uses AWS_IAM auth and accepts only requests this distribution signs with OAC (live test: 403)')],
    [t('Microsoft API（API Gateway）', 'Microsoft API (API Gateway)'), t('仿冒', 'Spoofing'), t('伪造令牌，或使用给其他应用、租户的令牌', 'Forge a token, or use one meant for another app or tenant'), t('JWT 授权方检查签名、颁发者、受众和有效期；Lambda 再检查租户、客户端、用户和角色。九个路由 × 五种伪造令牌都返回 401（线上测试）', 'The JWT authorizer checks signature, issuer, audience and expiry; the Lambda checks tenant, client, user and role again. Nine routes × five forged tokens all return 401 (live test)')],
    ['', t('权限提升', 'Elevation of privilege'), t('用只读令牌写入或删除', 'Write or delete with a read-only token'), t('网关按路由检查 blog.read、blog.write、blog.delete；Lambda 再检查一次（单元测试）', 'The gateway checks blog.read, blog.write or blog.delete per route; the Lambda checks again (unit tests)')],
    ['', t('拒绝服务', 'Denial of service'), t('用泄露的令牌刷请求，占满共用的 Lambda', 'Flood with a leaked token to take over the shared Lambda'), t('有效令牌整个 API 每秒 10 次、突发 20 次（本轮新增），超出返回 429；无效令牌在授权方就被拒绝', 'Valid tokens: 10 requests a second for the whole API, bursts of 20 (added this round), anything more gets 429; bad tokens are refused by the authorizer first')],
    [t('登录（Microsoft Entra OpenID Connect）', 'Sign-in (Microsoft Entra OpenID Connect)'), t('仿冒', 'Spoofing'), t('伪造回调、注入授权码或重放登录', 'Forge the callback, inject a code or replay a sign-in'), t('state、nonce 和 PKCE；登录 Cookie 和会话 Cookie 用不同密钥；检查 ID 令牌的签名、颁发者、租户和受众', 'state, nonce and PKCE; sign-in and session cookies use different keys; ID token signature, issuer, tenant and audience checked')],
    ['', t('篡改', 'Tampering'), t('通过返回地址开放重定向', 'Open redirect through the return address'), t('返回地址必须是本站路径；//evil.example 之类会被拒绝（线上测试）', 'The return address must be a path on this site; //evil.example and the like are refused (live test)')],
    ['', t('信息泄露', 'Information disclosure'), t('用错误参数在登录页上伪造提示', 'Fake messages on the sign-in page through the error parameter'), t('只显示 OAuth 错误代码，其他一律显示 unknown_error（本轮修复）', 'Only an OAuth error code is shown, anything else as unknown_error (fixed this round)')],
    ['', t('权限提升', 'Elevation of privilege'), t('其他 Microsoft 账号登录成作者', 'Another Microsoft account signs in as an author'), t('单租户应用；只接受 @dliu.com 账号', 'Single-tenant app; only @dliu.com accounts are accepted')],
    [t('DynamoDB', 'DynamoDB'), t('篡改', 'Tampering'), t('数据被删除或破坏', 'Data deleted or corrupted'), t('删除保护、时间点恢复、删除堆栈时保留', 'Deletion protection, point-in-time recovery, retained if the stack is deleted')],
    ['', t('信息泄露', 'Information disclosure'), t('读者读到草稿', 'Readers read drafts'), t('表只能由 Lambda 访问；草稿正文从不写入公开存储桶', 'Only the Lambda can reach the table; draft text is never written to the public bucket')],
    [t('浏览器应用和 Markdown', 'Browser app and Markdown'), t('篡改', 'Tampering'), t('文章中的脚本在读者浏览器中运行（XSS）', 'Script in a post runs in readers’ browsers (XSS)'), t('只用 DOM 方法渲染，不允许原始 HTML，链接协议白名单，视频 iframe 由 ID 重新生成；34 个攻击样本的单元测试；CSP', 'Rendered with DOM methods only, no raw HTML, a link-scheme allow-list, video iframes rebuilt from the ID; a unit test of 34 payloads; the CSP')],
    ['', t('信息泄露', 'Information disclosure'), t('其他网站的图片记录读者 IP', 'Pictures from other sites record readers’ IPs'), t('接受的风险；发布前审阅助手写的文章', 'Accepted; review agent posts before publishing')],
    [t('媒体清除函数', 'Media invalidator'), t('拒绝服务', 'Denial of service'), t('刷清除请求，用完每月 1,000 条免费路径', 'Spam invalidations to use up the 1,000 free paths a month'), t('只在 media/ 中的文件被删除或在应用之外写入时触发（应用自己的复制会被忽略），只有作者能做到；一分钟内的改动合并处理，通常只用一条通配路径', 'Fires only when a media/ file is deleted or written outside the app (the app’s own copies are ignored), which only the author can do; changes within a minute are cleared together, usually as one wildcard path')],
    ['', t('权限提升', 'Elevation of privilege'), t('函数被滥用', 'The function is misused'), t('只能对这个分发创建清除', 'Can only create invalidations on this distribution')],
    [t('依赖和部署', 'Dependencies and deploys'), t('篡改', 'Tampering'), t('被入侵的 npm 依赖', 'A compromised npm dependency'), t('Lambda 只打包自己的源文件（没有 node_modules，AWS SDK 来自运行时）；浏览器代码没有第三方库；package-lock.json 固定版本。部署工具在作者电脑上带着 AWS 凭据运行，这是剩余风险', 'The Lambdas ship only their own source files (no node_modules; the AWS SDK comes from the runtime); the browser code has no third-party libraries; package-lock.json pins versions. Deploy tools run on the author’s computer with AWS credentials, which is a residual risk')],
  ]));
  add('h3', t('场景', 'Scenarios'));
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
    [t('读过公开源码的人把 /auth/login 发给任何人的登录 Cookie 当作会话 Cookie 重放', 'Someone who has read the public source replays the sign-in cookie that /auth/login gives anyone as a session cookie'), LOW, t('2026 年 10 月 28 日渗透测试后已修复。登录 Cookie 和会话 Cookie 现在用不同的密钥签名，并带有会被检查的类型；会话必须指明用户。修复前的所有会话都已结束。单元测试会重放登录 Cookie 和其他伪造内容，2026 年 11 月 3 日的线上测试也重放了一次，被拒绝', 'Fixed on 28 October 2026 after a penetration test. Sign-in and session cookies are now signed with different keys and carry a type that is checked; a session must name a user. Every session from before the fix was ended. Unit tests replay the sign-in cookie and other forged payloads, and the live test on 3 November 2026 replayed it on the site and was refused')],
    [t('登录被篡改：伪造回调、窃取授权码或开放重定向', 'Sign-in is tampered with: forged callback, stolen code or open redirect'), LOW, t('state、nonce 和 PKCE；检查 ID 令牌的签名、颁发者、租户和受众；返回路径必须在本站', 'state, nonce and PKCE; ID token signature, issuer, tenant and audience checked; return paths must be on this site')],
    [t('文章或上传文件在读者浏览器中运行脚本（存储型 XSS）', 'A post or upload runs script in readers’ browsers (stored XSS)'), LOW, t('用 DOM 方法渲染 Markdown，不允许原始 HTML；只允许安全的链接协议；CSP 只允许本站和 traffic.dliu.com 的脚本；HTML 和 SVG 上传文件一律下载而不打开', 'Markdown rendered with DOM methods and no raw HTML; safe link schemes only; CSP allows scripts from the site and traffic.dliu.com only; HTML and SVG uploads download instead of opening')],
    [t('助手在文章中放入其他网站的图片来追踪读者', 'An agent puts a picture from another site in a post to track readers'), LOW, t('图片可以来自任何 https 地址，那个网站会看到读者的 IP 地址；发布前请审阅助手写的文章', 'Pictures may come from any https address, so that site sees readers’ IP addresses; review agent posts before publishing')],
    [t('文章嵌入的播放器行为异常或加载其他网站', 'A post embeds a player that misbehaves or loads another site'), LOW, t('只有作者自己的网站 video.dliu.com 可以被嵌入（CSP frame-src）。播放器地址根据 10 位视频 ID 和少数经过检查的选项重新生成；粘贴的嵌入代码中的其他内容一概不用', 'Only video.dliu.com, the owner’s own site, can be framed (CSP frame-src). The player address is rebuilt from a 10-digit video ID and a few checked options; nothing else from a pasted embed code is used')],
    [t('作者页面被嵌入框架，诱骗作者点击（点击劫持）', 'The author’s pages are framed to trick the author into clicking (clickjacking)'), LOW, t('X-Frame-Options DENY 和 CSP frame-ancestors none', 'X-Frame-Options DENY and CSP frame-ancestors none')],
    [t('读者大量请求文章页以耗尽 Lambda，或污染缓存的分享预览', 'Readers flood post pages to use up the Lambda, or poison a cached share preview'), LOW, t('CloudFront 把每篇文章页缓存五分钟，Lambda 出错时返回普通页面，所以文章始终可读。缓存键是只有查看器函数会设置的文章 ID 请求头；读者发送的会被丢弃。只有已发布文章才有分享标签，由转义后的标题、摘要和文章自己的图片生成', 'CloudFront caches each post page for five minutes, and serves the plain page if the Lambda fails, so posts stay readable. The page is keyed by a post-ID header that only the viewer function sets; one sent by a reader is dropped. Only published posts get tags, built from their escaped title, excerpt and own picture')],
    [t('有人直接调用 Lambda URL 或存储桶', 'Someone calls the Lambda URL or the buckets directly'), LOW, t('源站访问控制：它们只接受这个 CloudFront 分发签名的请求', 'Origin access control: they accept only requests signed by this CloudFront distribution')],
    [t('大量请求推高账单（拒绝钱包）', 'A flood of requests runs up the bill (denial of wallet)'), MEDIUM, t('Lambda 预留并发 10，平台只记录警告和错误；Microsoft API 每秒 10 次（2026 年 11 月 3 日新增）；API Gateway 在 Lambda 运行前拒绝无效令牌；心情每个 IP 每小时 60 次。有上限的部分每小时最多约 $14；CloudFront 和 API Gateway 的请求费没有上限（没有 WAF），见拒绝钱包', 'Reserved Lambda concurrency of 10, and the platform logs only warnings and errors; the Microsoft API is throttled to 10 a second (added 3 November 2026); API Gateway refuses bad tokens before the Lambda runs; reactions are limited to 60 an hour per IP. The capped parts cost at most about $14 an hour; CloudFront and API Gateway request charges have no cap (no WAF), see Denial of wallet')],
    [t('有人通过清除 Cookie 或伪造访客 ID 刷心情计数', 'Someone inflates reaction counts by clearing cookies or forging visitor IDs'), MEDIUM, t('每个 dl_vid 一个心情，但任何人都能丢弃或捏造这个 Cookie，所以真正的上限是每个 IP 每小时 60 次（2026 年 11 月 3 日线上测试确认伪造 IP 请求头无法绕过）；很多 IP（僵尸网络或切换网络）仍然可以刷更多。计数只是图个乐，不带来任何权限；作者可以删除文章以删除其心情，或直接编辑表', 'One reaction per dl_vid, but anyone can drop or invent the cookie, so the 60-an-hour limit per IP is the real cap (the live test on 3 November 2026 confirmed forged IP headers don’t get round it); many IPs (a botnet, or switching networks) can still add more. Counts are for fun and grant nothing; the author can delete the post’s reactions by deleting it, or edit the table')],
    [t('有人修改其他读者的心情', 'Someone changes another reader’s reaction'), LOW, t('只有知道那位读者的 dl_vid 才行，而它是 HttpOnly 的随机值，只通过 HTTPS 发送给 dliu.com。流量监控用 Math.random 生成这些 ID，所以算不上密钥级别；最坏结果是心情被改', 'Only by knowing that reader’s dl_vid, which is HttpOnly, random and sent only to dliu.com over HTTPS. The traffic monitor makes these IDs with Math.random, so they are not secret-grade; the worst outcome is a changed reaction')],
    [t('心情被用来追踪读者', 'Reactions are used to track readers'), LOW, t('心情和读者的 dl_vid 一起保存，而流量监控本来就会把它和读者的访问关联起来；不保存姓名、邮箱或 IP。点心情是自愿的', 'A reaction is stored with the reader’s dl_vid, which the traffic monitor already links to their visits; no name, email or IP is kept. Reacting is optional')],
    [t('心情请求耗尽作者需要的 Lambda', 'Reaction traffic uses up the Lambda the author needs'), LOW, t('预留并发 10 是共用的；心情计数在文章之后加载，如果 Lambda 繁忙，按钮就不显示，文章照常可读。作者的请求会重试', 'Reserved concurrency of 10 is shared; reaction counts are loaded after the post, and if the Lambda is busy the buttons stay hidden while the post still reads normally. Author requests retry')],
    [t('密钥通过源码泄露', 'Secrets leak through the source code'), LOW, t('源码是公开的，所以安全不依赖隐藏源码。Microsoft 客户端密钥以 SecureString 存在 Parameter Store；博客不保存 API 令牌，租户和应用 ID 不是秘密。2026 年 11 月 3 日用 gitleaks 扫描了全部 git 历史，没有发现机密', 'The source is public, so security does not rely on hiding it. The Microsoft client secret is a SecureString in Parameter Store; the blog stores no API tokens, and the tenant and app IDs are not secrets. All git history was scanned with gitleaks on 3 November 2026 and no secrets were found')],
    [t('草稿在发布前被看到', 'A draft is seen before publishing'), LOW, t('草稿正文留在 DynamoDB；草稿文件位于随机、未列出的网址', 'Draft text stays in DynamoDB; draft files are at random, unlisted URLs')],
  ]));

  add('h2', t('拒绝钱包：被刷流量时最多花多少钱', 'Denial of wallet: the most a flood can cost'));
  add('p', t('攻击者可以不停发请求，让账单上涨。下表是每小时的最坏情况和限制它的措施。实测：14 天内 1,500 次调用，最短计费时长 1.3 毫秒，中位数 17 毫秒，所以 10 个并发最多每秒处理约 7,500 个请求。价格为 eu-west-1 和 CloudFront 欧洲价格。', 'An attacker can keep sending requests to run up the bill. The table shows the worst case per hour and what caps it. Measured: 1,500 calls over 14 days, shortest billed time 1.3 ms, median 17 ms, so 10 concurrent copies can answer at most about 7,500 requests a second. Prices are for eu-west-1 and CloudFront in Europe.'));
  root.append(table([t('部分', 'Part'), t('限制措施', 'What caps it'), t('每小时最坏情况', 'Worst case per hour')], [
    [t('API Lambda（网站和 Microsoft API 共用）', 'API Lambda (the website and Microsoft API share it)'), t('预留并发 10 × 512 MB：最多 18,000 GB 秒（$0.30）；每秒最多约 7,500 次调用 × 每百万 $0.20', 'Reserved concurrency 10 × 512 MB: at most 18,000 GB-seconds ($0.30); at most about 7,500 calls a second × $0.20 per million'), '≈ $5.70'],
    ['DynamoDB', t('只有 Lambda 会读写，受上面的并发限制。超出 IP 限额的心情请求只读一次文章、写一次计数器（两次往返，估计至少 8 毫秒，所以每秒最多约 1,250 次）；限额内的请求每个 IP 每小时只有 60 次', 'Only the Lambda touches it, so the cap above applies. A reaction over the IP limit reads the post once and writes the counter once (two round trips, an estimated 8 ms or more, so at most about 1,250 a second); requests within the limit are only 60 an hour per IP'), '≈ $8'],
    [t('CloudWatch 日志', 'CloudWatch Logs'), t('平台只记录警告和错误，不再每次调用写一行（2026 年 11 月 3 日起）；会产生警告的登录失败需要先往返 Microsoft', 'The platform logs only warnings and errors, no longer a line per call (since 3 November 2026); the sign-in failures that log a warning need a round trip to Microsoft first'), '≈ $0'],
    [t('媒体清除', 'Media invalidations'), t('只有作者删除或在应用之外改动媒体时才会触发', 'Only when the author deletes media or changes it outside the app'), '$0'],
    [t('上传（S3）', 'Uploads (S3)'), t('只有作者能上传：每个文件 100 MB，每篇文章 100 个文件，未保存的上传一天后删除', 'Only the author can upload: 100 MB a file, 100 files a post, unsaved uploads deleted after a day'), t('仅限被盗的作者凭据', 'Stolen author credentials only')],
    [t('Microsoft API（API Gateway）', 'Microsoft API (API Gateway)'), t('无效令牌在授权方返回 401，不运行 Lambda；有效令牌每秒 10 个、突发 20 个，超出返回 429。AWS 没有说明被拒绝的请求是否计费，按全部计费估算（每百万 $1.11，账户上限每秒 1 万）', 'Bad tokens get 401 from the authorizer and never run the Lambda; valid tokens are limited to 10 a second, bursts of 20, and anything more gets 429. AWS does not say whether refused requests are billed, so this assumes they all are ($1.11 per million, account limit 10,000 a second)'), t('≈ $40（每秒 1 万）', '≈ $40 (at 10,000/s)')],
    ['CloudFront', t('没有上限：没有 WAF。每百万 HTTPS 请求 $1.20 + 每百万次函数运行 $0.10，与攻击者自己发出的流量成正比；下载媒体每 GB $0.085（查询字符串不会绕过缓存）', 'No cap: there is no WAF. $1.20 per million HTTPS requests + $0.10 per million function runs, in proportion to the attacker’s own traffic; media downloads $0.085 per GB (query strings don’t bypass the cache)'), t('≈ $47（每秒 1 万）；每 1 Gbit/s 下载 ≈ $38', '≈ $47 (at 10,000/s); ≈ $38 per 1 Gbit/s of downloads')],
    ['S3', t('content/*.json 不缓存，每次请求都会读一次 S3（每百万 $0.40），与 CloudFront 请求成正比', 'content/*.json is not cached, so each request reads S3 once ($0.40 per million), in proportion to CloudFront requests'), t('≈ $14（每秒 1 万）', '≈ $14 (at 10,000/s)')],
  ]));
  root.append(callout('shield', t('有上限的部分（Lambda 和 DynamoDB）合计每小时最多约 $14。CloudFront、API Gateway 和 S3 的请求费只随攻击者的流量增长，没有硬上限；AWS Shield Standard（免费、自动）只挡网络层洪水；账户的每日和每月预算提醒会通知作者，但不会停止计费。要设硬上限，需要加 WAF 限速规则（约每月 $6 起，另加每百万请求 $0.60），这需要所有者决定。', 'The capped parts (Lambda and DynamoDB) add up to at most about $14 an hour. CloudFront, API Gateway and S3 request charges grow only with the attacker’s traffic and have no hard cap; AWS Shield Standard (free and automatic) only stops network-level floods; the account’s daily and monthly budget alerts notify the owner but don’t stop charges. A hard cap needs a WAF rate-based rule (from about $6 a month plus $0.60 per million requests), which is the owner’s decision.')));

  add('h2', t('代码审查', 'Code review'));
  add('p', t('2026 年 11 月 3 日逐个阅读了每个处理程序：lambda/api（index.js、auth.js、api-access.js、posts.js、reactions.js、s3.js、store.js、page.js、config.js、routes.json）、lambda/invalidate/index.js、functions/viewer-request.js、web/app.js 和 web/markdown.js，检查输入验证、每条路径的授权、错误处理和日志。用 make synth 生成的模板检查了 IAM，用只读的 AWS CLI 检查了线上的存储桶策略、公开访问阻止、加密和日志保留。每个修复都有回归测试（npm test：stack、api、markdown 测试）。', 'Every handler was read on 3 November 2026: lambda/api (index.js, auth.js, api-access.js, posts.js, reactions.js, s3.js, store.js, page.js, config.js, routes.json), lambda/invalidate/index.js, functions/viewer-request.js, web/app.js and web/markdown.js, for input validation, authorization on every path, error handling and logging. IAM was checked in the template from make synth, and the live bucket policies, public access blocks, encryption and log retention with the read-only AWS CLI. Every fix has a regression test (npm test: the stack, api and markdown tests).'));
  const ACCEPTED = t('接受', 'Accepted');
  const INFO = t('信息', 'Info');
  root.append(table([t('编号', 'ID'), t('级别', 'Severity'), t('发现', 'Finding'), t('位置', 'Where'), t('状态', 'Status')], [
    ['F1', MEDIUM, t('Microsoft API 没有限流（只有账户默认的每秒 1 万次），泄露的令牌可以占满网站共用的 Lambda', 'The Microsoft API had no throttling (only the account default of 10,000 a second), so a leaked token could take over the Lambda the website shares'), 'lib/blog-stack.ts', t('已修复：每秒 10 次、突发 20 次；stack 测试；线上配置检查', 'Fixed: 10 a second, bursts of 20; stack test; live configuration check')],
    ['F2', LOW, t('API Lambda 对整个内容存储桶有读写删除权限，对网站存储桶有读取权限', 'The API Lambda could read, write and delete anywhere in the content bucket, and read the site bucket'), 'lib/blog-stack.ts', t('已修复：只在 pending/、media/、content/ 和 index.html 上授予指定操作；stack 测试', 'Fixed: named actions on pending/, media/, content/ and index.html only; stack test')],
    ['F3', LOW, t('登录错误页会显示链接中的错误文字（已转义），可被用来伪造提示', 'The sign-in error page showed the error text from the link (escaped), which could fake a message'), 'lambda/api/auth.js', t('已修复：只显示 OAuth 错误代码；api 测试；线上测试', 'Fixed: only an OAuth error code is shown; api test; live test')],
    ['F4', LOW, t('平台为每次调用写日志，被刷流量时会增加日志费用', 'The platform logged a line for every call, adding to the cost of a flood'), 'lib/blog-stack.ts', t('已修复：JSON 日志，平台只记录警告；stack 测试', 'Fixed: JSON logs, platform warnings only; stack test')],
    ['A1', LOW, t('登录也接受以 @dliu.com 结尾的 email 声明；应用是单租户并检查租户，但 email 由租户管理员设置', 'Sign-in also accepts an email claim ending in @dliu.com; the app is single-tenant and checks the tenant, but email is set by the tenant admin'), 'lambda/api/auth.js', t('接受；是否去掉 email 由所有者决定', 'Accepted; whether to drop email is the owner’s decision')],
    ['A2', LOW, t('CDK 辅助函数（证书、部署、自动删除、存储桶通知）的日志组由 Lambda 自动创建，不归堆栈管理；2026 年 11 月 3 日已改为保留 90 天，部署不会改回', 'The log groups of CDK’s helper functions (certificate, deploy, auto-delete, bucket notifications) are created by Lambda, not managed by the stack; since 3 November 2026 they are kept 90 days, and deploys don’t change that'), t('CloudWatch Logs', 'CloudWatch Logs'), t('已修复（账户设置）', 'Fixed (account setting)')],
    ['A3', LOW, t('CDK 生成的辅助函数在 * 资源上有 acm:*Certificate、route53:GetChange 和 cloudfront:CreateInvalidation；只在部署时运行', 'CDK-generated helpers have acm:*Certificate, route53:GetChange and cloudfront:CreateInvalidation on * resources; they run only during deploys'), 'cdk.out (make synth)', ACCEPTED],
    ['A4', INFO, t('kms:Decrypt 在 * 上，但条件限定为通过 eu-west-1 的 Parameter Store，用于读取 SecureString', 'kms:Decrypt on *, but only via Parameter Store in eu-west-1, to read the SecureString'), 'lib/blog-stack.ts', ACCEPTED],
    ['A5', INFO, t('域名被拒时日志记录 Microsoft 用户名和对象 ID（90 天）', 'On a domain refusal the log records the Microsoft user name and object ID (90 days)'), 'lambda/api/auth.js', ACCEPTED],
    ['A6', INFO, t('预签名上传地址在 15 分钟内可以重复使用，但只能写到 pending/ 中同一个键', 'A presigned upload URL can be reused for 15 minutes, but only for the same key in pending/'), 'lambda/api/s3.js', ACCEPTED],
  ]));
  root.append(list([
    t('机密扫描：gitleaks 8.30 detect（全部历史，36 个提交）和 gitleaks dir（工作目录）：除 .gitleaksignore 中的一个测试误报外没有发现；工作目录中的其他命中都在 git 忽略的 cdk.out 构建输出中（资源哈希）。', 'Secret scan: gitleaks 8.30 detect (all history, 36 commits) and gitleaks dir (working tree): nothing apart from one test false positive listed in .gitleaksignore; the other working-tree hits are all in the git-ignored cdk.out build output (asset hashes).'),
    t('npm audit --omit=dev：2 个中等（aws-cdk-lib 中的 minimatch，只在部署时运行，没有修复版本）。npm audit：共 22 个（4 个低、18 个中等），都在 Jest 测试工具链中，只在本地运行；没有高危或严重问题。', 'npm audit --omit=dev: 2 moderate (minimatch inside aws-cdk-lib, deploy time only, no fix available). npm audit: 22 in total (4 low, 18 moderate), all in the Jest test tool chain, run only locally; no high or critical issues.'),
    t('存储桶：两个都阻止所有公开访问、SSE-S3 加密、BucketOwnerEnforced、拒绝非 TLS，只允许这个 CloudFront 分发读取。', 'Buckets: both block all public access, use SSE-S3 encryption and BucketOwnerEnforced, deny non-TLS access and allow reads only by this CloudFront distribution.'),
    t('日志：所有日志组（包括 CDK 辅助函数的）都保留 90 天；不记录 Cookie、令牌、Authorization 请求头或请求体。', 'Logs: every log group, including those of CDK’s helper functions, is kept 90 days; cookies, tokens, the Authorization header and request bodies are never logged.'),
  ]));

  add('h2', t('接受的剩余风险', 'Accepted residual risks'));
  root.append(list([
    t('没有 WAF：CloudFront、API Gateway 和 S3 的请求费没有硬上限（见拒绝钱包）；只有心情有按客户端的限流，Microsoft API 有整体限流，Lambda 预留并发是最后防线。是否加 WAF 由所有者决定。', 'No WAF: CloudFront, API Gateway and S3 request charges have no hard cap (see Denial of wallet); only reactions have a per-client limit, the Microsoft API has an overall throttle, and reserved Lambda concurrency is the backstop. Adding a WAF is the owner’s decision.'),
    t('心情计数可以从很多 IP 地址刷高；它不能证明任何事情。', 'Reaction counts can be inflated from many IP addresses; they are not proof of anything.'),
    t('会话无法单独撤销；轮换客户端密钥会结束所有会话。', 'Sessions cannot be revoked one by one; rotating the client secret ends all of them.'),
    t('Microsoft 访问令牌在过期（约一小时）前不能单独撤销；取消用户的 api.access 分配可阻止新令牌。', 'A Microsoft access token cannot be revoked on its own before it expires (about an hour); removing the user’s api.access assignment stops new ones.'),
    t('有 blog.read 的令牌能读取所有草稿，有 blog.write 的能发布；没有只能写草稿的权限。', 'A token with blog.read can read every draft, and one with blog.write can publish; there is no draft-only permission.'),
    t('没有按调用者的上传配额，助手的文章上线前也没有审批步骤。', 'There is no per-caller upload quota or approval step before an agent’s post goes live.'),
    t('删除的图片约两分钟内从 CloudFront 清除，但已经显示过它的浏览器可能最多保留一天。', 'A deleted picture leaves CloudFront within about two minutes, but a browser that already showed it may keep it for up to a day.'),
    t('部署工具 aws-cdk-lib 带有中等级别的 minimatch 拒绝服务问题，目前没有修复版本（Jest 测试工具链中也有，只在本地运行）；它只在作者电脑上部署时运行，从不在网站上运行，也不处理读者的输入。', 'The deploy tool aws-cdk-lib bundles minimatch with a moderate denial-of-service advisory and no fix yet (so does the Jest test tool chain, run only locally); it runs only on the author’s computer during a deploy, never on the site, and never sees reader input.'),
    t('登录也接受以 @dliu.com 结尾的 email 声明（单租户，并检查租户）；是否只用 preferred_username 和 upn 由所有者决定。', 'Sign-in also accepts an email claim ending in @dliu.com (single tenant, with the tenant checked); whether to rely only on preferred_username and upn is the owner’s decision.'),
    t('部署和测试工具在作者电脑上带着 AWS 凭据运行，被入侵的 npm 包可以改变部署；网站运行时没有第三方代码。', 'Deploy and test tools run on the author’s computer with AWS credentials, so a compromised npm package could change a deploy; there is no third-party code at run time.'),
    t('超出免费额度的大量阅读流量会计费；页面在边缘缓存，但每次浏览文章还会从 Lambda 加载心情。', 'Heavy reader traffic beyond the free tier is billed; pages are cached at the edge, but each post view also loads its reactions from the Lambda.'),
  ]));

  source(root, t('源码：dliu-com/blog（lambda/api/auth.js、lambda/api/index.js、lambda/api/api-access.js、lambda/api/routes.json、lambda/api/reactions.js、lambda/api/s3.js、functions/viewer-request.js、web/markdown.js、lib/blog-stack.ts、scripts/pentest.mjs）。', 'Source: dliu-com/blog (lambda/api/auth.js, lambda/api/index.js, lambda/api/api-access.js, lambda/api/routes.json, lambda/api/reactions.js, lambda/api/s3.js, functions/viewer-request.js, web/markdown.js, lib/blog-stack.ts, scripts/pentest.mjs).'));
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
  for (const tab of document.querySelectorAll('.dl-tabs a')) {
    if (tab.dataset.tab === current) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  document.title = `${TITLES[current]()} · ${t('文档', 'Docs')} · ${t('DL 博客', 'DL blog')}`;
  if (scroll) window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => show(true));
window.addEventListener('blog-language-change', () => { draw(); show(false); });
show(false);
