/* feed.js (FULL — posts + image upload + likes + comments modal + delete own post)
   Put this file at:
   app/src/main/assets/feed.js

   Requires:
   - firebase.js exports: db, storage
   - Firestore collections used:
     posts (docs: {uid, username, displayName, verified, photoURL, text, imageURL, likeCount, commentCount, createdAt})
     posts/{postId}/likes/{uid}
     posts/{postId}/comments/{commentId}
*/

import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  limit,
  query,
  where,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  increment,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

/* -------------------------------------------------------
   Public API expected by app.js
------------------------------------------------------- */
export async function renderFeed(host, ctx) {
  const { db, storage, user, navigate, toast, $, $$ } = ctx;

  if (!user) {
    host.innerHTML = `<div class="card"><div class="title">Feed</div><div class="muted small">Please log in.</div></div>`;
    return;
  }

  // Layout
  host.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div>
          <div class="title">Feed</div>
          <div class="muted small">Latest posts (real-time)</div>
        </div>
        <button class="btn primary" id="btnNewPost">＋ Post</button>
      </div>

      <div class="divider"></div>

      <div id="feedList" class="grid">
        <div class="muted small">Loading…</div>
      </div>
    </div>

    ${modalHTML()}
  `;

  const listEl = $("#feedList", host) || document.getElementById("feedList");
  if (!listEl) {
    // Prevent the exact black-screen error you got
    host.innerHTML = `<div class="card"><div class="title">Feed</div><div class="muted small">Missing #feedList element.</div></div>`;
    return;
  }

  // Modal wires
  wireModal(ctx);

  // New post button
  const btnNew = document.getElementById("btnNewPost");
  if (btnNew) {
    btnNew.onclick = () => openPostModal(ctx);
  }

  // Real-time feed
  const qFeed = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(60));
  const unsub = onSnapshot(
    qFeed,
    async (snap) => {
      const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      if (!posts.length) {
        listEl.innerHTML = `<div class="muted small">No posts yet. Tap “＋ Post”.</div>`;
        return;
      }

      listEl.innerHTML = posts.map((p) => postCardHTML(p, user.uid)).join("");

      // Wire interactions
      wirePostActions(ctx, posts);
      await markLikedStates(ctx, posts);
    },
    (err) => {
      console.error(err);
      listEl.innerHTML = `<div class="muted small">Feed load error: ${escapeHtml(err?.message || String(err))}</div>`;
    }
  );

  // If you later add page-level cleanup, you can store unsub in ctx.state.
  // For now: it stays active while app runs.
}

