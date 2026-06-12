/* data.js (FULL)
   Path: app/src/main/assets/data.js

   This is the Firestore/Storage data layer for EchoStream.
   Works with firebase.js exporting: auth, db, storage.

   Collections used:
   - users/{uid}
   - posts/{postId}
   - posts/{postId}/comments/{commentId}
   - users/{uid}/following/{targetUid}
   - users/{uid}/followers/{followerUid}
   - users/{uid}/notifications/{notifId}

   Storage:
   - posts/{uid}/{postId}.jpg
   - avatars/{uid}.jpg
*/

import { db, storage } from "./firebase.js";

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  increment,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

/* -----------------------------
   Helpers
----------------------------- */

function nowMs() {
  return Date.now();
}

function makeId(prefix = "id") {
  return `${prefix}_${nowMs()}_${Math.random().toString(16).slice(2)}`;
}

function safeStr(x) {
  return (x ?? "").toString().trim();
}

function isNonEmpty(x) {
  return safeStr(x).length > 0;
}

function pickUserPublic(u) {
  if (!u) return null;
  return {
    uid: u.uid,
    displayName: u.displayName || "",
    username: u.username || "",
    photoURL: u.photoURL || "",
    bio: u.bio || "",
    verified: !!u.verified,
    banned: !!u.banned,
  };
}

/* -----------------------------
   Users
----------------------------- */

export async function ensureUserDoc(user) {
  if (!user?.uid) throw new Error("ensureUserDoc: missing user.uid");

  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    const usernameGuess = safeStr(user.email || "")
      .split("@")[0]
      .replace(/[^a-zA-Z0-9_\.]/g, "")
      .slice(0, 18);

    await setDoc(userRef, {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || usernameGuess || "New User",
      username: usernameGuess || `user${Math.floor(Math.random() * 10000)}`,
      photoURL: user.photoURL || "",
      bio: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      verified: false,
      banned: false,
      followersCount: 0,
      followingCount: 0,
      postsCount: 0,
    });
  } else {
    // keep it fresh
    await updateDoc(userRef, {
      updatedAt: serverTimestamp(),
      email: user.email || "",
    });
  }

  const fresh = await getDoc(userRef);
  return { id: fresh.id, ...fresh.data() };
}

export async function getUser(uid) {
  if (!uid) throw new Error("getUser: missing uid");
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function updateUserProfile(uid, patch) {
  if (!uid) throw new Error("updateUserProfile: missing uid");
  const userRef = doc(db, "users", uid);

  const clean = {};
  if (patch.displayName !== undefined) clean.displayName = safeStr(patch.displayName).slice(0, 40);
  if (patch.username !== undefined) clean.username = safeStr(patch.username).slice(0, 24);
  if (patch.bio !== undefined) clean.bio = safeStr(patch.bio).slice(0, 180);
  if (patch.photoURL !== undefined) clean.photoURL = safeStr(patch.photoURL);

  clean.updatedAt = serverTimestamp();

  await updateDoc(userRef, clean);
  return await getUser(uid);
}

export async function uploadAvatar(uid, file) {
  if (!uid) throw new Error("uploadAvatar: missing uid");
  if (!file) throw new Error("uploadAvatar: missing file");

  const path = `avatars/${uid}.jpg`;
  const r = ref(storage, path);

  await uploadBytes(r, file, { contentType: file.type || "image/jpeg" });
  const url = await getDownloadURL(r);

  await updateUserProfile(uid, { photoURL: url });

  return url;
}

/* -----------------------------
   Posts
----------------------------- */

export async function createPost({ user, text, imageFile }) {
  if (!user?.uid) throw new Error("createPost: missing user.uid");
  const content = safeStr(text);

  if (!isNonEmpty(content) && !imageFile) {
    throw new Error("Post needs text or an image.");
  }

  const postId = makeId("post");
  const postRef = doc(db, "posts", postId);

  // create post doc first (no image yet)
  const postDoc = {
    id: postId,
    ownerUid: user.uid,
    owner: {
      uid: user.uid,
      displayName: user.displayName || "",
      photoURL: user.photoURL || "",
    },
    text: content,
    imageURL: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    likesCount: 0,
    commentsCount: 0,
  };

  await setDoc(postRef, postDoc);

  // optional image upload
  if (imageFile) {
    const imgPath = `posts/${user.uid}/${postId}.jpg`;
    const imgRef = ref(storage, imgPath);
    await uploadBytes(imgRef, imageFile, { contentType: imageFile.type || "image/jpeg" });
    const imageURL = await getDownloadURL(imgRef);

    await updateDoc(postRef, {
      imageURL,
      updatedAt: serverTimestamp(),
    });
  }

  // increment user postsCount
  await updateDoc(doc(db, "users", user.uid), {
    postsCount: increment(1),
    updatedAt: serverTimestamp(),
  });

  const snap = await getDoc(postRef);
  return { id: snap.id, ...snap.data() };
}

export async function deletePost({ postId, requesterUid }) {
  if (!postId) throw new Error("deletePost: missing postId");
  const postRef = doc(db, "posts", postId);
  const snap = await getDoc(postRef);
  if (!snap.exists()) return;

  const post = snap.data();
  if (post.ownerUid !== requesterUid) {
    // Admin delete should be done server-side or via rules.
    throw new Error("Not allowed to delete this post.");
  }

  // delete image if exists
  if (post.imageURL) {
    try {
      const imgPath = `posts/${post.ownerUid}/${postId}.jpg`;
      await deleteObject(ref(storage, imgPath));
    } catch (_) {}
  }

  await deleteDoc(postRef);

  // decrement postsCount
  await updateDoc(doc(db, "users", post.ownerUid), {
    postsCount: increment(-1),
    updatedAt: serverTimestamp(),
  });
}

export async function getFeedPage({ pageSize = 15, cursor = null } = {}) {
  // newest posts first
  let qy = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(pageSize));

  if (cursor) {
    // cursor should be a Firestore document snapshot or { createdAt } is messy.
    // Easiest: pass a "lastDoc" snapshot from previous call.
    qy = query(collection(db, "posts"), orderBy("createdAt", "desc"), startAfter(cursor), limit(pageSize));
  }

  const snap = await getDocs(qy);
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const lastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;

  return { items: docs, lastDoc };
}

