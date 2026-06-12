// calls.js (FULL FILE) — Firestore WebRTC signaling + full-screen UI
// Usage in index.html:
//   import { installCalls } from "./calls.js";
//   installCalls({ auth, db });

import {
  collection,
  doc,
  addDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* ----------------------------- STATE ----------------------------- */

let _auth = null;
let _db = null;

let state = "idle"; // idle | outgoing | incoming | connecting | inCall
let mode = "audio"; // audio | video
let callRole = null; // caller | callee

let currentCallId = null;
let currentCallUnsub = null;
let offerCandidatesUnsub = null;
let answerCandidatesUnsub = null;
let incomingUnsub = null;

let pc = null;
let localStream = null;
let remoteStream = null;

let pendingIncoming = null; // { callId, data }

let clickWired = false;
let uiReady = false;
let stylesInjected = false;

let callTimeoutTimer = null;

const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

/* ----------------------------- PUBLIC API ----------------------------- */

export function installCalls({ auth, db }) {
  _auth = auth;
  _db = db;

  ensureUI();
  ensureStyles();
  wireClicksOnce();

  console.log("[Calls] installed");

  onAuthStateChanged(_auth, (user) => {
    if (!user) {
      stopIncomingListener();
      hardReset();
      return;
    }
    startIncomingListener(user.uid);
  });
}

/* ----------------------------- UI ----------------------------- */

function ensureUI() {
  if (uiReady) return;
  uiReady = true;

  const overlay = document.createElement("div");
  overlay.id = "callOverlay";
  overlay.className = "hidden";
  overlay.innerHTML = `
    <div class="callTopBar">
      <div class="callTitleWrap">
        <div class="callName" id="callName">Call</div>
        <div class="callStatus" id="callStatus">Ready</div>
      </div>
      <button class="callBtn ghost" id="callMinimizeBtn" title="Minimize">▾</button>
    </div>

    <div class="callMain" id="callMain">
      <div class="callAvatar" id="callAvatar">👤</div>
    </div>

    <div class="callVideoArea hidden" id="callVideoArea">
      <video id="remoteVideo" playsinline autoplay></video>
      <video id="localVideo" playsinline autoplay muted></video>
    </div>

    <div class="callControls" id="callControls">
      <div class="row">
        <button class="callBtn" id="btnMute">🎙️</button>
        <button class="callBtn" id="btnSpeaker">🔊</button>
        <button class="callBtn" id="btnSwitchCam">🔁</button>
      </div>

      <div class="row">
        <button class="callBtn green hidden" id="btnAccept">✅ Accept</button>
        <button class="callBtn red hidden" id="btnDecline">❌ Decline</button>
      </div>

      <div class="row">
        <button class="callBtn red" id="btnEnd">⛔ End</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  byId("btnEnd").addEventListener("click", () => endCall("ended"));
  byId("btnDecline").addEventListener("click", () => declineIncoming());
  byId("btnAccept").addEventListener("click", () => acceptIncoming());
  byId("btnMute").addEventListener("click", () => toggleMute());
  byId("btnSpeaker").addEventListener("click", () => toggleSpeaker());
  byId("btnSwitchCam").addEventListener("click", () => switchCamera());
  byId("callMinimizeBtn").addEventListener("click", () => hideOverlay());
}

function ensureStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    #callOverlay{
      position:fixed; inset:0; z-index:999999;
      background:rgba(10,12,16,.92);
      display:flex; flex-direction:column;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;
      color:#fff;
    }
    #callOverlay.hidden{ display:none; }

    #callOverlay .callTopBar{
      display:flex; align-items:center; justify-content:space-between;
      padding:14px 14px 10px;
      z-index:6;
    }
    .callTitleWrap{ display:flex; flex-direction:column; gap:4px; }
    .callName{ font-weight:700; font-size:18px; }
    .callStatus{ opacity:.8; font-size:13px; }

    #callOverlay .callMain{
      flex:1; display:flex; align-items:center; justify-content:center;
      padding:12px;
      z-index:2;
    }
    .callAvatar{
      width:110px; height:110px; border-radius:999px;
      background:rgba(255,255,255,.08);
      display:flex; align-items:center; justify-content:center;
      font-size:46px;
      box-shadow:0 14px 40px rgba(0,0,0,.35);
    }

    #callOverlay .callVideoArea{
      position:absolute; inset:0; z-index:1;
      background:#000;
    }
    #callOverlay .callVideoArea.hidden{ display:none; }

    #callOverlay video{
      position:absolute; inset:0;
      width:100%; height:100%;
      object-fit:cover;
      background:#000;
    }
    #localVideo{
      width:120px; height:160px;
      position:absolute; right:14px; top:64px;
      border-radius:14px;
      border:1px solid rgba(255,255,255,.18);
      object-fit:cover;
      z-index:3;
    }

    #callOverlay .callControls{
      z-index:7;
      padding:14px;
      display:flex; flex-direction:column; gap:12px;
      background:linear-gradient(180deg, rgba(10,12,16,0), rgba(10,12,16,.92));
    }
    #callOverlay .row{
      display:flex; gap:10px; justify-content:center; flex-wrap:wrap;
    }
    .callBtn{
      border:none; border-radius:999px;
      padding:12px 16px;
      font-size:15px;
      background:rgba(255,255,255,.10);
      color:#fff;
      min-width:56px;
    }
    .callBtn:active{ transform:scale(.98); }
    .callBtn.ghost{ background:rgba(255,255,255,.06); }
    .callBtn.red{ background:#e54848; }
    .callBtn.green{ background:#2aa96b; }
    .callBtn.hidden{ display:none; }

    #callOverlay.videoOn .callMain{ display:none; }
  `;
  document.head.appendChild(style);
}

function showOverlay() {
  byId("callOverlay")?.classList.remove("hidden");
}

function hideOverlay() {
  byId("callOverlay")?.classList.add("hidden");
}

function setCallScreen({ name, status, showAcceptDecline, showEnd, showVideo }) {
  showOverlay();

  const overlay = byId("callOverlay");
  overlay?.classList.toggle("videoOn", !!showVideo);

  setText("callName", name || "Call");
  setText("callStatus", status || "");

  byId("btnAccept")?.classList.toggle("hidden", !showAcceptDecline);
  byId("btnDecline")?.classList.toggle("hidden", !showAcceptDecline);
  byId("btnEnd")?.classList.toggle("hidden", !showEnd);

  byId("callVideoArea")?.classList.toggle("hidden", !showVideo);

  // switch cam only for video
  byId("btnSwitchCam")?.classList.toggle("hidden", !showVideo);
}

function setText(id, text) {
  const el = byId(id);
  if (el) el.textContent = text;
}

function byId(id) {
  return document.getElementById(id);
}

/* ----------------------------- BUTTON WIRING ----------------------------- */

function wireClicksOnce() {
  if (clickWired) return;
  clickWired = true;

  // Delegated clicks for dynamic buttons
  document.addEventListener("click", (e) => {
    const callBtn = e.target.closest("[data-call]");
    const videoBtn = e.target.closest("[data-videocall]");
    if (!callBtn && !videoBtn) return;

    const btn = callBtn || videoBtn;
    const uid = btn.getAttribute("data-uid") || btn.dataset.uid;

    if (!uid) {
      alert("Call error: missing data-uid on button");
      return;
    }
    if (!_auth?.currentUser) {
      alert("Login first.");
      return;
    }

    // Fix “second click doesn’t work”: always reset and start clean
    if (state !== "idle") hardReset();

    startOutgoing(uid, videoBtn ? "video" : "audio").catch((err) => {
      console.error(err);
      alert("Call failed: " + (err?.message || err));
      hardReset();
    });
  });
}

/* ----------------------------- INCOMING LISTENER ----------------------------- */

function startIncomingListener(myUid) {
  stopIncomingListener();

  // IMPORTANT: do NOT orderBy serverTimestamp field (it can be null at first).
  // Just listen for any "calling" directed to me.
  const callsRef = collection(_db, "calls");
  const qy = query(
    callsRef,
    where("toUid", "==", myUid),
    where("status", "==", "calling"),
    limit(5)
  );

  incomingUnsub = onSnapshot(
    qy,
    (snap) => {
      if (state !== "idle") return;

      // pick newest by clientCreatedAt if present, else first
      let best = null;
      for (const d of snap.docs) {
        const data = d.data();
        if (!best) best = { id: d.id, data };
        else {
          const a = best.data.clientCreatedAt || 0;
          const b = data.clientCreatedAt || 0;
          if (b > a) best = { id: d.id, data };
        }
      }
      if (!best) return;

      pendingIncoming = { callId: best.id, data: best.data };
      state = "incoming";
      mode = best.data.mode || "audio";
      callRole = "callee";
      currentCallId = best.id;

      setCallScreen({
        name: best.data.fromName || "Incoming call",
        status: mode === "video" ? "Incoming video call…" : "Incoming audio call…",
        showAcceptDecline: true,
        showEnd: false,
        showVideo: false
      });
    },
    (err) => console.error("[Calls] incoming listener error", err)
  );
}

function stopIncomingListener() {
  if (incomingUnsub) {
    incomingUnsub();
    incomingUnsub = null;
  }
}

/* ----------------------------- OUTGOING CALL ----------------------------- */

async function startOutgoing(toUid, callMode) {
  const me = _auth.currentUser;
  if (!me) throw new Error("Not logged in");

  state = "outgoing";
  mode = callMode;
  callRole = "caller";

  setCallScreen({
    name: "Calling…",
    status: callMode === "video" ? "Starting video call…" : "Starting audio call…",
    showAcceptDecline: false,
    showEnd: true,
    showVideo: callMode === "video"
  });

  // Create call doc first (include clientCreatedAt so callee can sort even before server timestamps)
  const callDoc = await addDoc(collection(_db, "calls"), {
    fromUid: me.uid,
    toUid,
    mode: callMode,
    status: "calling",
    clientCreatedAt: Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  currentCallId = callDoc.id;

  // Build peer connection + local media
  await setupPeerConnection(callMode);

  // SAFETY: pc must exist
  if (!pc) throw new Error("PeerConnection not created");

  // ICE candidates -> offerCandidates (SET THIS BEFORE createOffer to avoid missing early ICE)
  const offerCandRef = collection(_db, "calls", currentCallId, "offerCandidates");
  pc.onicecandidate = async (event) => {
    if (!event.candidate) return;
    try {
      await addDoc(offerCandRef, event.candidate.toJSON());
    } catch (e) {
      console.warn("[Calls] add offer candidate failed", e);
    }
  };

  // Offer
  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: callMode === "video"
  });
  await pc.setLocalDescription(offer);

  await updateDoc(doc(_db, "calls", currentCallId), {
    offer: { type: offer.type, sdp: offer.sdp },
    status: "calling",
    updatedAt: serverTimestamp()
  });

  // Watch call doc for answer / declined / ended
  subscribeCallDoc();

  // Watch answer candidates
  subscribeAnswerCandidates();

  state = "connecting";
  setCallScreen({
    name: "Calling…",
    status: "Ringing…",
    showAcceptDecline: false,
    showEnd: true,
    showVideo: callMode === "video"
  });

  // Timeout: if nobody answers in 35s, end
  clearCallTimeout();
  callTimeoutTimer = setTimeout(() => {
    if (state === "connecting" || state === "outgoing") {
      setText("callStatus", "No answer");
      endCall("ended");
    }
  }, 35000);
}

/* ----------------------------- ACCEPT / DECLINE ----------------------------- */

async function acceptIncoming() {
  try {
    if (!pendingIncoming?.callId) return;

    const callId = pendingIncoming.callId;
    const data = pendingIncoming.data;

    currentCallId = callId;
    state = "connecting";
    mode = data.mode || "audio";
    callRole = "callee";

    setCallScreen({
      name: data.fromName || "Call",
      status: mode === "video" ? "Connecting video…" : "Connecting audio…",
      showAcceptDecline: false,
      showEnd: true,
      showVideo: mode === "video"
    });

    await setupPeerConnection(mode);
    if (!pc) throw new Error("PeerConnection not created");

    // Load offer
    const callRef = doc(_db, "calls", callId);
    const snap = await getDoc(callRef);
    if (!snap.exists()) throw new Error("Call missing");

    const callData = snap.data();
    if (!callData.offer?.sdp) throw new Error("Missing offer");

    await pc.setRemoteDescription(new RTCSessionDescription(callData.offer));

    // ICE candidates -> answerCandidates (set BEFORE answer)
    const answerCandRef = collection(_db, "calls", callId, "answerCandidates");
    pc.onicecandidate = async (event) => {
      if (!event.candidate) return;
      try {
        await addDoc(answerCandRef, event.candidate.toJSON());
      } catch (e) {
        console.warn("[Calls] add answer candidate failed", e);
      }
    };

    // Create answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await updateDoc(callRef, {
      answer: { type: answer.type, sdp: answer.sdp },
      status: "accepted",
      updatedAt: serverTimestamp()
    });

    // Listen for offer candidates
    subscribeOfferCandidates();

    // Listen for end/decline cleanup
    subscribeCallDoc();

    pendingIncoming = null;
    clearCallTimeout();
  } catch (err) {
    console.error(err);
    alert("Call failed: " + (err?.message || err));
    hardReset();
  }
}

