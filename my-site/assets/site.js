(function () {
  const CART_KEY = "stereo-remaster-cart";
  const ORDER_KEY = "stereo-remaster-orders";
  const SUCCESS_KEY = "stereo-remaster-last-order";
  const THEME_KEY = "stereo-remaster-theme";

  let albumsData = [];
  let postsData = [];
  let searchFuse = null;
  let searchIndex = [];
  let revealObserver = null;

  function readJson(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  function storedTheme() {
    try {
      return window.localStorage.getItem(THEME_KEY);
    } catch (error) {
      return null;
    }
  }

  function preferredTheme() {
    const saved = storedTheme();
    if (saved === "light" || saved === "dark") {
      return saved;
    }
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    syncThemeToggle();
  }

  function saveTheme(theme) {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      return;
    }
  }

  function themeLabel(theme) {
    return theme === "dark" ? "Light" : "Dark";
  }

  function runThemeBloom(nextTheme, originX, originY) {
    document.documentElement.style.setProperty("--theme-origin-x", originX + "px");
    document.documentElement.style.setProperty("--theme-origin-y", originY + "px");

    const bloom = document.createElement("div");
    bloom.className = "theme-bloom " + (nextTheme === "dark" ? "is-dark" : "is-light");
    document.body.appendChild(bloom);

    window.setTimeout(function () {
      applyTheme(nextTheme);
      saveTheme(nextTheme);
    }, nextTheme === "dark" ? 220 : 180);

    window.setTimeout(function () {
      if (bloom.parentNode) {
        bloom.parentNode.removeChild(bloom);
      }
    }, 1100);
  }

  function currency(amount) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    }).format(amount);
  }

  function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function absoluteUrl(relativeOrAbsolute) {
    try {
      return new URL(relativeOrAbsolute, window.SITE_CONFIG.siteUrl || window.location.origin).toString();
    } catch (error) {
      return relativeOrAbsolute;
    }
  }

  async function fetchJson(url, fallback) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load " + url);
      }
      return await response.json();
    } catch (error) {
      return fallback;
    }
  }

  async function loadContent() {
    const base = document.body.dataset.page === "home" && window.location.pathname.includes("/albums/") ? ".." : ".";
    const prefix = window.location.pathname.includes("/albums/") || window.location.pathname.includes("/posts/") ? "../assets" : "assets";
    albumsData = await fetchJson(prefix + "/albums.json", window.ALBUMS || []);
    postsData = await fetchJson(prefix + "/posts.json", window.BLOG_POSTS || []);
    hydratePostRelations();
    buildSearchIndex();
    return { base, prefix };
  }

  function hydratePostRelations() {
    const postsBySlug = new Map(postsData.map((post) => [post.slug, post]));
    postsData = postsData.map(function (post) {
      const relatedPosts = postsData
        .filter(function (candidate) {
          if (candidate.slug === post.slug) {
            return false;
          }
          return (candidate.tags || []).some(function (tag) {
            return (post.tags || []).includes(tag);
          });
        })
        .slice(0, 3)
        .map(function (candidate) {
          return candidate.slug;
        });

      const relatedAlbum = albumBySlug(post.relatedAlbumSlug || "");
      return Object.assign({}, post, {
        relatedPostSlugs: relatedPosts,
        relatedAlbumTitle: relatedAlbum ? relatedAlbum.title : (post.relatedAlbumTitle || "")
      });
    });
  }

  function allAlbums() {
    return albumsData;
  }

  function allPosts() {
    return postsData;
  }

  function albumById(id) {
    return allAlbums().find(function (album) {
      return album.id === id;
    }) || null;
  }

  function albumBySlug(slug) {
    return allAlbums().find(function (album) {
      return album.slug === slug;
    }) || null;
  }

  function postBySlug(slug) {
    return allPosts().find(function (post) {
      return post.slug === slug;
    }) || null;
  }

  function albumSummary(items) {
    return items.map(function (entry) {
      return entry.album.title + " x" + entry.quantity;
    }).join(", ");
  }

  function cart() {
    return readJson(CART_KEY, []);
  }

  function saveCart(items) {
    writeJson(CART_KEY, items);
    updateCartBadges();
  }

  function cartCount() {
    return cart().reduce(function (sum, item) {
      return sum + item.quantity;
    }, 0);
  }

  function cartItemsDetailed() {
    return cart().map(function (item) {
      return {
        album: albumById(item.id),
        quantity: item.quantity
      };
    }).filter(function (entry) {
      return Boolean(entry.album);
    });
  }

  function cartTotals() {
    const items = cartItemsDetailed();
    const subtotal = items.reduce(function (sum, entry) {
      return sum + (entry.album.price * entry.quantity);
    }, 0);
    return {
      items: items,
      subtotal: subtotal,
      total: subtotal
    };
  }

  function addToCart(id, quantity) {
    const amount = Math.max(1, quantity || 1);
    const items = cart();
    const existing = items.find(function (item) {
      return item.id === id;
    });

    if (existing) {
      existing.quantity += amount;
    } else {
      items.push({ id: id, quantity: amount });
    }

    saveCart(items);
  }

  function setCartQuantity(id, quantity) {
    const items = cart().map(function (item) {
      if (item.id === id) {
        return { id: id, quantity: quantity };
      }
      return item;
    }).filter(function (item) {
      return item.quantity > 0;
    });
    saveCart(items);
  }

  function removeFromCart(id) {
    saveCart(cart().filter(function (item) {
      return item.id !== id;
    }));
  }

  function clearCart() {
    saveCart([]);
  }

  function orders() {
    return readJson(ORDER_KEY, []);
  }

  function saveOrders(list) {
    writeJson(ORDER_KEY, list);
  }

  function saveOrder(order) {
    const list = orders();
    list.push(order);
    saveOrders(list);
  }

  function exportOrdersCsv() {
    const list = orders();
    if (!list.length) {
      window.alert("No orders to export.");
      return;
    }

    const header = ["Ref", "Date", "Albums", "Total", "Transaction", "Email", "Phone", "Notes", "Status"];
    const rows = list.map(function (order) {
      return [
        order.ref,
        order.ts,
        order.items.map(function (item) { return item.title + " x" + item.quantity; }).join(" | "),
        order.total,
        order.txn,
        order.email,
        order.phone,
        (order.notes || "").replace(/\n/g, " "),
        order.status
      ];
    });

    const csv = [header].concat(rows).map(function (row) {
      return row.map(function (cell) {
        return '"' + String(cell).replace(/"/g, '""') + '"';
      }).join(",");
    }).join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "orders.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function markOrder(ref) {
    const list = orders();
    const order = list.find(function (entry) {
      return entry.ref === ref;
    });
    if (!order) {
      return;
    }
    order.status = order.status === "sent" ? "pending" : "sent";
    saveOrders(list);
    renderOrdersPage();
  }

  async function submitEndpointPayload(payload) {
    if (!window.SITE_CONFIG.sheetsEndpoint) {
      return;
    }

    try {
      await fetch(window.SITE_CONFIG.sheetsEndpoint, {
        method: "POST",
        mode: "no-cors",
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      console.warn("Sheets sync failed:", error);
    }
  }

  function copyUpi() {
    navigator.clipboard.writeText(window.SITE_CONFIG.upiId).then(function () {
      const button = document.querySelector("[data-copy-upi]");
      if (!button) {
        return;
      }
      const original = button.textContent;
      button.textContent = "Copied";
      window.setTimeout(function () {
        button.textContent = original;
      }, 1200);
    });
  }

  function setActiveNav() {
    const page = document.body.dataset.page;
    document.querySelectorAll("[data-nav]").forEach(function (link) {
      if (link.dataset.nav === page) {
        link.classList.add("is-active");
      }
    });
  }

  function updateCartBadges() {
    const count = cartCount();
    document.querySelectorAll(".cart-count").forEach(function (badge) {
      badge.textContent = String(count);
    });
  }

  function syncThemeToggle() {
    const theme = document.documentElement.dataset.theme || preferredTheme();
    document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
      const label = themeLabel(theme);
      button.setAttribute("aria-label", "Switch to " + label.toLowerCase() + " mode");
      const labelEl = button.querySelector("[data-theme-label]");
      if (labelEl) {
        labelEl.textContent = label;
      }
    });
  }

  function injectThemeToggle() {
    document.querySelectorAll(".site-nav").forEach(function (nav) {
      if (nav.querySelector("[data-theme-toggle]")) {
        return;
      }

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "theme-toggle mono";
      toggle.setAttribute("data-theme-toggle", "");
      toggle.innerHTML = '<span class="theme-toggle-dot" aria-hidden="true"></span><span data-theme-label></span>';
      toggle.addEventListener("click", function (event) {
        const next = (document.documentElement.dataset.theme || preferredTheme()) === "dark" ? "light" : "dark";
        const rect = event.currentTarget.getBoundingClientRect();
        runThemeBloom(next, rect.left + (rect.width / 2), rect.top + (rect.height / 2));
      });

      const cartLink = nav.querySelector(".cart-pill");
      if (cartLink) {
        nav.insertBefore(toggle, cartLink);
      } else {
        nav.appendChild(toggle);
      }
    });

    syncThemeToggle();
  }

  function initPageTransitions() {
    if (!document.startViewTransition) {
      return;
    }

    document.addEventListener("click", function (event) {
      const link = event.target.closest("a[href]");
      if (!link) {
        return;
      }

      if (
        link.target === "_blank" ||
        link.hasAttribute("download") ||
        link.href.indexOf("#") > -1 ||
        link.origin !== window.location.origin
      ) {
        return;
      }

      event.preventDefault();
      document.startViewTransition(function () {
        window.location.href = link.href;
      });
    });
  }

  function initRevealObserver() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.querySelectorAll(".js-reveal").forEach(function (el) {
        el.classList.add("is-visible");
      });
      return;
    }

    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.16 });

    document.querySelectorAll(".js-reveal").forEach(function (el) {
      revealObserver.observe(el);
    });
  }

  function buildSearchIndex() {
    const albumRecords = allAlbums().map(function (album) {
      return {
        type: "Album",
        title: album.title,
        subtitle: album.artist,
        slug: album.slug,
        url: relativePath("albums/" + album.slug + ".html"),
        tags: [album.genre, String(album.year)]
      };
    });

    const postRecords = allPosts().map(function (post) {
      return {
        type: "Post",
        title: post.title,
        subtitle: post.excerpt,
        slug: post.slug,
        url: relativePath("posts/" + post.slug + ".html"),
        tags: post.tags || []
      };
    });

    searchIndex = albumRecords.concat(postRecords);
    if (window.Fuse) {
      searchFuse = new window.Fuse(searchIndex, {
        keys: ["title", "subtitle", "tags"],
        threshold: 0.34,
        includeScore: true
      });
    }
  }

  function relativePath(rel) {
    if (window.location.pathname.includes("/albums/") || window.location.pathname.includes("/posts/")) {
      return "../" + rel;
    }
    return rel;
  }

  function injectSearchUI() {
    if (document.querySelector(".search-shell")) {
      return;
    }

    const shell = document.createElement("section");
    shell.className = "search-shell";
    const panelId = "site-search-panel";
    shell.innerHTML = [
      '<div class="search-head">',
      '<button class="search-launch mono" type="button" aria-expanded="false" aria-controls="' + panelId + '">',
      '<span class="search-launch-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16L21 21"></path></svg></span>',
      '<span class="search-launch-label">Search</span>',
      "</button>",
      "</div>",
      '<div class="search-panel" id="' + panelId + '">',
      '<div class="search-bar-wrap">',
      '<label class="search-bar mono" for="site-search-input">',
      '<span>Search</span>',
      '<input id="site-search-input" type="search" placeholder="Albums, posts, artists">',
      "</label>",
      '<div class="search-results" data-search-results></div>',
      "</div>",
      "</div>"
    ].join("");

    const main = document.querySelector("main");
    if (main) {
      main.insertBefore(shell, main.firstChild);
    }

    const launch = shell.querySelector(".search-launch");
    const panel = shell.querySelector(".search-panel");
    const input = shell.querySelector("#site-search-input");
    const results = shell.querySelector("[data-search-results]");
    const mobileMedia = window.matchMedia("(max-width: 720px)");

    function setSearchOpen(nextOpen) {
      const isOpen = Boolean(nextOpen);
      shell.classList.toggle("is-open", isOpen);
      panel.hidden = !isOpen;
      launch.setAttribute("aria-expanded", isOpen ? "true" : "false");
      if (isOpen) {
        window.requestAnimationFrame(function () {
          input.focus({ preventScroll: true });
        });
      } else {
        results.classList.remove("is-open");
      }
    }

    function syncSearchMode() {
      if (mobileMedia.matches) {
        if (!shell.dataset.mobileReady) {
          setSearchOpen(false);
          shell.dataset.mobileReady = "true";
        } else {
          panel.hidden = !shell.classList.contains("is-open");
        }
      } else {
        delete shell.dataset.mobileReady;
        setSearchOpen(true);
      }
    }

    launch.addEventListener("click", function () {
      setSearchOpen(!shell.classList.contains("is-open"));
    });

    input.addEventListener("input", function () {
      const query = input.value.trim();
      if (!query || !searchFuse) {
        results.innerHTML = "";
        results.classList.remove("is-open");
        return;
      }

      const hits = searchFuse.search(query, { limit: 8 }).map(function (entry) {
        return entry.item;
      });

      if (!hits.length) {
        results.innerHTML = '<div class="search-empty muted">No matches yet.</div>';
        results.classList.add("is-open");
        return;
      }

      const groups = ["Album", "Post"].map(function (type) {
        const items = hits.filter(function (hit) { return hit.type === type; });
        if (!items.length) {
          return "";
        }
        return [
          '<div class="search-group">',
          '<div class="search-group-title mono">' + type + "</div>",
          items.map(function (item) {
            return '<a class="search-hit" href="' + item.url + '"><strong>' + escapeHtml(item.title) + '</strong><span>' + escapeHtml(item.subtitle || "") + "</span></a>";
          }).join(""),
          "</div>"
        ].join("");
      }).join("");

      results.innerHTML = groups;
      results.classList.add("is-open");
    });

    document.addEventListener("click", function (event) {
      if (!shell.contains(event.target)) {
        results.classList.remove("is-open");
        if (mobileMedia.matches) {
          setSearchOpen(false);
        }
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        results.classList.remove("is-open");
        if (mobileMedia.matches) {
          setSearchOpen(false);
        }
      }
    });

    if (typeof mobileMedia.addEventListener === "function") {
      mobileMedia.addEventListener("change", syncSearchMode);
    } else if (typeof mobileMedia.addListener === "function") {
      mobileMedia.addListener(syncSearchMode);
    }

    syncSearchMode();
  }

  function injectNowSpinning() {
    if (document.querySelector(".now-spinning")) {
      return;
    }

    const latestPost = allPosts()[0] || null;
    const featuredAlbum = allAlbums().find(function (album) { return album.featured; }) || allAlbums()[0] || null;
    if (!latestPost && !featuredAlbum) {
      return;
    }

    const item = latestPost ? {
      label: "Latest review",
      title: latestPost.title,
      url: relativePath("posts/" + latestPost.slug + ".html")
    } : {
      label: "Now spinning",
      title: featuredAlbum.title,
      url: relativePath("albums/" + featuredAlbum.slug + ".html")
    };

    const el = document.createElement("aside");
    el.className = "now-spinning";
    el.innerHTML = '<div class="mono">' + item.label + '</div><a href="' + item.url + '">' + escapeHtml(item.title) + "</a>";
    document.body.appendChild(el);
  }

  function initAnalytics() {
    const config = window.SITE_CONFIG.analytics || {};
    if (!config.enabled || !config.scriptUrl) {
      return;
    }

    if (document.querySelector('script[data-analytics="site"]')) {
      return;
    }

    const script = document.createElement("script");
    script.defer = true;
    script.dataset.analytics = "site";
    script.src = config.scriptUrl;
    if (config.provider === "umami" && config.websiteId) {
      script.dataset.websiteId = config.websiteId;
    }
    if (config.provider === "plausible" && config.domain) {
      script.dataset.domain = config.domain;
    }
    document.head.appendChild(script);
  }

  function updateReadingProgress() {
    const progressBar = document.querySelector("[data-reading-progress]");
    const article = document.querySelector("[data-post-article]");
    if (!progressBar || !article) {
      return;
    }

    const rect = article.getBoundingClientRect();
    const total = article.offsetHeight - window.innerHeight;
    const seen = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
    const percent = total > 0 ? (seen / total) * 100 : 0;
    progressBar.style.transform = "scaleX(" + (percent / 100) + ")";
  }

  function initReadingProgress() {
    if (!document.querySelector("[data-reading-progress]")) {
      return;
    }
    updateReadingProgress();
    window.addEventListener("scroll", updateReadingProgress, { passive: true });
  }

  function renderShareButtons(post) {
    const url = absoluteUrl(relativePath("posts/" + post.slug + ".html"));
    const encodedUrl = encodeURIComponent(url);
    const encodedTitle = encodeURIComponent(post.title);
    return [
      '<div class="share-row">',
      '<a class="btn btn-secondary mono" href="https://twitter.com/intent/tweet?url=' + encodedUrl + "&text=" + encodedTitle + '" target="_blank" rel="noreferrer">Share on X</a>',
      '<a class="btn btn-secondary mono" href="https://wa.me/?text=' + encodedTitle + "%20" + encodedUrl + '" target="_blank" rel="noreferrer">WhatsApp</a>',
      '<button class="btn btn-secondary mono" type="button" data-copy-link="' + url + '">Copy link</button>',
      "</div>"
    ].join("");
  }

  function renderHomePage() {
    const grid = document.querySelector("[data-album-grid]");
    if (!grid) {
      return;
    }

    grid.innerHTML = allAlbums().map(function (album, index) {
      return [
        '<a class="album-card js-reveal' + (index === 0 ? " is-featured" : "") + '" href="' + relativePath("albums/" + album.slug + ".html") + '">',
        '<span class="spine-mark" aria-hidden="true"></span>',
        '<div class="album-card-media"><img src="' + album.cover + '" alt="' + escapeHtml(album.title) + '" loading="lazy"></div>',
        '<div class="album-card-body">',
        '<div class="album-card-top">',
        '<div><h3 class="album-card-title">' + escapeHtml(album.title) + '</h3><div class="album-card-artist">' + escapeHtml(album.artist) + '</div></div>',
        '<div class="album-card-price">' + currency(album.price) + "</div>",
        "</div>",
        '<div class="chip-row"><span class="chip mono">' + escapeHtml(String(album.year)) + '</span><span class="chip mono">' + album.tracks.length + ' tracks</span></div>',
        '<div class="album-card-footer"><span class="muted">' + escapeHtml(album.genre) + '</span><span class="mono">Open</span></div>',
        "</div>",
        "</a>"
      ].join("");
    }).join("");

    const count = document.querySelector("[data-album-count]");
    if (count) {
      count.textContent = allAlbums().length + " releases";
    }

    const spotlight = document.querySelector("[data-spotlight-grid]");
    if (spotlight) {
      spotlight.innerHTML = allAlbums().filter(function (album) { return album.featured; }).slice(0, 2).map(function (album) {
        return [
          '<article class="spotlight-card js-reveal">',
          '<div class="mono eyebrow">Featured</div>',
          "<h3>" + escapeHtml(album.title) + "</h3>",
          '<p class="meta-copy">' + escapeHtml(album.artist) + " • " + album.year + "</p>",
          '<div class="button-row"><a class="btn btn-secondary mono" href="' + relativePath("albums/" + album.slug + ".html") + '">Open</a></div>',
          "</article>"
        ].join("");
      }).join("");
    }
  }

  function renderAlbumPage() {
    const host = document.querySelector("[data-album-page]");
    if (!host) {
      return;
    }

    const slug = host.dataset.albumSlug;
    const album = albumBySlug(slug);
    if (!album) {
      host.innerHTML = '<div class="empty-state"><h2>Album not found</h2><a class="btn mono" href="' + relativePath("index.html") + '">Back to catalogue</a></div>';
      return;
    }

    document.title = album.title + " | Stereo Remaster";
    const images = album.gallery && album.gallery.length ? album.gallery : [album.cover];
    const relatedPosts = allPosts().filter(function (post) {
      return post.relatedAlbumSlug === album.slug;
    }).slice(0, 3);

    const purchaseBox = album.released !== false
      ? '<div class="button-row"><button class="btn mono" type="button" data-add-to-cart data-album-id="' + album.id + '">Add to cart</button><a class="btn btn-secondary mono" href="' + relativePath("cart.html") + '">Cart</a></div>'
      : [
          '<div class="notify-box">',
          '<p class="meta-copy">This remaster is not available yet. Join the notify list.</p>',
          '<form class="notify-form" data-notify-form data-album-slug="' + album.slug + '">',
          '<input type="email" name="email" placeholder="Email for release alert" required>',
          '<button class="btn mono" type="submit">Notify me</button>',
          "</form>",
          "</div>"
        ].join("");

    host.innerHTML = [
      '<div class="album-detail-shell">',
      '<div class="album-detail-grid">',
      '<div>',
      '<div class="album-gallery-main"><img data-main-image src="' + images[0] + '" alt="' + escapeHtml(album.title) + '"></div>',
      images.length > 1 ? [
        '<div class="gallery-thumbs">',
        images.map(function (image, index) {
          return '<button class="gallery-thumb' + (index === 0 ? " active" : "") + '" type="button" data-gallery-thumb data-image="' + image + '"><img src="' + image + '" alt="' + escapeHtml(album.title) + " view " + (index + 1) + '"></button>';
        }).join(""),
        "</div>"
      ].join("") : "",
      "</div>",
      "<div>",
      '<div class="album-kicker mono">Stereo remaster</div>',
      '<h1 class="album-title">' + escapeHtml(album.title) + "</h1>",
      '<p class="album-artist">' + escapeHtml(album.artist) + "</p>",
      '<div class="chip-row"><span class="chip mono">' + escapeHtml(album.genre) + '</span><span class="chip mono">' + escapeHtml(String(album.year)) + '</span><span class="chip mono">' + album.tracks.length + ' tracks</span></div>',
      '<dl class="album-meta">',
      '<div class="meta-row"><dt class="mono">Format</dt><dd>' + escapeHtml(album.format) + "</dd></div>",
      '<div class="meta-row"><dt class="mono">Delivery</dt><dd>' + (album.released !== false ? "By email within 24 hours after payment verification." : "Notify list only until the remaster is released.") + "</dd></div>",
      '<div class="meta-row"><dt class="mono">Price</dt><dd>' + currency(album.price) + "</dd></div>",
      "</dl>",
      '<p class="album-notes">' + escapeHtml(album.notes) + "</p>",
      '<div class="tracklist"><div class="mono eyebrow">Tracklist</div>',
      album.tracks.map(function (track, index) {
        return '<div class="track-row"><div class="mono">' + String(index + 1).padStart(2, "0") + '</div><div>' + escapeHtml(track.t) + '</div><div class="muted">' + escapeHtml(track.len || "") + "</div></div>";
      }).join(""),
      "</div>",
      '<div class="album-purchase-bar">',
      '<div><div class="mono muted">Price</div><div class="price-large">' + currency(album.price) + '</div></div>',
      purchaseBox,
      "</div>",
      relatedPosts.length ? [
        '<section class="related-strip">',
        '<div class="mono eyebrow">Related reviews</div>',
        '<div class="related-grid">',
        relatedPosts.map(function (post) {
          return '<a class="related-card" href="' + relativePath("posts/" + post.slug + ".html") + '"><strong>' + escapeHtml(post.title) + '</strong><span>' + escapeHtml(post.excerpt) + "</span></a>";
        }).join(""),
        "</div>",
        "</section>"
      ].join("") : "",
      "</div>",
      "</div>",
      "</div>"
    ].join("");

    host.querySelectorAll("[data-gallery-thumb]").forEach(function (button) {
      button.addEventListener("click", function () {
        const main = host.querySelector("[data-main-image]");
        if (main) {
          main.src = button.dataset.image;
        }
        host.querySelectorAll("[data-gallery-thumb]").forEach(function (thumb) {
          thumb.classList.remove("active");
        });
        button.classList.add("active");
      });
    });

    const notifyForm = host.querySelector("[data-notify-form]");
    if (notifyForm) {
      notifyForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const email = notifyForm.querySelector('input[name="email"]').value.trim();
        await submitEndpointPayload({
          type: "notify",
          ts: new Date().toISOString(),
          albumTitle: album.title,
          albumSlug: album.slug,
          email
        });
        notifyForm.reset();
        notifyForm.insertAdjacentHTML("beforeend", '<div class="notify-confirmation muted">Added to the notify list.</div>');
      });
    }
  }

  function renderBlogPage() {
    const grid = document.querySelector("[data-blog-grid]");
    if (!grid) {
      return;
    }

    const tags = Array.from(new Set(allPosts().flatMap(function (post) { return post.tags || []; })));
    const pageHeading = document.querySelector(".page-heading");
    if (pageHeading && !document.querySelector(".tag-filter")) {
      const filter = document.createElement("div");
      filter.className = "tag-filter";
      filter.innerHTML = ['<button class="chip mono is-active" type="button" data-tag-filter="">All</button>']
        .concat(tags.map(function (tag) {
          return '<button class="chip mono" type="button" data-tag-filter="' + escapeHtml(tag) + '">' + escapeHtml(tag) + "</button>";
        }))
        .join("");
      pageHeading.appendChild(filter);
    }

    function paint(filterTag) {
      const posts = allPosts().filter(function (post) {
        return !filterTag || (post.tags || []).includes(filterTag);
      });
      if (!posts.length) {
        grid.innerHTML = '<article class="empty-state"><h2>No posts yet</h2><p class="meta-copy">The review journal is ready whenever you publish from the CMS.</p></article>';
        return;
      }
      grid.innerHTML = posts.map(function (post) {
        return [
          '<article class="blog-card js-reveal">',
          '<a class="blog-card-link" href="' + relativePath("posts/" + post.slug + ".html") + '">',
          '<div class="blog-cover"><img src="' + post.cover + '" alt="' + escapeHtml(post.title) + '" loading="lazy"></div>',
          '<div class="mono eyebrow">' + formatDate(post.date) + " • " + post.readingTime + ' min read</div>',
          "<h3>" + escapeHtml(post.title) + "</h3>",
          '<p class="meta-copy">' + escapeHtml(post.excerpt) + "</p>",
          '<div class="chip-row">' + (post.tags || []).map(function (tag) { return '<span class="chip mono">' + escapeHtml(tag) + "</span>"; }).join("") + "</div>",
          "</a>",
          "</article>"
        ].join("");
      }).join("");
      initRevealObserver();
    }

    paint("");

    document.querySelectorAll("[data-tag-filter]").forEach(function (button) {
      button.addEventListener("click", function () {
        document.querySelectorAll("[data-tag-filter]").forEach(function (el) {
          el.classList.remove("is-active");
        });
        button.classList.add("is-active");
        paint(button.dataset.tagFilter || "");
      });
    });

  }

  function renderPostPage() {
    const host = document.querySelector("[data-post-page]");
    if (!host) {
      return;
    }

    const slug = host.dataset.postSlug;
    const post = postBySlug(slug);
    if (!post) {
      host.innerHTML = '<div class="empty-state"><h2>Post not found</h2><a class="btn mono" href="' + relativePath("blog.html") + '">Back to blog</a></div>';
      return;
    }

    const relatedPosts = (post.relatedPostSlugs || []).map(postBySlug).filter(Boolean).slice(0, 3);
    const relatedAlbum = albumBySlug(post.relatedAlbumSlug || "");

    host.innerHTML = [
      '<div class="reading-progress"><span data-reading-progress></span></div>',
      '<article class="post-shell" data-post-article>',
      '<div class="mono eyebrow">' + formatDate(post.date) + " • " + post.readingTime + ' min read</div>',
      '<h1 class="post-title">' + escapeHtml(post.title) + "</h1>",
      '<p class="post-excerpt">' + escapeHtml(post.excerpt) + "</p>",
      '<div class="chip-row">' + (post.tags || []).map(function (tag) { return '<span class="chip mono">' + escapeHtml(tag) + "</span>"; }).join("") + "</div>",
      post.cover ? '<div class="post-cover"><img src="' + post.cover + '" alt="' + escapeHtml(post.title) + '" loading="eager"></div>' : "",
      renderShareButtons(post),
      '<div class="post-body prose">' + post.html + "</div>",
      relatedAlbum ? '<a class="related-album-link" href="' + relativePath("albums/" + relatedAlbum.slug + ".html") + '">Related album: ' + escapeHtml(relatedAlbum.title) + "</a>" : "",
      relatedPosts.length ? [
        '<section class="related-posts">',
        '<div class="mono eyebrow">Related posts</div>',
        '<div class="related-grid">',
        relatedPosts.map(function (item) {
          return '<a class="related-card" href="' + relativePath("posts/" + item.slug + ".html") + '"><strong>' + escapeHtml(item.title) + '</strong><span>' + escapeHtml(item.excerpt) + "</span></a>";
        }).join(""),
        "</div>",
        "</section>"
      ].join("") : "",
      "</article>"
    ].join("");

    host.querySelectorAll("[data-copy-link]").forEach(function (button) {
      button.addEventListener("click", function () {
        navigator.clipboard.writeText(button.dataset.copyLink).then(function () {
          const original = button.textContent;
          button.textContent = "Copied";
          window.setTimeout(function () {
            button.textContent = original;
          }, 1100);
        });
      });
    });

    initReadingProgress();
  }

  function renderCartPage() {
    const list = document.querySelector("[data-cart-list]");
    const summary = document.querySelector("[data-cart-summary]");
    if (!list || !summary) {
      return;
    }

    const totals = cartTotals();
    if (!totals.items.length) {
      list.innerHTML = '<div class="empty-state"><h2>Your cart is empty</h2><a class="btn mono" href="' + relativePath("index.html") + '">Browse catalogue</a></div>';
      summary.innerHTML = [
        "<h2>Order summary</h2>",
        '<p class="meta-copy">Add albums to begin.</p>'
      ].join("");
      return;
    }

    list.innerHTML = totals.items.map(function (entry) {
      const album = entry.album;
      return [
        '<article class="cart-item">',
        '<div class="cart-item-cover"><img src="' + album.cover + '" alt="' + escapeHtml(album.title) + '"></div>',
        "<div>",
        '<h3 class="cart-item-title">' + escapeHtml(album.title) + '</h3>',
        '<div class="meta-copy">' + escapeHtml(album.artist) + "</div>",
        '<div class="cart-actions" style="margin-top:0.9rem;">',
        '<div class="quantity-controls"><button type="button" data-qty-change data-album-id="' + album.id + '" data-direction="-1">-</button><span>' + entry.quantity + '</span><button type="button" data-qty-change data-album-id="' + album.id + '" data-direction="1">+</button></div>',
        '<button class="btn btn-secondary mono" type="button" data-remove-item data-album-id="' + album.id + '">Remove</button>',
        '<a class="link-inline" href="' + relativePath("albums/" + album.slug + ".html") + '">Open album page</a>',
        "</div>",
        "</div>",
        '<div class="amount">' + currency(album.price * entry.quantity) + "</div>",
        "</article>"
      ].join("");
    }).join("");

    summary.innerHTML = [
      "<h2>Order summary</h2>",
      '<div class="summary-row"><span>Albums</span><span>' + cartCount() + "</span></div>",
      '<div class="summary-row"><span>Subtotal</span><span>' + currency(totals.subtotal) + "</span></div>",
      '<div class="summary-row summary-strong"><span>Total</span><span>' + currency(totals.total) + "</span></div>",
      '<div class="button-row" style="margin-top:1rem;"><a class="btn mono" href="' + relativePath("checkout.html") + '">Checkout</a><button class="btn btn-secondary mono" type="button" data-clear-cart>Clear</button></div>'
    ].join("");
  }

  function renderCheckoutPage() {
    const summary = document.querySelector("[data-checkout-summary]");
    const payment = document.querySelector("[data-payment-box]");
    const form = document.querySelector("[data-checkout-form]");
    if (!summary || !payment || !form) {
      return;
    }

    const totals = cartTotals();
    if (!totals.items.length) {
      window.location.href = relativePath("cart.html");
      return;
    }

    summary.innerHTML = [
      "<h2>Order summary</h2>",
      '<div class="order-list">',
      totals.items.map(function (entry) {
        return '<div class="summary-row"><span>' + escapeHtml(entry.album.title) + " x" + entry.quantity + '</span><span>' + currency(entry.album.price * entry.quantity) + "</span></div>";
      }).join(""),
      "</div>",
      '<div class="checkout-totals"><div><div class="mono muted">Total</div><div class="price-large">' + currency(totals.total) + '</div></div><div class="muted">Single payment.</div></div>'
    ].join("");

    payment.innerHTML = [
      '<div class="qr-box">',
      window.SITE_CONFIG.upiQrUrl ? '<img src="' + window.SITE_CONFIG.upiQrUrl + '" alt="UPI QR code">' : '<div class="mono muted">Add your UPI QR image</div>',
      "</div>",
      "<div>",
      '<div class="mono muted">UPI</div>',
      '<p class="lede">Pay the total and submit the transaction details.</p>',
      '<div class="upi-box"><span>' + window.SITE_CONFIG.upiId + '</span><button class="copy-btn mono" type="button" data-copy-upi>Copy</button></div>',
      '<div class="amount">Amount due: ' + currency(totals.total) + "</div>",
      "</div>"
    ].join("");

    const copyButton = document.querySelector("[data-copy-upi]");
    if (copyButton) {
      copyButton.addEventListener("click", copyUpi);
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      const original = submit.textContent;
      submit.disabled = true;
      submit.textContent = "Submitting...";

      const order = {
        ref: "SR-" + Date.now().toString(36).toUpperCase(),
        ts: new Date().toISOString(),
        items: totals.items.map(function (entry) {
          return {
            id: entry.album.id,
            title: entry.album.title,
            quantity: entry.quantity,
            price: entry.album.price
          };
        }),
        albumTitle: albumSummary(totals.items),
        price: totals.total,
        total: totals.total,
        txn: document.getElementById("f-txn").value.trim(),
        email: document.getElementById("f-email").value.trim(),
        phone: document.getElementById("f-phone").value.trim(),
        notes: document.getElementById("f-notes").value.trim(),
        status: "pending"
      };

      saveOrder(order);
      writeJson(SUCCESS_KEY, order);
      await submitEndpointPayload(order);

      clearCart();
      form.reset();
      submit.disabled = false;
      submit.textContent = original;
      window.location.href = relativePath("success.html");
    }, { once: true });
  }

  function renderSuccessPage() {
    const host = document.querySelector("[data-success-card]");
    if (!host) {
      return;
    }

    const order = readJson(SUCCESS_KEY, null);
    if (!order) {
      host.innerHTML = [
        '<div class="success-badge">!</div>',
        "<h1>No recent <em>order</em> found</h1>",
        '<a class="btn mono" href="' + relativePath("index.html") + '">Back to catalogue</a>'
      ].join("");
      return;
    }

    host.innerHTML = [
      '<div class="success-badge">OK</div>',
      '<div class="mono eyebrow">Order received</div>',
      '<h1>Order <em>received</em></h1>',
      '<p class="meta-copy">Delivery to <strong>' + escapeHtml(order.email) + "</strong> after verification.</p>",
      '<div class="summary-card" style="margin-top:1.25rem; text-align:left;">',
      '<div class="summary-row"><span>Reference</span><span>' + escapeHtml(order.ref) + "</span></div>",
      '<div class="summary-row"><span>Total</span><span>' + currency(order.total) + "</span></div>",
      '<div class="summary-row"><span>Albums</span><span>' + order.items.map(function (item) { return escapeHtml(item.title) + " x" + item.quantity; }).join(", ") + "</span></div>",
      "</div>",
      '<div class="button-row" style="justify-content:center; margin-top:1.25rem;"><a class="btn mono" href="' + relativePath("index.html") + '">Catalogue</a><a class="btn btn-secondary mono" href="' + relativePath("blog.html") + '">Blog</a></div>'
    ].join("");
  }

  function renderOrdersPage() {
    const host = document.querySelector("[data-orders-list]");
    if (!host) {
      return;
    }

    const list = orders().slice().reverse();
    if (!list.length) {
      host.innerHTML = '<div class="empty-state"><h2>No orders yet</h2></div>';
      return;
    }

    host.innerHTML = list.map(function (order) {
      return [
        '<article class="order-row">',
        '<div><div class="mono">' + new Date(order.ts).toLocaleDateString("en-IN") + '</div><div class="muted">' + escapeHtml(order.ref) + "</div></div>",
        "<div>" + order.items.map(function (item) { return escapeHtml(item.title) + " x" + item.quantity; }).join("<br>") + "</div>",
        "<div>" + escapeHtml(order.email) + "<br><span class=\"muted\">" + escapeHtml(order.phone) + "</span></div>",
        '<div><div class="mono">' + escapeHtml(order.txn) + "</div><div class=\"muted\">" + currency(order.total) + "</div></div>",
        '<div><span class="status-pill ' + (order.status === "sent" ? "done" : "") + '">' + escapeHtml(order.status) + '</span><div class="button-row" style="margin-top:0.65rem;"><button class="btn btn-secondary mono" type="button" data-toggle-order="' + order.ref + '">Toggle</button></div></div>',
        "</article>"
      ].join("");
    }).join("");

    host.querySelectorAll("[data-toggle-order]").forEach(function (button) {
      button.addEventListener("click", function () {
        markOrder(button.dataset.toggleOrder);
      });
    });
  }

  function bindGlobalActions() {
    document.addEventListener("click", function (event) {
      const addButton = event.target.closest("[data-add-to-cart]");
      if (addButton) {
        const id = addButton.dataset.albumId;
        addToCart(id, 1);
        addButton.textContent = "Added";
        window.setTimeout(function () {
          addButton.textContent = "Add to cart";
        }, 900);
        return;
      }

      const qtyButton = event.target.closest("[data-qty-change]");
      if (qtyButton) {
        const id = qtyButton.dataset.albumId;
        const delta = Number(qtyButton.dataset.direction);
        const current = cart().find(function (item) { return item.id === id; });
        const next = (current ? current.quantity : 0) + delta;
        setCartQuantity(id, next);
        renderCartPage();
        return;
      }

      const removeButton = event.target.closest("[data-remove-item]");
      if (removeButton) {
        removeFromCart(removeButton.dataset.albumId);
        renderCartPage();
        return;
      }

      const clearButton = event.target.closest("[data-clear-cart]");
      if (clearButton) {
        clearCart();
        renderCartPage();
        return;
      }

      const exportButton = event.target.closest("[data-export-orders]");
      if (exportButton) {
        exportOrdersCsv();
        return;
      }

      const clearOrdersButton = event.target.closest("[data-clear-orders]");
      if (clearOrdersButton) {
        if (window.confirm("Clear all stored orders? This cannot be undone.")) {
          saveOrders([]);
          renderOrdersPage();
        }
      }
    });
  }

  async function init() {
    applyTheme(preferredTheme());
    await loadContent();
    injectThemeToggle();
    setActiveNav();
    updateCartBadges();
    bindGlobalActions();
    initPageTransitions();
    initAnalytics();
    injectSearchUI();
    injectNowSpinning();
    renderHomePage();
    renderAlbumPage();
    renderBlogPage();
    renderPostPage();
    renderCartPage();
    renderCheckoutPage();
    renderSuccessPage();
    renderOrdersPage();
    initRevealObserver();
  }

  document.addEventListener("DOMContentLoaded", function () {
    init().catch(function (error) {
      console.error("Site init failed:", error);
    });
  });
})();