export async function getUserPosts(uid, pageSize = 20) {
  if (!uid) throw new Error("getUserPosts: missing uid");
  const qy = query(
    collection(db, "posts"),
    where("ownerUid", "==", uid),
    orderBy("createdAt", "desc"),
    limit(pageSize)
  );
  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* -----------------------------
   Likes
----------------------------- */

export async function hasLiked({ postId, uid }) {
  if (!postId || !uid) return false;
  const likeRef = doc(db, "posts", postId, "likes", uid);
  const snap = await getDoc(likeRef);
  return snap.exists();
}

export async function toggleLike({ postId, uid }) {
  if (!postId) throw new Error("toggleLike: missing postId");
  if (!uid) throw new Error("toggleLike: missing uid");

  const postRef = doc(db, "posts", postId);
  const likeRef = doc(db, "posts", postId, "likes", uid);

  const result = await runTransaction(db, async (tx) => {
    const likeSnap = await tx.get(likeRef);
    if (likeSnap.exists()) {
      tx.delete(likeRef);
      tx.update(postRef, { likesCount: increment(-1), updatedAt: serverTimestamp() });
      return { liked: false };
    } else {
      tx.set(likeRef, { uid, createdAt: serverTimestamp() });
      tx.update(postRef, { likesCount: increment(1), updatedAt: serverTimestamp() });
      return { liked: true };
    }
  });

  return result;
}

/* -----------------------------
   Comments
----------------------------- */

export async function addComment({ postId, user, text }) {
  if (!postId) throw new Error("addComment: missing postId");
  if (!user?.uid) throw new Error("addComment: missing user.uid");
  const body = safeStr(text);
  if (!isNonEmpty(body)) throw new Error("Comment is empty.");

  const postRef = doc(db, "posts", postId);
  const commentsCol = collection(db, "posts", postId, "comments");

  const commentDoc = {
    ownerUid: user.uid,
    owner: {
      uid: user.uid,
      displayName: user.displayName || "",
      photoURL: user.photoURL || "",
    },
    text: body,
    createdAt: serverTimestamp(),
  };

  const newRef = await addDoc(commentsCol, commentDoc);

  await updateDoc(postRef, {
    commentsCount: increment(1),
    updatedAt: serverTimestamp(),
  });

  // notification to post owner (best effort)
  try {
    const postSnap = await getDoc(postRef);
    if (postSnap.exists()) {
      const post = postSnap.data();
      if (post.ownerUid && post.ownerUid !== user.uid) {
        await addNotification(post.ownerUid, {
          type: "comment",
          fromUid: user.uid,
          postId,
          text: body.slice(0, 80),
        });
      }
    }
  } catch (_) {}

  return { id: newRef.id, ...commentDoc };
}

export async function getComments(postId, pageSize = 30) {
  if (!postId) throw new Error("getComments: missing postId");
  const qy = query(
    collection(db, "posts", postId, "comments"),
    orderBy("createdAt", "desc"),
    limit(pageSize)
  );
  const snap = await getDocs(qy);
  // reverse so oldest appears first in UI if you want:
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
}

/* -----------------------------
   Follow system
----------------------------- */

export async function isFollowing({ uid, targetUid }) {
  if (!uid || !targetUid) return false;
  const refDoc = doc(db, "users", uid, "following", targetUid);
  const snap = await getDoc(refDoc);
  return snap.exists();
}

export async function follow({ uid, targetUid }) {
  if (!uid || !targetUid) throw new Error("follow: missing uid/targetUid");
  if (uid === targetUid) throw new Error("You can't follow yourself.");

  const followingRef = doc(db, "users", uid, "following", targetUid);
  const followerRef = doc(db, "users", targetUid, "followers", uid);

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(followingRef);
    if (existing.exists()) return;

    tx.set(followingRef, { uid: targetUid, createdAt: serverTimestamp() });
    tx.set(followerRef, { uid, createdAt: serverTimestamp() });

    tx.update(doc(db, "users", uid), { followingCount: increment(1), updatedAt: serverTimestamp() });
    tx.update(doc(db, "users", targetUid), { followersCount: increment(1), updatedAt: serverTimestamp() });
  });

  // notification
  try {
    await addNotification(targetUid, {
      type: "follow",
      fromUid: uid,
      postId: "",
      text: "",
    });
  } catch (_) {}

  return true;
}

