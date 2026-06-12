// profile.js
// Full working Profile module (separate file)
// Exports: renderProfile(host, data)
//
// REQUIREMENTS:
// - firebase.js exports: auth, db, storage
// - ui.js exports: $, toast, esc (esc optional)
// - app.js should pass { me } or we can read auth.currentUser
//
// Features included:
// ✅ Shows current user basic info
// ✅ Loads user doc from /users/{uid}
// ✅ Updates displayName + bio
// ✅ Upload profile picture -> Storage avatars/{uid}.jpg -> updates Auth + Firestore photoURL
// ✅ Shows counts: posts, followers, following (if those collections exist)
// ✅ If not logged in: shows login message (no crash)

import { auth, db, storage } from "./firebase.js";
import { $, toast } from "./ui.js";

import {
  updateProfile,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getCountFromServer,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  ref as sRef,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

let wired = false;
let unsubAuth = null;

function safe(v, fallback = "") {
  return (v ?? "") || fallback;
}

function avatarHTML(url, size = 72) {
  const u = url || "";
  if (u) {
    return `<img src="${u}" alt="avatar" style="width:${size}px;height:${size}px;border-radius:999px;object-fit:cover;border:1px solid rgba(255,255,255,.12)" />`;
  }
  // fallback circle
  return `<div style="width:${size}px;height:${size}px;border-radius:999px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);font-weight:800">👤</div>`;
}

async function ensureUserDoc(uid, base = {}) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(
      ref,
      {
        uid,
        email: safe(base.email),
        username: safe(base.username),
        displayName: safe(base.displayName, "User"),
        photoURL: safe(base.photoURL),
        bio: "",
        verified: false,
        banned: false,
        isAdmin: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }
}

async function loadCounts(uid) {
  // These are OPTIONAL. If your schema differs, it won’t crash.
  // posts: collection("posts") where ownerId == uid
  // followers: collection(`users/${uid}/followers`)
  // following: collection(`users/${uid}/following`)
  const out = { posts: 0, followers: 0, following: 0 };

  try {
    const postsQ = query(collection(db, "posts"), where("ownerId", "==", uid));
    const postsAgg = await getCountFromServer(postsQ);
    out.posts = postsAgg.data().count || 0;
  } catch {}

  try {
    const folAgg = await getCountFromServer(collection(db, "users", uid, "followers"));
    out.followers = folAgg.data().count || 0;
  } catch {}

  try {
    const ingAgg = await getCountFromServer(collection(db, "users", uid, "following"));
    out.following = ingAgg.data().count || 0;
  } catch {}

  return out;
}

function renderLoggedOut(host) {
  host.innerHTML = `
    <div class="card">
      <div class="title">Profile</div>
      <div class="muted">You are not signed in. (Add your login UI in auth.js or profile.js)</div>
    </div>
  `;
}

function renderProfileUI(host, me, userDoc, counts) {
  const displayName = safe(userDoc.displayName, safe(me.displayName, "User"));
  const username = safe(userDoc.username, (me.email || "").split("@")[0] || "user");
  const bio = safe(userDoc.bio, "");
  const email = safe(me.email, "");
  const photoURL = safe(userDoc.photoURL, safe(me.photoURL, ""));

  host.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div class="row" style="gap:12px;align-items:center">
          ${avatarHTML(photoURL, 72)}
          <div>
            <div style="font-weight:900;font-size:18px;line-height:1.1">${displayName}</div>
            <div class="muted small">@${username}</div>
            <div class="muted small">${email}</div>
          </div>
        </div>
        <label class="btn" style="cursor:pointer">
          Change Photo
          <input id="pfFile" type="file" accept="image/*" style="display:none" />
        </label>
      </div>

      <div class="divider" style="margin:14px 0"></div>

      <div class="row" style="gap:10px;justify-content:space-between">
        <div class="pill" style="padding:10px 12px;min-width:92px;text-align:center">
          <div style="font-weight:900;font-size:16px">${counts.posts ?? 0}</div>
          <div class="muted small">Posts</div>
        </div>
        <div class="pill" style="padding:10px 12px;min-width:92px;text-align:center">
          <div style="font-weight:900;font-size:16px">${counts.followers ?? 0}</div>
          <div class="muted small">Followers</div>
        </div>
        <div class="pill" style="padding:10px 12px;min-width:92px;text-align:center">
          <div style="font-weight:900;font-size:16px">${counts.following ?? 0}</div>
          <div class="muted small">Following</div>
        </div>
      </div>

      <div style="height:14px"></div>

      <label class="muted small">Display name</label>
      <input id="pfName" class="input" value="${displayName.replace(/"/g, "&quot;")}" />

      <div style="height:10px"></div>

      <label class="muted small">Bio</label>
      <textarea id="pfBio" class="input" rows="3" style="resize:none">${bio}</textarea>

      <div style="height:12px"></div>

      <div class="row" style="gap:10px">
        <button id="pfSave" class="btn primary" style="flex:1">Save</button>
        <button id="pfRefresh" class="btn" style="flex:1">Refresh</button>
      </div>

      <div style="height:10px"></div>
      <div class="muted small">Profile picture uploads to Storage and updates Firestore + Auth.</div>
    </div>
  `;
}

async function saveProfile(uid) {
  const name = ($("#pfName")?.value || "").trim();
  const bio = ($("#pfBio")?.value || "").trim();

  const updates = {
    updatedAt: serverTimestamp(),
  };
  if (name) updates.displayName = name;
  updates.bio = bio;

  await updateDoc(doc(db, "users", uid), updates);

  // keep Auth profile in sync too
  if (auth.currentUser) {
    await updateProfile(auth.currentUser, { displayName: name || auth.currentUser.displayName || "" }).catch(() => {});
  }
}

async function uploadAvatar(uid, file) {
  if (!file) return;

  // basic size guard (optional)
  if (file.size > 6 * 1024 * 1024) {
    toast("Image too large (max ~6MB).");
    return;
  }

  const path = `avatars/${uid}.jpg`;
  const r = sRef(storage, path);

  await uploadBytes(r, file, { contentType: file.type || "image/jpeg" });
  const url = await getDownloadURL(r);

  // update Firestore + Auth
  await updateDoc(doc(db, "users", uid), {
    photoURL: url,
    updatedAt: serverTimestamp(),
  });

  if (auth.currentUser) {
    await updateProfile(auth.currentUser, { photoURL: url }).catch(() => {});
  }

  toast("Profile photo updated ✅");
}

async function loadUser(uid, me) {
  await ensureUserDoc(uid, {
    email: me.email || "",
    username: (me.email || "").split("@")[0] || "user",
    displayName: me.displayName || "User",
    photoURL: me.photoURL || "",
  });

  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : {};
}

function wire(host) {
  if (wired) return;
  wired = true;

  host.addEventListener("click", async (e) => {
    const saveBtn = e.target.closest("#pfSave");
    const refreshBtn = e.target.closest("#pfRefresh");
    const uid = auth.currentUser?.uid;

    if (!uid) return;

    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        await saveProfile(uid);
        toast("Saved ✅");
        saveBtn.disabled = false;
        return;
      }

      if (refreshBtn) {
        refreshBtn.disabled = true;
        await renderProfile(host, {});
        refreshBtn.disabled = false;
        return;
      }
    } catch (err) {
      console.error(err);
      toast(err?.message || "Profile error");
      saveBtn && (saveBtn.disabled = false);
      refreshBtn && (refreshBtn.disabled = false);
    }
  });

  host.addEventListener("change", async (e) => {
    const fileInput = e.target.closest("#pfFile");
    if (!fileInput) return;

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    try {
      const file = fileInput.files?.[0];
      if (!file) return;
      await uploadAvatar(uid, file);
      await renderProfile(host, {});
    } catch (err) {
      console.error(err);
      toast(err?.message || "Upload failed");
    } finally {
      fileInput.value = "";
    }
  });
}

export async function renderProfile(host, data = {}) {
  const me = auth.currentUser;

  if (!db || !auth) {
    host.innerHTML = `
      <div class="card">
        <div class="title">Profile</div>
        <div class="muted">Firebase not initialized. Check firebase.js exports.</div>
      </div>
    `;
    return;
  }

  if (!me) {
    renderLoggedOut(host);

    // keep it live: if user logs in, profile updates
    try {
      if (unsubAuth) unsubAuth();
    } catch {}
    unsubAuth = onAuthStateChanged(auth, (u) => {
      if (u) renderProfile(host, {});
    });

    return;
  }

  wire(host);

  // Load doc + counts
  const uid = me.uid;
  const [userDoc, counts] = await Promise.all([loadUser(uid, me), loadCounts(uid)]);

  renderProfileUI(host, me, userDoc, counts);

  // Live auth changes (logout, etc.)
  try {
    if (unsubAuth) unsubAuth();
  } catch {}
  unsubAuth = onAuthStateChanged(auth, (u) => {
    if (!u) renderLoggedOut(host);
  });
}
