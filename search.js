// search.js
// SEARCH (Users + Posts)

import { db } from "./firebase.js";

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- HELPERS ----------
function el(id) {
  return document.getElementById(id);
}

function safe(s) {
  return (s ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- USER CARD ----------
function userCard(u) {
  return `
    <div class="card">
      <div style="font-weight:900">@${safe(u.username || "user")}</div>
      <div class="muted small">${safe(u.displayName || "")}</div>
      <div class="muted small">${safe(u.bio || "")}</div>
    </div>
  `;
}

// ---------- POST CARD ----------
function postCard(p) {
  return `
    <div class="card">
      <div style="font-weight:900">@${safe(p.username || "user")}</div>
      <div style="margin-top:6px;white-space:pre-wrap">
        ${safe(p.text || "")}
      </div>
    </div>
  `;
}

// ---------- MAIN RENDER ----------
export function renderSearch() {
  const host = el("app");
  if (!host) return;

  host.innerHTML = `
    <div class="card">
      <div class="title">Search</div>
      <div class="divider"></div>

      <input
        id="searchInput"
        placeholder="Search users or posts…"
      />

      <div class="divider"></div>

      <div id="searchResults" class="grid">
        <div class="muted small">Type to search.</div>
      </div>
    </div>
  `;

  const input = el("searchInput");
  const results = el("searchResults");

  if (!input || !results) return;

  let lastTerm = "";

  input.addEventListener("input", async () => {
    const term = input.value.trim().toLowerCase();
    if (term === lastTerm) return;
    lastTerm = term;

    if (!term) {
      results.innerHTML = `<div class="muted small">Type to search.</div>`;
      return;
    }

    results.innerHTML = `<div class="muted small">Searching…</div>`;

    try {
      // ---- SEARCH USERS ----
      const uq = query(
        collection(db, "users"),
        orderBy("username"),
        where("username", ">=", term),
        where("username", "<=", term + "\uf8ff"),
        limit(10)
      );

      const uSnap = await getDocs(uq);
      const users = uSnap.docs.map((d) => d.data());

      // ---- SEARCH POSTS ----
      const pq = query(
        collection(db, "posts"),
        orderBy("text"),
        where("text", ">=", term),
        where("text", "<=", term + "\uf8ff"),
        limit(10)
      );

      const pSnap = await getDocs(pq);
      const posts = pSnap.docs.map((d) => d.data());

      if (!users.length && !posts.length) {
        results.innerHTML = `<div class="muted small">No results.</div>`;
        return;
      }

      let html = "";

      if (users.length) {
        html += `<div class="pill">Users</div>`;
        html += users.map(userCard).join("");
      }

      if (posts.length) {
        html += `<div class="pill">Posts</div>`;
        html += posts.map(postCard).join("");
      }

      results.innerHTML = html;
    } catch (e) {
      console.error(e);
      results.innerHTML = `<div class="muted small">Search failed.</div>`;
    }
  });
}
