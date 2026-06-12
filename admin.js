import { db } from "./firebase.js";
import { appEl, toast, safe, getAdmin } from "./ui.js";
import {
  doc, setDoc, deleteDoc, getDoc, serverTimestamp,
  collection, query, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function renderAdmin(){
  if(!getAdmin()){
    appEl.innerHTML = `<div class="card"><div class="err">Not admin.</div></div>`;
    return;
  }

  appEl.innerHTML = `
    <div class="card">
      <div class="title">Admin</div>
      <div class="muted small">Delete posts · Ban/Unban · Verify user</div>
      <div class="divider"></div>

      <label class="lbl">User UID</label>
      <input id="uid" class="in" placeholder="paste uid" />

      <div class="row" style="margin-top:10px">
        <button id="ban" class="btn danger" style="flex:1">Ban</button>
        <button id="unban" class="btn" style="flex:1">Unban</button>
      </div>

      <div class="row" style="margin-top:10px">
        <button id="verify" class="btn primary" style="flex:1">Verify</button>
        <button id="unverify" class="btn" style="flex:1">Unverify</button>
      </div>

      <div class="divider"></div>
      <button id="loadPosts" class="btn">Load recent posts</button>
    </div>

    <div id="postList" class="stack"></div>
  `;

  document.getElementById("ban").onclick = ()=> setBan(true);
  document.getElementById("unban").onclick = ()=> setBan(false);
  document.getElementById("verify").onclick = ()=> setVerify(true);
  document.getElementById("unverify").onclick = ()=> setVerify(false);
  document.getElementById("loadPosts").onclick = loadPosts;
}

async function setBan(flag){
  const uid = (document.getElementById("uid")?.value || "").trim();
  if(!uid) return toast("Paste UID");
  try{
    await setDoc(doc(db,"users",uid),{ banned: flag, updatedAt: serverTimestamp() },{merge:true});
    toast(flag ? "Banned ✅" : "Unbanned ✅");
  }catch(e){
    toast(e?.message || "Ban failed");
  }
}

async function setVerify(flag){
  const uid = (document.getElementById("uid")?.value || "").trim();
  if(!uid) return toast("Paste UID");
  try{
    await setDoc(doc(db,"users",uid),{ verified: flag, updatedAt: serverTimestamp() },{merge:true});
    toast(flag ? "Verified ✅" : "Unverified ✅");
  }catch(e){
    toast(e?.message || "Verify failed");
  }
}

async function loadPosts(){
  const el = document.getElementById("postList");
  el.innerHTML = `<div class="card"><div class="muted">Loading...</div></div>`;

  try{
    const q = query(collection(db,"posts"), orderBy("createdAt","desc"), limit(30));
    const snap = await getDocs(q);
    const posts = snap.docs.map(d=>({id:d.id, ...d.data()}));

    if(!posts.length){
      el.innerHTML = `<div class="card"><div class="muted">No posts.</div></div>`;
      return;
    }

    el.innerHTML = posts.map(p=>`
      <div class="card">
        <div style="font-weight:950">@${safe(p.ownerUsername||"user")}</div>
        <div class="muted small">${safe(p.text||"").slice(0,120)}</div>
        <button class="btn danger" data-del="${p.id}" style="margin-top:10px">Delete post</button>
      </div>
    `).join("");

    el.querySelectorAll("[data-del]").forEach(b=>{
      b.onclick = async ()=>{
        await deleteDoc(doc(db,"posts",b.dataset.del));
        toast("Post deleted ✅");
        loadPosts();
      };
    });
  }catch(e){
    toast(e?.message || "Load failed");
  }
}