async function declineIncoming() {
  try {
    if (!pendingIncoming?.callId) {
      hardReset();
      return;
    }
    const callId = pendingIncoming.callId;
    await updateDoc(doc(_db, "calls", callId), {
      status: "declined",
      updatedAt: serverTimestamp()
    });
  } catch (e) {
    console.warn(e);
  } finally {
    pendingIncoming = null;
    hardReset();
  }
}

/* ----------------------------- PEER CONNECTION ----------------------------- */

async function setupPeerConnection(callMode) {
  cleanupPeer();

  pc = new RTCPeerConnection(RTC_CONFIG);

  remoteStream = new MediaStream();
  const remoteVideo = byId("remoteVideo");
  if (remoteVideo) remoteVideo.srcObject = remoteStream;

  pc.ontrack = (event) => {
    const stream = event.streams?.[0];
    if (stream) {
      stream.getTracks().forEach((t) => remoteStream.addTrack(t));
    } else {
      remoteStream.addTrack(event.track);
    }

    if (state !== "inCall") {
      state = "inCall";
      setText("callStatus", "In call");
    }
  };

  pc.onconnectionstatechange = () => {
    const s = pc?.connectionState;
    if (s === "connected") {
      state = "inCall";
      setText("callStatus", "In call");
      clearCallTimeout();
    } else if (s === "failed" || s === "disconnected") {
      setText("callStatus", "Connection " + s);
    }
  };

  const wantVideo = callMode === "video";
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: wantVideo ? { facingMode: "user" } : false
    });
  } catch (err) {
    // If camera fails, fall back to audio only
    if (wantVideo) {
      console.warn("[Calls] video getUserMedia failed, falling back to audio", err);
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      mode = "audio";
      setCallScreen({
        name: "Call",
        status: "Camera blocked — audio only",
        showAcceptDecline: false,
        showEnd: true,
        showVideo: false
      });
    } else {
      throw err;
    }
  }

  const localVideo = byId("localVideo");
  if (localVideo) localVideo.srcObject = localStream;

  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });
}

