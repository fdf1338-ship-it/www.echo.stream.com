/* ui.js (FULL — shared helpers)
   Put this file at:
   app/src/main/assets/ui.js
*/

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escapeHtml(str) {
  return (str ?? "")
    .toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function safe(str) {
  return escapeHtml(str);
}

export function toast(msg, ms = 2200) {
  const id = "toast__echostream";
  let el = document.getElementById(id);

  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.style.cssText = `
      position:fixed;
      left:50%;
      transform:translateX(-50%);
      bottom:86px;
      max-width:min(680px,92vw);
      z-index:99999;
      background:rgba(23,28,39,.95);
      color:#e9edf7;
      border:1px solid rgba(39,48,71,.85);
      padding:10px 12px;
      border-radius:14px;
      box-shadow:0 10px 30px rgba(0,0,0,.35);
      display:none;
      font:14px system-ui;
    `;
    document.body.appendChild(el);
  }

  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(el.__t);
  el.__t = setTimeout(() => {
    el.style.display = "none";
  }, ms);
}

/* Simple modal system (optional) */
export function ensureModal() {
  if (document.getElementById("modalBackdrop")) return;

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div id="modalBackdrop" style="
      position:fixed;inset:0;z-index:99998;
      background:rgba(0,0,0,.6);
      display:none;align-items:center;justify-content:center;
      padding:16px;">
      <div id="modal" style="
        width:min(720px,94vw);
        max-height:min(80vh,720px);
        overflow:auto;
        background:rgba(20,24,34,.98);
        border:1px solid rgba(39,48,71,.85);
        border-radius:18px;
        box-shadow:0 10px 30px rgba(0,0,0,.35);
        padding:14px;">
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  const backdrop = document.getElementById("modalBackdrop");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
}

export function openModal(html) {
  ensureModal();
  const backdrop = document.getElementById("modalBackdrop");
  const modal = document.getElementById("modal");
  modal.innerHTML = html;
  backdrop.style.display = "flex";
}

export function closeModal() {
  const backdrop = document.getElementById("modalBackdrop");
  const modal = document.getElementById("modal");
  if (!backdrop || !modal) return;
  backdrop.style.display = "none";
  modal.innerHTML = "";
}

/* Tiny UI builders */
export function card(title, innerHtml) {
  return `
    <div class="card">
      ${title ? `<div class="title">${escapeHtml(title)}</div><div class="divider"></div>` : ``}
      ${innerHtml || ""}
    </div>
  `;
}

export function avatarHTML(user, size = 44) {
  const photo = user?.photoURL || "";
  const name = user?.displayName || user?.username || "User";
  const ini = initials(name);

  const inner = photo
    ? `<img src="${escapeHtml(photo)}" alt="avatar" style="width:100%;height:100%;object-fit:cover" />`
    : `<span style="font-weight:900">${escapeHtml(ini)}</span>`;

  return `
    <div class="avatar" style="
      width:${size}px;height:${size}px;border-radius:999px;
      background:rgba(39,48,71,.8);
      border:1px solid rgba(39,48,71,.9);
      display:grid;place-items:center;overflow:hidden;flex:0 0 auto;">
      ${inner}
    </div>
  `;
}

function initials(name) {
  const t = (name || "").trim();
  if (!t) return "U";
  const parts = t.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0].slice(0, 1) + parts[1].slice(0, 1)).toUpperCase();
}

export function timeAgo(ts) {
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
