/* app.js (FULL — modular router, separate files, NO black screen)
   Put this file at:
   app/src/main/assets/app.js

   index.html should include ONLY:
   <script type="module" src="./app.js"></script>

   Required files (same folder):
   firebase.js
   auth.js
   feed.js
   search.js
   notifications.js
   profile.js
   settings.js
   ui.js (optional)
*/

import { auth, db, storage } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

// Pages (each MUST export exactly these names)
import { renderAuth } from "./auth.js";
import { renderFeed } from "./feed.js";
import { renderSearch } from "./search.js";
import { renderNotifications } from "./notifications.js";
import { renderProfile } from "./profile.js";
import { renderSettings } from "./settings.js";

// Optional ui.js helpers (safe if missing)
let ui = {};
try {
  ui = await import("./ui.js");
} catch (e) {
  ui = {};
}

// Helpers (fallbacks if ui.js missing)
const $ = ui.$ || ((sel, root = document) => root.querySelector(sel));
const $$ = ui.$$ || ((sel, root = document) => Array.from(root.querySelectorAll(sel)));
const toast =
  ui.toast ||
  ((msg) => {
    console.log("[toast]", msg);
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText =
      "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);background:rgba(20,24,34,.96);color:#fff;padding:10px 12px;border-radius:12px;z-index:999999;font:14px system-ui;border:1px solid rgba(255,255,255,.12)";
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  });

/* ---------------------------
   Global State
--------------------------- */
const state = {
  user: null,
  page: "home", // home|search|alerts|profile|settings|auth
};

/* ---------------------------
   Routes
--------------------------- */
const ROUTES = {
  home: { title: "Feed", render: renderFeed, authRequired: true },
  search: { title: "Search", render: renderSearch, authRequired: true },
  alerts: { title: "Notifications", render: renderNotifications, authRequired: true },
  profile: { title: "Profile", render: renderProfile, authRequired: true },
  settings: { title: "Settings", render: renderSettings, authRequired: true },
  auth: { title: "Login", render: renderAuth, authRequired: false },
};

/* ---------------------------
   Boot
--------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  // IMPORTANT: do NOT overwrite body here — index.html already contains UI.
  // We only wire events and render into #app

  wireNav();
  wireDrawer();
  wireHashRouter();
  startAuthListener();

  // First render
  render();
});

/* ---------------------------
   Navigation wiring
--------------------------- */
function wireNav() {
  // Bottom tabs + drawer links: data-nav="home|search|alerts|profile|settings"
  $$("[data-nav]").forEach((el) => {
    if (el.__wired) return;
    el.__wired = true;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const page = el.getAttribute("data-nav");
      navigate(page);
      closeDrawer();
    });
  });

  // Gear button -> settings
  const gearBtn = $("#gearBtn");
  if (gearBtn && !gearBtn.__wired) {
    gearBtn.__wired = true;
    gearBtn.addEventListener("click", () => navigate("settings"));
  }
}

/* ---------------------------
   Drawer
--------------------------- */
function wireDrawer() {
  const menuBtn = $("#menuBtn");
  const closeBtn = $("#closeDrawerBtn");
  const drawer = $("#drawer");
  const logoutBtn = $("#logoutBtn");

  if (menuBtn && !menuBtn.__wired) {
    menuBtn.__wired = true;
    menuBtn.addEventListener("click", () => {
      if (!drawer) return;
      drawer.classList.contains("open") ? closeDrawer() : openDrawer();
    });
  }

  if (closeBtn && !closeBtn.__wired) {
    closeBtn.__wired = true;
    closeBtn.addEventListener("click", closeDrawer);
  }

  // Tap outside drawer closes it
  if (drawer && !drawer.__outsideWired) {
    drawer.__outsideWired = true;
    document.addEventListener("click", (e) => {
      if (!drawer.classList.contains("open")) return;
      const isInside = drawer.contains(e.target) || e.target === menuBtn;
      if (!isInside) closeDrawer();
    });
  }

  // Logout
  if (logoutBtn && !logoutBtn.__wired) {
    logoutBtn.__wired = true;
    logoutBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await signOut(auth);
        toast("Logged out");
        navigate("auth");
      } catch (err) {
        toast(String(err?.message || err));
      }
    });
  }
}

function openDrawer() {
  const drawer = $("#drawer");
  if (drawer) drawer.classList.add("open");
}
function closeDrawer() {
  const drawer = $("#drawer");
  if (drawer) drawer.classList.remove("open");
}

/* ---------------------------
   Hash Router
--------------------------- */
function wireHashRouter() {
  window.addEventListener("hashchange", () => {
    const page = (location.hash || "#home").replace("#", "");
    if (ROUTES[page]) {
      state.page = page;
      render();
    }
  });

  if (!location.hash) location.hash = "#home";
}

/* ---------------------------
   Auth Listener
--------------------------- */
function startAuthListener() {
  onAuthStateChanged(auth, (user) => {
    state.user = user || null;

    // If not logged in -> force auth page
    if (!state.user) {
      if (state.page !== "auth") {
        state.page = "auth";
        location.hash = "#auth";
      }
      render();
      return;
    }

    // If logged in and on auth -> go home
    if (state.page === "auth") {
      state.page = "home";
      location.hash = "#home";
    }

    render();
  });
}

/* ---------------------------
   Navigation API
--------------------------- */
function navigate(page) {
  if (!ROUTES[page]) page = "home";
  state.page = page;
  location.hash = `#${page}`;
  render();
}

/* ---------------------------
   Render
--------------------------- */
async function render() {
  const host = $("#app");
  if (!host) {
    console.error("Missing #app in index.html");
    return;
  }

  // If route requires auth and no user -> auth page
  const route = ROUTES[state.page] || ROUTES.home;
  if (route.authRequired && !state.user) {
    state.page = "auth";
  }

  setActiveTab(state.page);

  // Render safely (no black screen)
  await safeRender(state.page, host);
}

async function safeRender(page, host) {
  const route = ROUTES[page] || ROUTES.home;

  try {
    // Each page render(host, ctx)
    // ctx includes everything a page needs without globals
    await route.render(host, {
      auth,
      db,
      storage,
      user: state.user,
      state,
      navigate,
      toast,
      $,
      $$,
    });
  } catch (e) {
    console.error(e);
    host.innerHTML = `
      <div class="card" style="border:1px solid rgba(255,0,0,.35);background:rgba(80,0,0,.15)">
        <div style="font-weight:900;margin-bottom:6px">App crashed (JS error)</div>
        <div style="font-size:12px;opacity:.85">${escapeHtml(String(e?.message || e))}</div>
        <div style="font-size:12px;opacity:.7;margin-top:10px">
          Usually this means: missing file, wrong import path, or the file does not export the required function name.
        </div>
      </div>
    `;
  }
}

/* ---------------------------
   UI helpers
--------------------------- */
function setActiveTab(page) {
  $$(".tab").forEach((t) => {
    t.classList.toggle("active", t.getAttribute("data-nav") === page);
  });
}

/* ---------------------------
   Utils
--------------------------- */
function escapeHtml(str) {
  return (str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ---------------------------
   Debug
--------------------------- */
window.Echo = {
  navigate,
  get user() {
    return state.user;
  },
  get page() {
    return state.page;
  },
};