/* ----------------------------- FIRESTORE SUBSCRIPTIONS ----------------------------- */

function subscribeCallDoc() {
  unsubscribeCallDoc();

  const callRef = doc(_db, "calls", currentCallId);
  currentCallUnsub = onSnapshot(
    callRef,
    async (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();

      // Caller: apply answer once
      if (callRole === "caller" && data.answer && pc && !pc.remoteDescription) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          state = "inCall";
          setText("callStatus", "In call");
          clearCallTimeout();
        } catch (e) {
          console.warn("[Calls] setRemoteDescription(answer) failed", e);
        }
      }

      // Status updates
      if (data.status === "declined") {
        setText("callStatus", "Declined");
        setTimeout(() => hardReset(), 600);
      }
      if (data.status === "ended") {
        setText("callStatus", "Ended");
        setTimeout(() => hardReset(), 600);
      }
      if (data.status === "accepted" && (state === "connecting" || state === "outgoing")) {
        setText("callStatus", "Connecting…");
      }
    },
    (err) => console.error("[Calls] call doc listener error", err)
  );
}

function unsubscribeCallDoc() {
  if (currentCallUnsub) {
    currentCallUnsub();
    currentCallUnsub = null;
  }
}

function subscribeOfferCandidates() {
  if (offerCandidatesUnsub) offerCandidatesUnsub();

  const ref = collection(_db, "calls", currentCallId, "offerCandidates");
  offerCandidatesUnsub = onSnapshot(ref, (snap) => {
    snap.docChanges().forEach((c) => {
      if (c.type !== "added") return;
      if (!pc) return;
      const data = c.doc.data();
      pc.addIceCandidate(new RTCIceCandidate(data)).catch((e) => {
        console.warn("[Calls] add offer ICE failed", e);
      });
    });
  });
}