/* -------------------------------------------------------
   Post creation
------------------------------------------------------- */
function openPostModal(ctx) {
  const { toast } = ctx;
  const b = document.getElementById("modalBackdrop");
  const m = document.getElementById("modal");
  if (!b || !m) {
    toast("Modal missing in index.html");
    return;
  }

  m.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <div class="title">Create post</div>
      <button class="btn" id="mClose">Close</button>
    </div>
    <div class="divider"></div>

    <textarea id="pText" placeholder="What’s happening?"></textarea>

    <div class="divider"></div>

    <div>
      <div class="small muted">Optional image</div>
      <input id="pImg" type="file" accept="image/*" />
      <div class="hint">Select an image (uploads to Firebase Storage).</div>
    </div>

    <div class="divider"></div>

    <div class="row" style="justify-content:flex-end">
      <button class="btn primary" id="pSend">Post</button>
    </div>
  `;

  b.classList.add("open");

  document.getElementById("mClose").onclick = closeModal;
  document.getElementById("pSend").onclick = () => submitPost(ctx);
}

async function submitPost(ctx) {
  const { db, storage, user, toast } = ctx;

  const text = (document.getElementById("pText")?.value || "").trim();
  const file = document.getElementById("pImg")?.files?.[0];

  if (!text && !file) return toast("Write something or add an image.");

  try {
    // Load user profile info (users/{uid})
    const meSnap = await getDoc(doc(db, "users", user.uid));
    const me = meSnap.exists() ? meSnap.data() : null;

    let imageURL = "";
    if (file) {
      const path = `posts/${user.uid}/${Date.now()}_${sanitizeFileName(file.name)}`;
      const r = ref(storage, path);
      await uploadBytes(r, file);
      imageURL = await getDownloadURL(r);
    }

    await addDoc(collection(db, "posts"), {
      uid: user.uid,
      username: me?.username || (user.email ? user.email.split("@")[0] : "user"),
      displayName: me?.displayName || me?.username || "User",
      verified: !!me?.verified,
      photoURL: me?.photoURL || user.photoURL || "",
      text,
      imageURL,
      likeCount: 0,
      commentCount: 0,
      createdAt: serverTimestamp(),
    });

    closeModal();
    toast("Posted ✅");
  } catch (e) {
    console.error(e);
    toast(e?.message || "Post failed");
  }
}

/* -------------------------------------------------------
   Likes
------------------------------------------------------- */
async function toggleLike(ctx, postId) {
  const { db, user, toast } = ctx;
  if (!user?.uid) return toast("Login first");

  try {
    await runTransaction(db, async (tx) => {
      const postRef = doc(db, "posts", postId);
      const likeRef = doc(db, "posts", postId, "likes", user.uid);

      const likeSnap = await tx.get(likeRef);
      if (likeSnap.exists()) {
        tx.delete(likeRef);
        tx.update(postRef, { likeCount: increment(-1) });
      } else {
        tx.set(likeRef, { uid: user.uid, createdAt: serverTimestamp() });
        tx.update(postRef, { likeCount: increment(1) });
      }
    });
  } catch (e) {
    console.error(e);
    toast(e?.message || "Like failed");
  }
}

async function markLikedStates(ctx, posts) {
  const { db, user } = ctx;
  if (!user?.uid) return;

  for (const p of posts) {
    try {
      const s = await getDoc(doc(db, "posts", p.id, "likes", user.uid));
      const btn = document.querySelector(`[data-like="${p.id}"]`);
      if (!btn) continue;

      btn.classList.toggle("active", s.exists());
      const heart = btn.querySelector("[data-heart]");
      if (heart) heart.textContent = s.exists() ? "♥️" : "♡";
    } catch {}
  }
}

/* -------------------------------------------------------
   Comments
------------------------------------------------------- */
async function openComments(ctx, post) {
  const { db, user, toast } = ctx;

  const b = document.getElementById("modalBackdrop");
  const m = document.getElementById("modal");
  if (!b || !m) return toast("Modal missing");

  m.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <div class="title">Comments</div>
      <button class="btn" id="mClose">Close</button>
    </div>
    <div class="divider"></div>

    <div class="row" style="align-items:flex-start">
      <div style="flex:1">
        <textarea id="cText" placeholder="Write a comment..."></textarea>
        <div class="row" style="justify-content:flex-end;margin-top:10px">
          <button class="btn primary" id="cSend">Send</button>
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <div id="cList" class="grid">
      <div class="muted small">Loading…</div>
    </div>
  `;

  b.classList.add("open");
  document.getElementById("mClose").onclick = closeModal;

  // Load comments
  try {
    const qC = query(collection(db, "posts", post.id, "comments"), orderBy("createdAt", "desc"), limit(60));
    const snap = await getDocs(qC);
    const comments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const list = document.getElementById("cList");
    list.innerHTML = comments.length
      ? comments.map(commentHTML).join("")
      : `<div class="muted small">No comments yet.</div>`;
  } catch (e) {
    console.error(e);
    document.getElementById("cList").innerHTML = `<div class="muted small">Failed to load comments.</div>`;
  }

  // Send comment
  document.getElementById("cSend").onclick = async () => {
    const text = (document.getElementById("cText")?.value || "").trim();
    if (!text) return toast("Write something.");

    try {
      // get my profile
      const meSnap = await getDoc(doc(db, "users", user.uid));
      const me = meSnap.exists() ? meSnap.data() : null;

      await addDoc(collection(db, "posts", post.id, "comments"), {
        uid: user.uid,
        username: me?.username || "user",
        verified: !!me?.verified,
        text,
        createdAt: serverTimestamp(),
      });

      await updateDoc(doc(db, "posts", post.id), { commentCount: increment(1) });

      document.getElementById("cText").value = "";
      toast("Comment added ✅");

      // Refresh list quickly
      const qC = query(collection(db, "posts", post.id, "comments"), orderBy("createdAt", "desc"), limit(60));
      const snap = await getDocs(qC);
      const comments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const list = document.getElementById("cList");
      list.innerHTML = comments.length
        ? comments.map(commentHTML).join("")
        : `<div class="muted small">No comments yet.</div>`;
    } catch (e) {
      console.error(e);
      toast(e?.message || "Comment failed");
    }
  };
}

/* -------------------------------------------------------
   Delete post (owner only)
------------------------------------------------------- */
async function deletePost(ctx, post) {
  const { db, user, toast } = ctx;
  if (!user?.uid) return toast("Login first");

  if (post.uid !== user.uid) return toast("You can only delete your own post.");

  if (!confirm("Delete this post?")) return;
  try {
    await deleteDoc(doc(db, "posts", post.id));
    toast("Deleted ✅");
  } catch (e) {
    console.error(e);
    toast(e?.message || "Delete failed");
  }
}

