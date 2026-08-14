# Stereo Remaster Setup

## Manual Steps Outside Code

1. Enable Netlify Identity for the site.
2. Enable Netlify Git Gateway.
3. Set the Netlify build command to `pnpm build` or `npm run build`.
4. Set the Netlify publish directory to the repo root.
5. Replace `https://YOUR-NETLIFY-DOMAIN` in generated feed/sitemap files after your final domain is known, or update `scripts/build-content.mjs` to use your production domain.
6. If you want the CMS to store uploads in a different folder, update `admin/config.yml`.

## Content Workflow

- Albums live in `content/albums/*.md`
- Blog posts live in `content/posts/*.md`
- Run `pnpm build` after content changes to regenerate:
  - `assets/albums.json`
  - `assets/posts.json`
  - `albums/*.html`
  - `posts/*.html`
  - `rss.xml`
  - `sitemap.xml`
  - `robots.txt`

## Commerce Flow

The existing cart, checkout, UPI instructions, and Google Apps Script order submission are preserved. The build/content work does not replace the order flow.
