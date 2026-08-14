import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";

const root = process.cwd();
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true
});

const corePages = [
  "",
  "/index.html",
  "/blog.html",
  "/cart.html",
  "/checkout.html",
  "/orders.html",
  "/success.html",
  "/post.html"
];

await ensureDir("assets");
await ensureDir("albums");
await ensureDir("posts");

const albums = await loadAlbums();
const posts = await loadPosts(albums);

await fs.writeFile(path.join(root, "assets", "albums.json"), JSON.stringify(albums, null, 2) + "\n", "utf8");
await fs.writeFile(path.join(root, "assets", "posts.json"), JSON.stringify(posts, null, 2) + "\n", "utf8");

for (const album of albums) {
  await fs.writeFile(path.join(root, "albums", `${album.slug}.html`), renderAlbumShell(album), "utf8");
}

for (const post of posts) {
  await fs.writeFile(path.join(root, "posts", `${post.slug}.html`), renderPostShell(post), "utf8");
}

await fs.writeFile(path.join(root, "rss.xml"), renderRss(posts), "utf8");
await fs.writeFile(path.join(root, "sitemap.xml"), renderSitemap(albums, posts), "utf8");
await fs.writeFile(path.join(root, "robots.txt"), "User-agent: *\nAllow: /\nSitemap: https://YOUR-NETLIFY-DOMAIN/sitemap.xml\n", "utf8");

async function ensureDir(relPath) {
  await fs.mkdir(path.join(root, relPath), { recursive: true });
}

async function listMarkdown(relDir) {
  const dir = path.join(root, relDir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

async function loadAlbums() {
  const files = await listMarkdown("content/albums");
  const items = [];

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const { data, content } = matter(raw);
    const tracks = Array.isArray(data.tracks) ? data.tracks.map((track) => ({
      t: String(track.t || "").trim(),
      len: String(track.len || "").trim()
    })) : [];

    items.push({
      id: String(data.id || ""),
      slug: String(data.slug || path.basename(file, ".md")),
      title: String(data.title || ""),
      artist: String(data.artist || ""),
      year: Number(data.year || 0),
      genre: String(data.genre || ""),
      price: Number(data.price || 0),
      cover: String(data.cover || ""),
      gallery: Array.isArray(data.gallery) ? data.gallery.map(String) : [],
      notes: String(data.notes || content || "").trim(),
      format: String(data.format || ""),
      released: data.released !== false,
      featured: Boolean(data.featured),
      seoTitle: String(data.seo_title || data.title || ""),
      seoDescription: String(data.seo_description || data.notes || "").trim(),
      tracks
    });
  }

  return items.sort((a, b) => String(b.id).localeCompare(String(a.id)));
}

async function loadPosts(albums) {
  const files = await listMarkdown("content/posts");
  const items = [];

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const { data, content } = matter(raw);
    const html = md.render(content);
    const text = content.replace(/\s+/g, " ").trim();
    const wordCount = text ? text.split(" ").length : 0;
    const readingTime = Math.max(1, Math.round(wordCount / 200));
    const slug = String(data.slug || path.basename(file, ".md"));
    const relatedAlbumSlug = String(data.related_album || "").trim();
    const relatedAlbum = albums.find((album) => album.slug === relatedAlbumSlug) || null;

    items.push({
      id: slug,
      slug,
      title: String(data.title || ""),
      date: String(data.date || ""),
      cover: String(data.cover || ""),
      excerpt: String(data.excerpt || text.slice(0, 180)).trim(),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
      relatedAlbumSlug: relatedAlbum ? relatedAlbum.slug : "",
      relatedAlbumTitle: relatedAlbum ? relatedAlbum.title : "",
      seoTitle: String(data.seo_title || data.title || ""),
      seoDescription: String(data.seo_description || data.excerpt || text.slice(0, 180)).trim(),
      body: content,
      html,
      readingTime,
      wordCount
    });
  }

  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function renderAlbumShell(album) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(withSiteTitle(album.seoTitle || album.title))}</title>
  <meta name="description" content="${escapeAttribute(album.seoDescription || album.notes)}">
  <meta property="og:title" content="${escapeAttribute(album.seoTitle || album.title)}">
  <meta property="og:description" content="${escapeAttribute(album.seoDescription || album.notes)}">
  <meta property="og:image" content="${escapeAttribute(album.cover)}">
  <meta property="og:type" content="product">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttribute(album.seoTitle || album.title)}">
  <meta name="twitter:description" content="${escapeAttribute(album.seoDescription || album.notes)}">
  <meta name="twitter:image" content="${escapeAttribute(album.cover)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../assets/site.css">
  <script defer src="https://cdn.jsdelivr.net/npm/fuse.js@7.1.0"></script>