function subscribeAnswerCandidates() {
  if (answerCandidatesUnsub) answerCandidatesUnsub();

  const ref = collection(_db, "calls", currentCallId, "answerCandidates");
  answerCandidatesUnsub = onSnapshot(ref, (snap) => {
    snap.docChanges().forEach((c) => {
      if (c.type !== "added") return;
      if (!pc) return;
      const data = c.doc.data();
      pc.addIceCandidate(new RTCIceCandidate(data)).catch((e) => {
        console.warn("[Calls] add answer ICE failed", e);
      });
    });
  });
}

/* ----------------------------- END / CLEANUP ----------------------------- */

async function endCall(status = "ended") {
  try {
    clearCallTimeout();
    if (currentCallId) {
      await updateDoc(doc(_db, "calls", currentCallId), {
        status,
        updatedAt: serverTimestamp()
      }).catch(() => {});
    }
  } finally {
    hardReset();
  }
}

function cleanupPeer() {
  try {
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
  } catch {}
  pc = null;

  if (localStream) {
    localStream.getTracks().forEach((t) => {
      try { t.stop(); } catch {}
    });
  }
  localStream = null;
  remoteStream = null;
}

function clearCallTimeout() {
  if (callTimeoutTimer) {
    clearTimeout(callTimeoutTimer);
    callTimeoutTimer = null;
  }
}

