// messages.js — FULL MESSAGING + VOICE NOTES + AUDIO/VIDEO CALLS (ONE FILE)
// ✅ Bottom bar Messages button (clones an existing tab so taps work)
// ✅ Side drawer Messages item (if drawer exists)
// ✅ Opens as FULL PAGE overlay (NOT a popup modal)
// ✅ Search users + open chat
// ✅ Text messages + Voice notes (Firebase Storage)
// ✅ Audio/Video calls (WebRTC) with Firestore signaling (NO extra file)
//
// IMPORTANT (how to start it):
// Call AFTER Firebase init (auth/db/storage created):
//   installMessaging({ auth, db, storage })
//
// Firestore used:
//   users/{uid}
//   conversations/{cid}
//   conversations/{cid}/messages/{mid}
//   calls/{callId} + subcollections: offers, answers, callerCandidates, calleeCandidates
//
// Storage used:
//   messages_audio/{cid}/{uid_timestamp}.webm

import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

export function installMessaging({ auth, db, storage } = {}) {
  if (!auth || !db) return;
  if (window.__echoMessagingInstalled) return;
  window.__echoMessagingInstalled = true;

  const $ = (sel) => document.querySelector(sel);

  // ----------------------------
  // HELPERS
  // ----------------------------
  function safe(s) {
    return (s ?? "").toString()
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toast(msg) {
    const el = $("#toast");
    if (!el) return alert(msg);
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2400);
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

  function cssEscape(v) {
    try { return CSS.escape(v); } catch { return v.replace(/["\\]/g, "\\$&"); }
  }

  // ----------------------------
  // FULL PAGE OVERLAY (NOT MODAL)
  // ----------------------------
  function openPage(html) {
    const old = document.querySelector("#messagesPage");
    if (old) old.remove();

    const page = document.createElement("div");
    page.id = "messagesPage";
    page.style.cssText = `
      position:fixed; inset:0; z-index:99999;
      background: var(--bg, #0f1115);
      color: var(--text, #e9edf7);
      overflow:auto;
      -webkit-overflow-scrolling: touch;
      padding:14px 14px 90px;
    `;
    page.innerHTML = html;
    document.body.appendChild(page);
  }

  function closePage() {
    const page = document.querySelector("#messagesPage");
    if (page) page.remove();
  }

  // ----------------------------
  // USERS
  // ----------------------------
  async function getUser(uid) {
    if (!uid) return null;
    try {
      const s = await getDoc(doc(db, "users", uid));
      if (!s.exists()) return null;
      return { uid: s.id, ...s.data() }; // ✅ include uid = doc id
    } catch {
      return null;
    }
  }

  async function getUserByUsername(username) {
    const name = (username || "").trim().toLowerCase().replace(/^@/, "");
    if (!name) return null;

    const qy = query(
      collection(db, "users"),
      where("username", "==", name),
      limit(1)
    );

    const snap = await getDocs(qy);
    if (snap.empty) return null;

    const d = snap.docs[0];
    return { uid: d.id, ...d.data() }; // ✅ uid is doc id
  }

  // Prefix search (optional, safe). Uses "username" starts-with trick.
  async function searchUsersPrefix(prefix) {
    const p = (prefix || "").trim().toLowerCase().replace(/^@/, "");
    if (!p) return [];
    try {
      const qy = query(
        collection(db, "users"),
        where("username", ">=", p),
        where("username", "<=", p + "\uf8ff"),
        limit(10)
      );
      const snap = await getDocs(qy);
      return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    } catch {
      return [];
    }
  }

  // ----------------------------
  // CONVERSATIONS
  // ----------------------------
  function makeCid(uidA, uidB) {
    return [uidA, uidB].sort().join("_");
  }

  async function ensureConversation(otherUid) {
    const u = auth.currentUser;
    if (!u?.uid) throw new Error("Login first");
    if (!otherUid) throw new Error("Missing user");
    if (u.uid === otherUid) throw new Error("You can’t message yourself");

    const cid = makeCid(u.uid, otherUid);
    const ref = doc(db, "conversations", cid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      await setDoc(ref, {
        participants: [u.uid, otherUid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastMessageText: "",
        lastMessageAt: null,
        lastSenderUid: "",
        lastRead: { [u.uid]: serverTimestamp() }
      });
    }
    return cid;
  }

  async function markRead(cid) {
    const u = auth.currentUser;
    if (!u?.uid || !cid) return;
    try {
      await updateDoc(doc(db, "conversations", cid), {
        [`lastRead.${u.uid}`]: serverTimestamp()
      });
    } catch {}
  }

  function unreadForMe(conv) {
    const u = auth.currentUser;
    if (!u?.uid) return false;

    const lastAt = conv?.lastMessageAt;
    const lastSender = conv?.lastSenderUid || "";
    const myRead = conv?.lastRead?.[u.uid];

    if (!lastAt) return false;
    if (lastSender === u.uid) return false;
    if (!myRead) return true;

    const a = lastAt?.toMillis ? lastAt.toMillis() : new Date(lastAt).getTime();
    const r = myRead?.toMillis ? myRead.toMillis() : new Date(myRead).getTime();
    return a > r;
  }

  // ----------------------------
  // SEND MESSAGES
  // ----------------------------
  async function sendTextMessage(cid, text) {
    const u = auth.currentUser;
    if (!u?.uid) throw new Error("Login first");

    const clean = (text || "").trim();
    if (!clean) throw new Error("Write something.");

    await addDoc(collection(db, "conversations", cid, "messages"), {
      fromUid: u.uid,
      type: "text",
      text: clean,
      createdAt: serverTimestamp()
    });

    await updateDoc(doc(db, "conversations", cid), {
      updatedAt: serverTimestamp(),
      lastMessageText: clean.slice(0, 200),
      lastMessageAt: serverTimestamp(),
      lastSenderUid: u.uid,
      [`lastRead.${u.uid}`]: serverTimestamp()
    });
  }

  async function sendAudioMessage(cid, blob, durationMs = 0) {
    const u = auth.currentUser;
    if (!u?.uid) throw new Error("Login first");
    if (!blob) throw new Error("No audio recorded.");
    if (!storage) throw new Error("Voice notes need Storage enabled.");

    // Force audio-ish type (prevents "video player" behavior in some webviews)
    const audioBlob = new Blob([blob], { type: "audio/webm" });

    const path = `messages_audio/${cid}/${u.uid}_${Date.now()}.webm`;
    const r = storageRef(storage, path);

    await uploadBytes(r, audioBlob, { contentType: "audio/webm" });
    const url = await getDownloadURL(r);

    await addDoc(collection(db, "conversations", cid, "messages"), {
      fromUid: u.uid,
      type: "audio",
      audioUrl: url,
      audioDurationMs: durationMs || 0,
      createdAt: serverTimestamp()
    });

    await updateDoc(doc(db, "conversations", cid), {
      updatedAt: serverTimestamp(),
      lastMessageText: "🎤 Voice message",
      lastMessageAt: serverTimestamp(),
      lastSenderUid: u.uid,
      [`lastRead.${u.uid}`]: serverTimestamp()
    });
  }

  // ----------------------------
  // WEBRTC CALLS (ONE FILE)
  // ----------------------------
  const RTC_CFG = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ]
  };

  let __call = {
    active: false,
    callId: null,
    mode: "audio", // "audio" | "video"
    pc: null,
    localStream: null,
    remoteStream: null,
    unsubCallDoc: null,
    unsubRemoteCandidates: null,
    unsubIncoming: null,
    incomingEnabled: false
  };

  function closeCallUI() {
    const el = document.querySelector("#callOverlay");
    if (el) el.remove();
  }

  function openCallUI({ title = "Call", mode = "audio" } = {}) {
    const old = document.querySelector("#callOverlay");
    if (old) old.remove();

    const wrap = document.createElement("div");
    wrap.id = "callOverlay";
    wrap.style.cssText = `
      position:fixed; inset:0; z-index:100000;
      background:rgba(10,12,18,.92);
      display:flex; flex-direction:column;
      padding:14px;
    `;
    wrap.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div style="font-weight:900;font-size:18px">${safe(title)}</div>
        <button class="btn" id="callCloseBtn">Close</button>
      </div>
      <div style="height:10px"></div>

      <div style="flex:1;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start">
        <div style="flex:1;min-width:260px">
          <div class="muted small" style="margin-bottom:8px">You</div>
          <video id="callLocalVideo" playsinline autoplay muted
                 style="width:100%;max-height:42vh;border-radius:14px;background:#000;display:${mode === "video" ? "block" : "none"}"></video>
          <div id="callLocalAudioHint" class="muted small" style="display:${mode === "audio" ? "block" : "none"}">Audio call…</div>
        </div>

        <div style="flex:1;min-width:260px">
          <div class="muted small" style="margin-bottom:8px">Other person</div>
          <video id="callRemoteVideo" playsinline autoplay
                 style="width:100%;max-height:42vh;border-radius:14px;background:#000;display:${mode === "video" ? "block" : "none"}"></video>
          <audio id="callRemoteAudio" autoplay style="display:${mode === "audio" ? "block" : "none"}"></audio>
        </div>
      </div>

      <div style="height:12px"></div>

      <div class="card" style="background:rgba(20,24,34,.55)">
        <div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div class="muted small" id="callStatus">Connecting…</div>
          <div class="row" style="gap:10px">
            <button class="btn" id="callEndBtn">End</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    const closeBtn = wrap.querySelector("#callCloseBtn");
    if (closeBtn) closeBtn.onclick = () => closeCallUI();

    const endBtn = wrap.querySelector("#callEndBtn");
    if (endBtn) endBtn.onclick = () => {
      if (__call.callId) endCall(__call.callId);
      closeCallUI();
    };
  }

  function setCallStatus(msg) {
    const el = document.querySelector("#callStatus");
    if (el) el.textContent = msg;
  }

  async function setupPeerConnection(mode) {
    const pc = new RTCPeerConnection(RTC_CFG);

    const localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: mode === "video"
    });

    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    const remoteStream = new MediaStream();
    pc.ontrack = (ev) => {
      ev.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
      // attach
      const rv = document.querySelector("#callRemoteVideo");
      const ra = document.querySelector("#callRemoteAudio");
      if (rv && rv.srcObject !== remoteStream) rv.srcObject = remoteStream;
      if (ra && ra.srcObject !== remoteStream) ra.srcObject = remoteStream;
    };

    // attach local
    const lv = document.querySelector("#callLocalVideo");
    if (lv && mode === "video") lv.srcObject = localStream;

    return { pc, localStream, remoteStream };
  }

  function cleanupCallState() {
    try {
      if (__call.unsubCallDoc) { __call.unsubCallDoc(); __call.unsubCallDoc = null; }
      if (__call.unsubRemoteCandidates) { __call.unsubRemoteCandidates(); __call.unsubRemoteCandidates = null; }
    } catch {}

    try {
      if (__call.pc) __call.pc.ontrack = null;
    } catch {}

    try {
      if (__call.localStream) __call.localStream.getTracks().forEach(t => t.stop());
    } catch {}

    try {
      if (__call.pc) __call.pc.close();
    } catch {}

    __call.active = false;
    __call.callId = null;
    __call.mode = "audio";
    __call.pc = null;
    __call.localStream = null;
    __call.remoteStream = null;
  }

  async function endCall(callId) {
    try {
      await updateDoc(doc(db, "calls", callId), {
        status: "ended",
        endedAt: serverTimestamp()
      });
    } catch {}
    cleanupCallState();
  }

  async function startCall({ otherUid, mode = "audio", otherUsername = "" } = {}) {
    const u = auth.currentUser;
    if (!u?.uid) return toast("Login first");
    if (!otherUid) return toast("Missing user");
    if (u.uid === otherUid) return toast("You can’t call yourself");

    if (__call.active) return toast("Already in a call.");

    __call.active = true;
    __call.mode = mode;

    openCallUI({
      title: `${mode === "video" ? "Video" : "Audio"} call ${otherUsername ? `with @${otherUsername}` : ""}`,
      mode
    });
    setCallStatus("Starting call…");

    const callRef = await addDoc(collection(db, "calls"), {
      callerUid: u.uid,
      calleeUid: otherUid,
      mode,
      status: "ringing",
      createdAt: serverTimestamp()
    });

    const callId = callRef.id;
    __call.callId = callId;

    const { pc, localStream } = await setupPeerConnection(mode);
    __call.pc = pc;
    __call.localStream = localStream;

    // Caller ICE -> callerCandidates
    pc.onicecandidate = async (e) => {
      if (!e.candidate) return;
      try {
        await addDoc(collection(db, "calls", callId, "callerCandidates"), e.candidate.toJSON());
      } catch {}
    };

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await setDoc(doc(db, "calls", callId, "offers", "offer"), {
      sdp: offer.sdp,
      type: offer.type,
      createdAt: serverTimestamp()
    });

    setCallStatus("Ringing…");

    // Listen call doc status
    __call.unsubCallDoc = onSnapshot(doc(db, "calls", callId), async (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() || {};
      if (data.status === "ended") {
        setCallStatus("Call ended");
        cleanupCallState();
        closeCallUI();
      }
      if (data.status === "accepted") {
        setCallStatus("Connecting…");
      }
    });

    // Listen for answer
    __call.unsubRemoteCandidates = onSnapshot(
      collection(db, "calls", callId, "calleeCandidates"),
      async (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.type === "added") {
            try { await pc.addIceCandidate(new RTCIceCandidate(ch.doc.data())); } catch {}
          }
        }
      }
    );

    onSnapshot(doc(db, "calls", callId, "answers", "answer"), async (snap) => {
      if (!snap.exists()) return;
      const ans = snap.data();
      if (!ans?.sdp) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: ans.type, sdp: ans.sdp }));
        setCallStatus("In call ✅");
        try {
          await updateDoc(doc(db, "calls", callId), { status: "in_call" });
        } catch {}
      } catch (e) {
        setCallStatus("Failed to connect");
      }
    });
  }

  async function answerCall(callId) {
    const u = auth.currentUser;
    if (!u?.uid) return toast("Login first");
    if (__call.active) return toast("Already in a call.");

    const callDoc = await getDoc(doc(db, "calls", callId));
    if (!callDoc.exists()) return toast("Call not found.");
    const call = callDoc.data();

    if (call.status === "ended") return toast("Call already ended.");
    if (call.calleeUid !== u.uid) return toast("Not your call.");

    __call.active = true;
    __call.callId = callId;
    __call.mode = call.mode || "audio";

    openCallUI({
      title: `${__call.mode === "video" ? "Video" : "Audio"} call`,
      mode: __call.mode
    });
    setCallStatus("Answering…");

    const { pc, localStream } = await setupPeerConnection(__call.mode);
    __call.pc = pc;
    __call.localStream = localStream;

    // Callee ICE -> calleeCandidates
    pc.onicecandidate = async (e) => {
      if (!e.candidate) return;
      try {
        await addDoc(collection(db, "calls", callId, "calleeCandidates"), e.candidate.toJSON());
      } catch {}
    };

    // Load offer
    const offerSnap = await getDoc(doc(db, "calls", callId, "offers", "offer"));
    if (!offerSnap.exists()) {
      toast("Offer missing.");
      cleanupCallState();
      closeCallUI();
      return;
    }
    const offer = offerSnap.data();

    await pc.setRemoteDescription(new RTCSessionDescription({ type: offer.type, sdp: offer.sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await setDoc(doc(db, "calls", callId, "answers", "answer"), {
      sdp: answer.sdp,
      type: answer.type,
      createdAt: serverTimestamp()
    });

    try {
      await updateDoc(doc(db, "calls", callId), { status: "accepted", acceptedAt: serverTimestamp() });
    } catch {}

    // Listen caller candidates
    __call.unsubRemoteCandidates = onSnapshot(
      collection(db, "calls", callId, "callerCandidates"),
      async (snap) => {
        for (const ch of snap.docChanges()) {
          if (ch.type === "added") {
            try { await pc.addIceCandidate(new RTCIceCandidate(ch.doc.data())); } catch {}
          }
        }
      }
    );

    // Listen ended
    __call.unsubCallDoc = onSnapshot(doc(db, "calls", callId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() || {};
      if (data.status === "ended") {
        setCallStatus("Call ended");
        cleanupCallState();
        closeCallUI();
      } else if (data.status === "in_call" || data.status === "accepted") {
        setCallStatus("In call ✅");
      }
    });
  }

  function showIncomingCallBanner(callId, mode, fromUid) {
    const old = document.querySelector("#incomingCallBar");
    if (old) old.remove();

    const bar = document.createElement("div");
    bar.id = "incomingCallBar";
    bar.style.cssText = `
      position:fixed; left:12px; right:12px; bottom:86px; z-index:100001;
      background:rgba(20,24,34,.95); border:1px solid rgba(39,48,71,.8);
      border-radius:16px; padding:12px;
      display:flex; justify-content:space-between; align-items:center; gap:10px;
      box-shadow:0 10px 30px rgba(0,0,0,.45);
    `;
    bar.innerHTML = `
      <div style="min-width:0">
        <div style="font-weight:900">Incoming ${mode === "video" ? "video" : "audio"} call</div>
        <div class="muted small" style="margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          From ${safe(fromUid.slice(0, 10))}
        </div>
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn" id="declineCallBtn">Decline</button>
        <button class="btn primary" id="answerCallBtn">Answer</button>
      </div>
    `;
    document.body.appendChild(bar);

    bar.querySelector("#declineCallBtn").onclick = async () => {
      try { await updateDoc(doc(db, "calls", callId), { status: "ended", endedAt: serverTimestamp() }); } catch {}
      bar.remove();
    };
    bar.querySelector("#answerCallBtn").onclick = async () => {
      bar.remove();
      await answerCall(callId);
    };
  }

  function startIncomingListener() {
    const u = auth.currentUser;
    if (!u?.uid) return;
    if (__call.incomingEnabled) return;
    __call.incomingEnabled = true;

    // Only show calls where I am callee and status is "ringing"
    const qy = query(
      collection(db, "calls"),
      where("calleeUid", "==", u.uid),
      where("status", "==", "ringing"),
      orderBy("createdAt", "desc"),
      limit(1)
    );

    __call.unsubIncoming = onSnapshot(qy, (snap) => {
      if (snap.empty) return;
      const d = snap.docs[0];
      const call = d.data() || {};
      if (!d.id) return;

      // Avoid popping while already active
      if (__call.active) return;

      showIncomingCallBanner(d.id, call.mode || "audio", call.callerUid || "");
    });
  }

  function stopIncomingListener() {
    __call.incomingEnabled = false;
    if (__call.unsubIncoming) { try { __call.unsubIncoming(); } catch {} }
    __call.unsubIncoming = null;
    const bar = document.querySelector("#incomingCallBar");
    if (bar) bar.remove();
  }

  // ----------------------------
  // SUBSCRIPTIONS (MESSAGES)
  // ----------------------------
  let unsubList = null;
  let unsubChat = null;

  function cleanupChat() {
    if (unsubChat) { unsubChat(); unsubChat = null; }
  }
  function cleanupAll() {
    cleanupChat();
    if (unsubList) { unsubList(); unsubList = null; }
  }

  // ----------------------------
  // INBOX RENDER
  // ----------------------------
  let lastInboxItems = [];

  function renderInboxList(items, filterText = "") {
    const host = $("#mList");
    if (!host) return;

    const q = (filterText || "").trim().toLowerCase();
    const filtered = !q ? items : items.filter((row) => {
      const t = (row.__searchText || "").toLowerCase();
      return t.includes(q);
    });

    if (!filtered.length) {
      host.innerHTML = `<div class="muted small">${q ? "No results." : "No messages yet."}</div>`;
      return;
    }

    host.innerHTML = filtered.map((c) => c.__html).join("");

    host.querySelectorAll("[data-openchat]").forEach((el) => {
      if (el.__wired) return;
      el.__wired = true;
      el.addEventListener("click", async () => {
        const cid = el.getAttribute("data-openchat");
        if (cid) await openChat(cid);
      });
    });
  }

  // ----------------------------
  // MESSAGES HOME (FULL PAGE)
  // ----------------------------
  async function openMessagesHome() {
    const u = auth.currentUser;
    if (!u?.uid) return toast("Login first");

    startIncomingListener();

    openPage(`
      <div class="row" style="justify-content:space-between;align-items:center;gap:10px">
        <div class="title">Messages</div>
        <button class="btn" id="mClose">Close</button>
      </div>

      <div class="divider"></div>

      <input id="mSearch" placeholder="Search inbox..." />

      <div class="divider"></div>

      <div class="card" style="background:rgba(20,24,34,.55)">
        <div class="small muted">Start a new chat</div>
        <div class="row" style="margin-top:8px;gap:10px;align-items:center;flex-wrap:wrap">
          <input id="mNewUser" placeholder="@username" style="flex:1;min-width:170px" />
          <button class="btn primary" id="mStart">Search</button>
        </div>

        <div id="mSearchResults" style="margin-top:10px"></div>
      </div>

      <div class="divider"></div>

      <div class="title" style="margin-bottom:8px">Inbox</div>
      <div id="mList" class="grid"><div class="muted small">Loading…</div></div>
    `);

    const closeBtn = $("#mClose");
    if (closeBtn) closeBtn.onclick = () => { cleanupAll(); closePage(); };

    const searchEl = $("#mSearch");
    if (searchEl && !searchEl.__wired) {
      searchEl.__wired = true;
      searchEl.addEventListener("input", () => {
        renderInboxList(lastInboxItems, searchEl.value || "");
      });
    }

    // Search username + prefix list
    const startBtn = $("#mStart");
    if (startBtn && !startBtn.__wired) {
      startBtn.__wired = true;
      startBtn.onclick = async () => {
        const name = ($("#mNewUser")?.value || "").trim();
        const res = $("#mSearchResults");
        if (!name) return toast("Enter a username.");
        if (res) res.innerHTML = `<div class="muted small">Searching…</div>`;

        startBtn.disabled = true;
        startBtn.textContent = "Searching…";

        try {
          const exact = await getUserByUsername(name);
          const list = await searchUsersPrefix(name);

          // Merge unique by uid (exact first)
          const map = new Map();
          if (exact?.uid) map.set(exact.uid, exact);
          for (const it of list) if (it?.uid) map.set(it.uid, it);

          const arr = Array.from(map.values())
            .filter(x => x?.uid && x.uid !== auth.currentUser.uid)
            .slice(0, 10);

          if (!arr.length) {
            if (res) res.innerHTML = `<div class="muted small">No users found.</div>`;
            return;
          }

          if (res) {
            res.innerHTML = arr.map(user => {
              const uname = safe(user.username || user.uid.slice(0, 8));
              const verified = user.verified ? `<span class="verified">✓</span>` : "";
              return `
                <div class="card" style="background:rgba(20,24,34,.55);display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px">
                  <div style="min-width:0;flex:1">
                    <div style="font-weight:900">@${uname} ${verified}</div>
                    <div class="muted small" style="margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                      Tap Message to chat
                    </div>
                  </div>
                  <button class="btn primary" data-msgbtn="${safe(user.uid)}">Message</button>
                </div>
              `;
            }).join("");

            res.querySelectorAll("[data-msgbtn]").forEach((btn) => {
              if (btn.__wired) return;
              btn.__wired = true;
              btn.addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const otherUid = btn.getAttribute("data-msgbtn");
                if (!otherUid) return;

                btn.disabled = true;
                const old = btn.textContent;
                btn.textContent = "Opening…";
                try {
                  const cid = await ensureConversation(otherUid);
                  await openChat(cid);
                } catch (err) {
                  toast(err?.message || "Could not open chat");
                } finally {
                  btn.disabled = false;
                  btn.textContent = old;
                }
              });
            });
          }
        } catch (e) {
          if (res) res.innerHTML = `<div class="muted small">Search failed.</div>`;
          toast(e?.message || "Search failed");
        } finally {
          startBtn.disabled = false;
          startBtn.textContent = "Search";
        }
      };
    }

    // Inbox listener
    if (unsubList) unsubList();

    const qy = query(
      collection(db, "conversations"),
      where("participants", "array-contains", u.uid),
      orderBy("updatedAt", "desc"),
      limit(60)
    );

    unsubList = onSnapshot(qy, async (snap) => {
      try {
        const raw = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (!raw.length) {
          lastInboxItems = [];
          renderInboxList([], ($("#mSearch")?.value || ""));
          return;
        }

        const out = [];
        for (const c of raw) {
          const otherUid = (c.participants || []).find(x => x !== u.uid) || "";
          const other = await getUser(otherUid);

          const uname = safe(other?.username || otherUid.slice(0, 8));
          const verified = other?.verified ? `<span class="verified">✓</span>` : "";
          const last = safe(c.lastMessageText || "");
          const when = c.lastMessageAt ? timeAgo(c.lastMessageAt) : "";
          const unread = unreadForMe(c);

          const html = `
            <div class="card" style="background:rgba(20,24,34,.55);cursor:pointer" data-openchat="${safe(c.id)}">
              <div class="row" style="justify-content:space-between;gap:10px;align-items:flex-start">
                <div style="min-width:0;flex:1">
                  <div style="font-weight:900">
                    @${uname} ${verified}
                    ${unread ? `<span class="pill" style="margin-left:8px">unread</span>` : ``}
                  </div>
                  <div class="muted small" style="margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                    ${last || `<span class="muted">No messages yet</span>`}
                  </div>
                </div>
                <div class="muted small">${when}</div>
              </div>
            </div>
          `;

          out.push({
            __html: html,
            __searchText: `@${other?.username || ""} ${c.lastMessageText || ""}`.trim()
          });
        }

        lastInboxItems = out;
        renderInboxList(lastInboxItems, ($("#mSearch")?.value || ""));
      } catch (err) {
        const host = $("#mList");
        if (host) host.innerHTML = `<div class="muted small">Load failed: ${safe(err?.message || err)}</div>`;
      }
    }, (err) => {
      const host = $("#mList");
      if (host) host.innerHTML = `<div class="muted small">Load failed: ${safe(err?.message || err)}</div>`;
    });
  }

  // ----------------------------
  // CHAT (FULL PAGE)
  // ----------------------------
  async function openChat(cid) {
    const u = auth.currentUser;
    if (!u?.uid) return toast("Login first");

    startIncomingListener();

    const convSnap = await getDoc(doc(db, "conversations", cid));
    if (!convSnap.exists()) return toast("Chat not found.");
    const conv = convSnap.data();

    const otherUid = Array.isArray(conv.participants)
      ? conv.participants.find(x => x && x !== u.uid)
      : null;

    if (!otherUid) {
      console.error("[CALL] Missing otherUid", { participants: conv.participants, myUid: u?.uid, cid });
      toast("Call cannot start: missing other user");
      return;
    }
    const other = await getUser(otherUid);
    const uname = safe(other?.username || otherUid.slice(0, 8));
    const verified = other?.verified ? `<span class="verified">✓</span>` : "";

    openPage(`
      <div class="row" style="justify-content:space-between;align-items:center;gap:10px">
        <div class="title" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          @${uname} ${verified}
        </div>

        <div class="row" style="gap:10px;flex-wrap:wrap;justify-content:flex-end">
          <button class="btn" data-call data-uid="${otherUid}">📞</button>
          <button class="btn" data-videocall data-uid="${otherUid}">🎥</button>
          <button class="btn" id="mBack">← Back</button>
          <button class="btn" id="mClose">Close</button>
        </div>
      </div>

      <div class="divider"></div>

      <div id="chatList" class="grid" style="gap:10px;max-height:56vh;overflow:auto;padding-bottom:6px">
        <div class="muted small">Loading…</div>
      </div>

      <div class="divider"></div>

      <div class="card" style="background:rgba(20,24,34,.55)">
        <textarea id="chatText" placeholder="Message..."></textarea>

        <div class="row" style="justify-content:space-between;align-items:center;margin-top:10px;gap:10px;flex-wrap:wrap">
          <div class="muted small" id="recHint">${storage ? "🎤 Hold to record voice" : "🎤 Voice needs storage enabled"}</div>
          <div class="row" style="gap:10px">
            <button class="btn" id="chatVoice" ${storage ? "" : "disabled"}>🎤</button>
            <button class="btn primary" id="chatSend">Send</button>
          </div>
        </div>
      </div>
    `);

    const closeBtn = $("#mClose");
    if (closeBtn) closeBtn.onclick = () => { cleanupAll(); closePage(); };

    const backBtn = $("#mBack");
    if (backBtn) backBtn.onclick = async () => { cleanupChat(); await openMessagesHome(); };

    // Call buttons
    const audioBtn = $("#callAudioBtn");
    if (audioBtn && !audioBtn.__wired) {
      audioBtn.__wired = true;
      audioBtn.onclick = async () => {
        try { await startCall({ otherUid, mode: "audio", otherUsername: other?.username || "" }); }
        catch (e) { toast(e?.message || "Call failed"); }
      };
    }

    const videoBtn = $("#callVideoBtn");
    if (videoBtn && !videoBtn.__wired) {
      videoBtn.__wired = true;
      videoBtn.onclick = async () => {
        try { await startCall({ otherUid, mode: "video", otherUsername: other?.username || "" }); }
        catch (e) { toast(e?.message || "Video call failed"); }
      };
    }

    await markRead(cid);
    cleanupChat();

    const qy = query(
      collection(db, "conversations", cid, "messages"),
      orderBy("createdAt", "asc"),
      limit(250)
    );

    unsubChat = onSnapshot(qy, async (snap) => {
      try {
        const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const host = $("#chatList");
        if (!host) return;

        if (!msgs.length) {
          host.innerHTML = `<div class="muted small">No messages yet. Say hi 👋</div>`;
        } else {
          host.innerHTML = msgs.map(m => {
            const mine = m.fromUid === u.uid;
            const when = m.createdAt ? timeAgo(m.createdAt) : "";

            let body = "";
            if ((m.type || "text") === "audio" && m.audioUrl) {
              body = `
                <audio controls playsinline preload="none" style="width:260px;max-width:100%">
                  <source src="${safe(m.audioUrl)}" type="audio/webm">
                </audio>
              `;
            } else {
              body = `<div style="white-space:pre-wrap">${safe(m.text || "")}</div>`;
            }

            return `
              <div style="display:flex;justify-content:${mine ? "flex-end" : "flex-start"}">
                <div class="card" style="
                  background:${mine ? "rgba(79,124,255,.18)" : "rgba(20,24,34,.55)"};
                  border-color:${mine ? "rgba(79,124,255,.35)" : "rgba(39,48,71,.75)"};
                  max-width:85%;
                ">
                  ${body}
                  <div class="muted small" style="margin-top:6px;text-align:right">${when}</div>
                </div>
              </div>
            `;
          }).join("");

          setTimeout(() => { host.scrollTop = host.scrollHeight; }, 0);
        }

        await markRead(cid);
      } catch (err) {
        const host = $("#chatList");
        if (host) host.innerHTML = `<div class="muted small">Chat load failed: ${safe(err?.message || err)}</div>`;
      }
    }, (err) => {
      const host = $("#chatList");
      if (host) host.innerHTML = `<div class="muted small">Chat load failed: ${safe(err?.message || err)}</div>`;
    });

    // Send text
    const sendBtn = $("#chatSend");
    if (sendBtn) {
      sendBtn.onclick = async () => {
        const t = ($("#chatText")?.value || "").trim();
        if (!t) return toast("Write something.");

        sendBtn.disabled = true;
        sendBtn.textContent = "Sending…";

        try {
          await sendTextMessage(cid, t);
          $("#chatText").value = "";
        } catch (e) {
          toast(e?.message || "Send failed");
        } finally {
          sendBtn.disabled = false;
          sendBtn.textContent = "Send";
        }
      };
    }

    // Voice recording (hold-to-record)
    const voiceBtn = $("#chatVoice");
    if (voiceBtn && storage) {
      let mediaRecorder = null;
      let chunks = [];
      let startedAt = 0;
      let recording = false;
      let stream = null;

      async function startRec() {
        if (recording) return;
        recording = true;
        chunks = [];
        startedAt = Date.now();

        const hint = $("#recHint");
        if (hint) hint.textContent = "Recording… release to send";

        stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Some webviews are picky; set audio mime when possible
        let opts = {};
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
          opts.mimeType = "audio/webm;codecs=opus";
        } else if (MediaRecorder.isTypeSupported("audio/webm")) {
          opts.mimeType = "audio/webm";
        }

        mediaRecorder = new MediaRecorder(stream, opts);

        mediaRecorder.ondataavailable = (e) => {
          if (e.data?.size) chunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
          try {
            const blob = new Blob(chunks, { type: "audio/webm" });
            const dur = Date.now() - startedAt;
            await sendAudioMessage(cid, blob, dur);
            toast("Voice sent ✅");
          } catch (e) {
            toast(e?.message || "Voice send failed");
          } finally {
            try { stream?.getTracks()?.forEach(t => t.stop()); } catch {}
            stream = null;
            const hint2 = $("#recHint");
            if (hint2) hint2.textContent = "🎤 Hold to record voice";
            recording = false;
          }
        };

        mediaRecorder.start();
      }

      function stopRec() {
        if (!recording) return;
        try { mediaRecorder.stop(); } catch {}
      }

      if (!voiceBtn.__wired) {
        voiceBtn.__wired = true;

        voiceBtn.addEventListener("mousedown", async () => {
          try { await startRec(); } catch (e) { recording = false; toast(e?.message || "Mic failed"); }
        });
        voiceBtn.addEventListener("mouseup", () => stopRec());
        voiceBtn.addEventListener("mouseleave", () => stopRec());

        voiceBtn.addEventListener("touchstart", async (e) => {
          e.preventDefault();
          try { await startRec(); } catch (err) { recording = false; toast(err?.message || "Mic failed"); }
        }, { passive: false });

        voiceBtn.addEventListener("touchend", (e) => {
          e.preventDefault();
          stopRec();
        }, { passive: false });
      }
    } else if (voiceBtn && !storage) {
      if (!voiceBtn.__wired) {
        voiceBtn.__wired = true;
        voiceBtn.addEventListener("click", () => toast("Voice notes need Storage enabled."));
      }
    }
  }

  // ----------------------------
  // SIDE DRAWER BUTTON (IF DRAWER EXISTS)
  // ----------------------------
  function injectDrawerItem() {
    const drawer = $("#drawer");
    if (!drawer) return false;
    if (drawer.querySelector("#drawerMessages")) return true;

    const item = document.createElement("div");
    item.className = "item";
    item.id = "drawerMessages";
    item.innerHTML = `<div class="ico">💬</div><div>Messages</div>`;

    item.addEventListener("click", async () => {
      drawer.classList.remove("open");
      const bd = $("#drawerBackdrop");
      if (bd) bd.classList.remove("open");
      await openMessagesHome();
    });

    const notif = drawer.querySelector('.item[data-go="notifications"]');
    if (notif?.parentNode) notif.parentNode.insertBefore(item, notif.nextSibling);
    else drawer.appendChild(item);

    return true;
  }

  // ----------------------------
  // BOTTOM BAR MESSAGES BUTTON (CLONE REAL TAB)
  // ----------------------------
  function findBottomBar() {
    return (
      document.querySelector("#bottomBar") ||
      document.querySelector("#bottomNav") ||
      document.querySelector(".bottombar") ||
      document.querySelector(".bottomBar") ||
      document.querySelector(".tabbar") ||
      document.querySelector("[data-bottombar]") ||
      document.querySelector("[data-tabbar]") ||
      null
    );
  }

  function injectBottomBarItem() {
    const bar = findBottomBar();
    if (!bar) return false;
    if (bar.querySelector("#bottomMessages")) return true;

    const profileTab =
      bar.querySelector('[data-go="profile"]') ||
      bar.querySelector("#tabProfile") ||
      bar.querySelector(".profile") ||
      bar.querySelector('[href="#profile"]') ||
      null;

    const template = profileTab || bar.firstElementChild;
    if (!template) return false;

    const fresh = template.cloneNode(true);
    fresh.id = "bottomMessages";

    // Remove routing from root + children
    fresh.removeAttribute("href");
    fresh.removeAttribute("data-go");
    fresh.removeAttribute("onclick");
    fresh.querySelectorAll("*").forEach((el) => {
      el.removeAttribute("href");
      el.removeAttribute("data-go");
      el.removeAttribute("onclick");
    });

    // Label
    const txt =
      fresh.querySelector(".label") ||
      fresh.querySelector(".text") ||
      fresh.querySelector("[data-label]") ||
      fresh.querySelector("span") ||
      null;
    if (txt) txt.textContent = "Messages";

    // Icon
    const ico =
      fresh.querySelector(".ico") ||
      fresh.querySelector(".icon") ||
      fresh.querySelector("[data-icon]") ||
      null;
    if (ico) ico.textContent = "💬";

    fresh.style.pointerEvents = "auto";
    fresh.style.cursor = "pointer";
    fresh.style.userSelect = "none";
    fresh.style.webkitTapHighlightColor = "transparent";

    fresh.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      try {
        await openMessagesHome();
      } catch (err) {
        console.warn("openMessagesHome failed:", err);
      }
    }, true);

    // Place next to profile if possible, else append
    if (profileTab && profileTab.parentNode === bar) {
      bar.insertBefore(fresh, profileTab);
    } else {
      bar.appendChild(fresh);
    }

    return true;
  }

  function safeInjectUI() {
    try { injectBottomBarItem(); } catch (e) { console.warn("Bottom bar inject failed:", e); }
    try { injectDrawerItem(); } catch (e) { /* ignore */ }
  }

  // Keep injecting as UI renders
  safeInjectUI();
  const __msgsObs = new MutationObserver(() => safeInjectUI());
  const __root = document.querySelector("#app") || document.body;
  __msgsObs.observe(__root, { childList: true, subtree: true });

  // Manual hooks (optional)
  window.openMessages = openMessagesHome;
  window.echoCalls = { startCall, answerCall, endCall, startIncomingListener, stopIncomingListener };
}