/* -------------------------------------------------------
   Wiring
------------------------------------------------------- */
function wirePostActions(ctx, posts) {
  // Like buttons
  document.querySelectorAll("[data-like]").forEach((btn) => {
    if (btn.__wired) return;
    btn.__wired = true;
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const postId = btn.getAttribute("data-like");
      if (!postId) return;
      await toggleLike(ctx, postId);
    });
  });

  // Comments
  document.querySelectorAll("[data-comments]").forEach((btn) => {
    if (btn.__wired) return;
    btn.__wired = true;
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const postId = btn.getAttribute("data-comments");
      const post = posts.find((p) => p.id === postId);
      if (post) await openComments(ctx, post);
    });
  });

  // Delete
  document.querySelectorAll("[data-delete]").forEach((btn) => {
    if (btn.__wired) return;
    btn.__wired = true;
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const postId = btn.getAttribute("data-delete");
      const post = posts.find((p) => p.id === postId);
      if (post) await deletePost(ctx, post);
    });
  });

  // Image click -> open image
  document.querySelectorAll("[data-img]").forEach((el) => {
    if (el.__wired) return;
    el.__wired = true;
    el.style.cursor = "pointer";
    el.addEventListener("click", () => {
      const src = el.getAttribute("data-img");
      if (!src) return;
      openImageModal(src);
    });
  });
}

/* -------------------------------------------------------
   Modal helpers
------------------------------------------------------- */
function modalHTML() {
  // If your index already has this modal, it will exist.
  // This is a safe fallback.
  if (document.getElementById("modalBackdrop") && document.getElementById("modal")) return "";
  return `
    <div class="modal-backdrop" id="modalBackdrop">
      <div class="modal" id="modal"></div>
    </div>
  `;
}

function wireModal(ctx) {
  const b = document.getElementById("modalBackdrop");
  if (!b || b.__wired) return;
  b.__wired = true;
  b.addEventListener("click", (e) => {
    if (e.target === b) closeModal();
  });
}

function closeModal() {
  const b = document.getElementById("modalBackdrop");
  const m = document.getElementById("modal");
  if (b) b.classList.remove("open");
  if (m) m.innerHTML = "";
}

function openImageModal(src) {
  const b = document.getElementById("modalBackdrop");
  const m = document.getElementById("modal");
  if (!b || !m) return;

  m.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center">
      <div class="title">Image</div>
      <button class="btn" id="mClose">Close</button>
    </div>
    <div class="divider"></div>
    <div style="display:flex;justify-content:center">
      <img src="${escapeHtml(src)}" style="max-width:100%;max-height:70vh;border-radius:16px;border:1px solid rgba(39,48,71,.85)" />
    </div>
  `;
  b.classList.add("open");
  document.getElementById("mClose").onclick = closeModal;
}

/* -------------------------------------------------------
   HTML builders
------------------------------------------------------- */
function postCardHTML(p, myUid) {
  const id = escapeHtml(p.id || "");
  const name = escapeHtml(p.displayName || p.username || "User");
  const username = escapeHtml(p.username || "user");
  const text = escapeHtml(p.text || "");
  const img = p.imageURL || "";
  const likeCount = Number(p.likeCount || 0);
  const commentCount = Number(p.commentCount || 0);
  const when = p.createdAt?.toDate ? timeAgo(p.createdAt.toDate()) : "";
  const canDelete = p.uid && myUid && p.uid === myUid;

  return `
    <div class="card" style="margin-bottom:12px">
      <div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px">
        <div style="min-width:0">
          <div style="font-weight:900">${name} ${p.verified ? `<span class="verified">✓</span>` : ""}</div>
          <div class="muted small">@${username}${when ? ` · ${when}` : ""}</div>
        </div>
        ${canDelete ? `<button class="btn danger" data-delete="${id}" style="padding:8px 10px;border-radius:12px">Delete</button>` : ""}
      </div>

      ${text ? `<div style="margin-top:10px;white-space:pre-wrap">${text}</div>` : ""}

      ${
        img
          ? `
        <div class="post-img" style="margin-top:10px">
          <img src="${escapeHtml(img)}" data-img="${escapeHtml(img)}" alt="post image" style="width:100%;display:block" />
        </div>
      `
          : ""
      }

      <div class="post-actions" style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="action" data-like="${id}">
          <span data-heart>♡</span>
          <span class="small">Like</span>
          <span class="small muted">${likeCount}</span>
        </button>

        <button class="action" data-comments="${id}">
          <span>💬</span>
          <span class="small">Comments</span>
          <span class="small muted">${commentCount}</span>
        </button>
      </div>
    </div>
  `;
}

function commentHTML(c) {
  const username = escapeHtml(c.username || "user");
  const text = escapeHtml(c.text || "");
  const when = c.createdAt?.toDate ? timeAgo(c.createdAt.toDate()) : "";
  return `
    <div class="comment">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div><b>${username}</b> ${c.verified ? `<span class="verified">✓</span>` : ""}</div>
        <div class="muted small">${when}</div>
      </div>
      <div style="margin-top:6px;white-space:pre-wrap">${text}</div>
    </div>
  `;
}

/* -------------------------------------------------------
   Utilities
------------------------------------------------------- */
function timeAgo(d) {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

function escapeHtml(str) {
  return (str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sanitizeFileName(name) {
  return (name || "file")
    .toString()
    .replaceAll("..", ".")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}