function hardReset() {
  clearCallTimeout();
  unsubscribeCallDoc();

  if (offerCandidatesUnsub) { offerCandidatesUnsub(); offerCandidatesUnsub = null; }
  if (answerCandidatesUnsub) { answerCandidatesUnsub(); answerCandidatesUnsub = null; }

  cleanupPeer();

  pendingIncoming = null;
  currentCallId = null;
  callRole = null;
  mode = "audio";
  state = "idle";

  try {
    const overlay = byId("callOverlay");
    if (overlay) overlay.classList.remove("videoOn");
    setText("callName", "Call");
    setText("callStatus", "Ready");
    hideOverlay();
  } catch {}
}

/* ----------------------------- AUDIO/VIDEO TOGGLES ----------------------------- */

function toggleMute() {
  if (!localStream) return;
  const track = localStream.getAudioTracks()?.[0];
  if (!track) return;
  track.enabled = !track.enabled;
  const btn = byId("btnMute");
  if (btn) btn.textContent = track.enabled ? "🎙️" : "🔇";
}

function toggleSpeaker() {
  // WebView routing is not reliable from JS; keep as UI toggle only
  const btn = byId("btnSpeaker");
  if (!btn) return;
  const on = btn.dataset.on === "1";
  btn.dataset.on = on ? "0" : "1";
  btn.textContent = on ? "🔊" : "📢";
}

async function switchCamera() {
  if (!localStream) return;
  if (mode !== "video") return;
  if (!pc) return;

  const videoTrack = localStream.getVideoTracks()?.[0];
  if (!videoTrack) return;

  const settings = videoTrack.getSettings?.() || {};
  const currentFacing = settings.facingMode || "user";
  const nextFacing = currentFacing === "user" ? "environment" : "user";

  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: nextFacing }
    });

    const newVideoTrack = newStream.getVideoTracks()?.[0];
    if (!newVideoTrack) return;

    const sender = pc.getSenders().find((s) => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(newVideoTrack);

    try { videoTrack.stop(); } catch {}

    const audioTrack = localStream.getAudioTracks()?.[0];
    localStream = new MediaStream([audioTrack, newVideoTrack].filter(Boolean));

    const localVideo = byId("localVideo");
    if (localVideo) localVideo.srcObject = localStream;

  } catch (e) {
    console.warn("[Calls] switchCamera failed", e);
  }
}