export async function unfollow({ uid, targetUid }) {
  if (!uid || !targetUid) throw new Error("unfollow: missing uid/targetUid");
  const followingRef = doc(db, "users", uid, "following", targetUid);
  const followerRef = doc(db, "users", targetUid, "followers", uid);

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(followingRef);
    if (!existing.exists()) return;

    tx.delete(followingRef);
    tx.delete(followerRef);

    tx.update(doc(db, "users", uid), { followingCount: increment(-1), updatedAt: serverTimestamp() });
    tx.update(doc(db, "users", targetUid), { followersCount: increment(-1), updatedAt: serverTimestamp() });
  });

  return true;
}

/* -----------------------------
   Notifications
----------------------------- */

export async function addNotification(targetUid, payload) {
  if (!targetUid) throw new Error("addNotification: missing targetUid");

  const notif = {
    type: payload.type || "system",
    fromUid: payload.fromUid || "",
    postId: payload.postId || "",
    text: payload.text || "",
    createdAt: serverTimestamp(),
    read: false,
  };

  const col = collection(db, "users", targetUid, "notifications");
  const refNew = await addDoc(col, notif);
  return { id: refNew.id, ...notif };
}

export async function getNotifications(uid, pageSize = 30) {
  if (!uid) throw new Error("getNotifications: missing uid");
  const qy = query(
    collection(db, "users", uid, "notifications"),
    orderBy("createdAt", "desc"),
    limit(pageSize)
  );
  const snap = await getDocs(qy);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function markNotificationRead(uid, notifId) {
  if (!uid || !notifId) return;
  await updateDoc(doc(db, "users", uid, "notifications", notifId), { read: true });
}

/* -----------------------------
   Search helpers
----------------------------- */

export async function searchUsersByUsername(prefix, pageSize = 20) {
  // Simple search: expects you store a "usernameLower" field for proper prefix searching.
  // If you don't have it, we fall back to exact "username".
  const p = safeStr(prefix).toLowerCase();
  if (!p) return [];

  // Best: create usernameLower + query range.
  // We'll try usernameLower first, then fallback.
  try {
    const usersCol = collection(db, "users");
    const end = p + "\uf8ff";
    const qy = query(
      usersCol,
      where("usernameLower", ">=", p),
      where("usernameLower", "<=", end),
      orderBy("usernameLower"),
      limit(pageSize)
    );
    const snap = await getDocs(qy);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (_) {
    // fallback: exact match
    const qy = query(collection(db, "users"), where("username", "==", prefix), limit(pageSize));
    const snap = await getDocs(qy);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}

export async function searchPostsByText(keyword, pageSize = 20) {
  // NOTE: Firestore is not full-text search.
  // This works only if you store keywords/tokens.
  // We'll provide a simple fallback: load recent and filter in memory.
  const k = safeStr(keyword).toLowerCase();
  if (!k) return [];

  const { items } = await getFeedPage({ pageSize: 40 });
  return items
    .filter((p) => (p.text || "").toLowerCase().includes(k))
    .slice(0, pageSize);
}

/* -----------------------------
   Admin helpers (UI side only)
   Real security must be done via rules / Cloud Functions.
----------------------------- */

export async function setUserBanned(uid, banned) {
  if (!uid) throw new Error("setUserBanned: missing uid");
  await updateDoc(doc(db, "users", uid), { banned: !!banned, updatedAt: serverTimestamp() });
}

export async function setUserVerified(uid, verified) {
  if (!uid) throw new Error("setUserVerified: missing uid");
  await updateDoc(doc(db, "users", uid), { verified: !!verified, updatedAt: serverTimestamp() });
}
