// notifications.js
// Full working Notifications module (separate file)
//
// Exports: renderNotifications(host)
//
// REQUIREMENTS:
// - firebase.js exports: auth, db
// - ui.js exports: $, toast, safe, timeAgo, avatarHTML (if you don't have some, this file includes fallbacks)
// - Firestore structure used:
//   notifications/{uid}/items/{notifId}
//   fields: type ("like"|"comment"|"follow"|"system"), fromUid, fromUsername, postId, textPreview, createdAt, read
//
// Notes:
// - Marks notifications as read when rendered
// - Click on a notification tries to route to a post or user (via CustomEvent)

import { auth, db } from "./firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---- light fallbacks (if ui.js doesn't export these) ----
function $(sel) {
  return document.querySelector(sel);
}
function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return alert(msg);
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
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
function timeAgo(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}
function initials(name) {
  const t = (name || "").trim();
  if (!t) return "U";
  const parts = t.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0].slice(0, 1) + parts[1].slice(0, 1)).toUpperCase();
}
function avatarHTML(user, size = 42) {
  const photo = user?.photoURL || "";
  const username = user?.username || "user";
  const display = user?.displayName || username;
  const ini = initials(display);
  const inner = photo
    ? `<img src="${safe(photo)}" alt="avatar">`
    : `<span style="font-weight:900">${safe(ini)}</span>`;
  return `<div class="avatar" style="width:${size}px;height:${size}px">${inner}</div>`;
}

// ---- module state ----
let unsubNotifs = null;

function closeOldListener() {
  if (unsubNotifs) {
    unsubNotifs();
    unsubNotifs = null;
  }
}

function notifLine(n) {
  const type = n?.type || "system";
  if (type === "like") return `liked your post`;
  if (type === "comment")
    return `commented: "${safe((n.textPreview || "").slice(0, 90))}"`;
  if (type === "follow") return `started following you`;
  return safe(n?.message || "notification");
}

function notifIcon(type) {
  if (type === "like") return "♥️";
  if (type === "comment") return "💬";
  if (type === "follow") return "➕";
  return "🔔";
}

async function fetchUsersMap(uids) {
  const map = {};
  const snaps = await Promise.all(
    uids.map((uid) => getDoc(doc(db, "users", uid)))
  );
  snaps.forEach((s, i) => {
    if (s.exists()) map[uids[i]] = s.data();
  });
  return map;
}

async function markAllRead(uid, notifs) {
  try {
    const unread = notifs.filter((n) => !n.read);
    if (!unread.length) return;
    const batch = writeBatch(db);
    unread.forEach((n) => {
      const ref = doc(db, "notifications", uid, "items", n.id);
      batch.update(ref, { read: true, readAt: serverTimestamp() });
    });
    await batch.commit();
  } catch {
    // ignore
  }
}

function wireClicks(container) {
  container.querySelectorAll("[data-openuser]").forEach((el) => {
    if (el.__wired) return;
    el.__wired = true;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const uid = el.getAttribute("data-openuser");
      if (!uid) return;
      window.dispatchEvent(new CustomEvent("open-user", { detail: { uid } }));
    });
  });

  container.querySelectorAll("[data-openpost]").forEach((el) => {
    if (el.__wired) return;
    el.__wired = true;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const postId = el.getAttribute("data-openpost");
      if (!postId) return;
      window.dispatchEvent(new CustomEvent("open-post", { detail: { postId } }));
    });
  });
}

export function renderNotifications(host) {
  const user = auth.currentUser;
  if (!user) {
    closeOldListener();
    host.innerHTML = `
      <div class="card">
        <div class="title">Notifications</div>
        <div class="divider"></div>
        <div class="muted">You are not signed in.</div>
      </div>
    `;
    return;
  }

  host.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div>
          <div class="title">Notifications</div>
          <div class="muted small">Real-time updates</div>
        </div>
        <div class="pill">Live</div>
      </div>

      <div class="divider" style="margin:12px 0"></div>

      <div id="notifList" class="grid">
        <div class="muted small">Loading…</div>
      </div>
    </div>
  `;

  const listEl = host.querySelector("#notifList");
  if (!listEl) {
    toast("Missing #notifList");
    return;
  }

  closeOldListener();

  const qN = query(
    collection(db, "notifications", user.uid, "items"),
    orderBy("createdAt", "desc"),
    limit(60)
  );

  unsubNotifs = onSnapshot(
    qN,
    async (snap) => {
      try {
        const notifs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        if (!notifs.length) {
          listEl.innerHTML = `<div class="muted small">No notifications yet.</div>`;
          return;
        }

        const uids = [
          ...new Set(notifs.map((n) => n.fromUid).filter(Boolean)),
        ];
        const usersMap = uids.length ? await fetchUsersMap(uids) : {};

        listEl.innerHTML = notifs
          .map((n) => {
            const from =
              usersMap[n.fromUid] || {
                uid: n.fromUid || "",
                username: n.fromUsername || "user",
                displayName: n.fromUsername || "user",
                photoURL: "",
                verified: false,
              };

            const when = n.createdAt ? timeAgo(n.createdAt) : "";
            const line = notifLine(n);
            const type = n.type || "system";
            const unread = !n.read;

            const openUserAttr = safe(from.uid || n.fromUid || "");
            const openPostAttr = safe(n.postId || "");

            // if it's a post-related notif, clicking opens post; else opens user
            const clickAttr =
              openPostAttr && (type === "like" || type === "comment")
                ? `data-openpost="${openPostAttr}"`
                : `data-openuser="${openUserAttr}"`;

            return `
              <div class="card linkish" ${clickAttr} style="background:rgba(20,24,34,.55)">
                <div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px">
                  <div class="row" style="align-items:flex-start;gap:10px;min-width:0">
                    ${avatarHTML(from, 42)}
                    <div style="min-width:0">
                      <div style="font-weight:900;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                        <span>${safe(from.username || "user")}</span>
                        ${
                          from.verified
                            ? `<span class="verified">✓</span>`
                            : ``
                        }
                        <span class="pill" style="padding:3px 8px">${notifIcon(
                          type
                        )} ${safe(type)}</span>
                        ${
                          unread
                            ? `<span class="pill" style="padding:3px 8px;border-color:rgba(79,124,255,.6)">NEW</span>`
                            : ``
                        }
                      </div>
                      <div class="muted small" style="margin-top:4px;white-space:pre-wrap">${line}</div>
                    </div>
                  </div>
                  <div class="muted small" style="white-space:nowrap">${when}</div>
                </div>
              </div>
            `;
          })
          .join("");

        wireClicks(listEl);
        markAllRead(user.uid, notifs);
      } catch (e) {
        console.error(e);
        listEl.innerHTML = `<div class="muted small">Notifications render error: ${safe(
          e?.message || e
        )}</div>`;
      }
    },
    (err) => {
      console.error(err);
      listEl.innerHTML = `<div class="muted small">Failed to load notifications: ${safe(
        err?.message || err
      )}</div>`;
    }
  );
}