</head>
<body data-page="home">
  <header class="site-header">
    <div class="site-header-inner">
      <a class="brand" href="../index.html">
        <span class="brand-mark">stereo remaster</span>
      </a>
      <nav class="site-nav mono">
        <a href="../index.html" data-nav="home">Catalogue</a>
        <a href="../blog.html" data-nav="blog">Blog</a>
        <a href="../orders.html" data-nav="orders">Orders</a>
        <a class="cart-pill" href="../cart.html" data-nav="cart">Cart <span class="cart-count">0</span></a>
      </nav>
    </div>
  </header>
  <main>
    <a class="detail-back mono" href="../index.html">Back to catalogue</a>
    <section data-album-page data-album-slug="${escapeAttribute(album.slug)}"></section>
  </main>
  <footer class="site-footer">
    <div class="site-footer-inner">
      <div>Dedicated album page for a richer release story.</div>
      <div class="mono">Stereo Remaster</div>
    </div>
  </footer>
  <script src="../assets/data.js"></script>
  <script src="../assets/site.js"></script>
</body>
</html>
`;
}

function renderPostShell(post) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(withSiteTitle(post.seoTitle || post.title))}</title>
  <meta name="description" content="${escapeAttribute(post.seoDescription || post.excerpt)}">
  <meta property="og:title" content="${escapeAttribute(post.seoTitle || post.title)}">
  <meta property="og:description" content="${escapeAttribute(post.seoDescription || post.excerpt)}">
  <meta property="og:image" content="${escapeAttribute(post.cover)}">
  <meta property="og:type" content="article">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttribute(post.seoTitle || post.title)}">
  <meta name="twitter:description" content="${escapeAttribute(post.seoDescription || post.excerpt)}">
  <meta name="twitter:image" content="${escapeAttribute(post.cover)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;1,9..144,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../assets/site.css">
  <script defer src="https://cdn.jsdelivr.net/npm/fuse.js@7.1.0"></script>
</head>
<body data-page="blog">
  <header class="site-header">
    <div class="site-header-inner">
      <a class="brand" href="../index.html">
        <span class="brand-mark">stereo remaster</span>
      </a>
      <nav class="site-nav mono">
        <a href="../index.html" data-nav="home">Catalogue</a>
        <a href="../blog.html" data-nav="blog">Blog</a>
        <a href="../orders.html" data-nav="orders">Orders</a>
        <a class="cart-pill" href="../cart.html" data-nav="cart">Cart <span class="cart-count">0</span></a>
      </nav>
    </div>
  </header>
  <main>
    <section data-post-page data-post-slug="${escapeAttribute(post.slug)}"></section>
  </main>
  <footer class="site-footer">
    <div class="site-footer-inner">
      <div>Stereo Remaster</div>
      <div class="mono">Review</div>
    </div>
  </footer>
  <script src="../assets/data.js"></script>
  <script src="../assets/site.js"></script>
</body>
</html>
`;
}

function renderRss(posts) {
  const items = posts.map((post) => `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>https://YOUR-NETLIFY-DOMAIN/posts/${post.slug}.html</link>
      <guid>https://YOUR-NETLIFY-DOMAIN/posts/${post.slug}.html</guid>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
      <description>${escapeXml(post.excerpt)}</description>
    </item>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Stereo Remaster</title>
    <link>https://YOUR-NETLIFY-DOMAIN/</link>
    <description>Notes, reviews, and stereo remaster releases.</description>
${items}
  </channel>
</rss>
`;
}

function renderSitemap(albums, posts) {
  const urls = [
    ...corePages,
    ...albums.map((album) => `/albums/${album.slug}.html`),
    ...posts.map((post) => `/posts/${post.slug}.html`)
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>https://YOUR-NETLIFY-DOMAIN${url}</loc></url>`).join("\n")}
</urlset>
`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function escapeXml(value) {
  return escapeAttribute(value).replace(/'/g, "&apos;");
}

function withSiteTitle(value) {
  const title = String(value || "").trim();
  return /stereo remaster/i.test(title) ? title : `${title} | Stereo Remaster`;
}
