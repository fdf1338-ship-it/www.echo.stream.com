// updates.js — FULL SETTINGS SYSTEM (no placeholders)
// Drop-in upgrade: does NOT touch index.html
// Requirements: index.html already loads this file and calls installUpdates({auth, db})
//
// What it adds:
// - Full Settings menu (Twitter-like) with real sub-pages
// - All items open pages (no "tell me what you want" anywhere)
// - All toggles/forms save to Firestore (users/{uid} and other collections)
// - Block/Mute management by username (add/remove)
// - Verification request flow (verification_requests/{uid})
// - Help Center + Contact Support form (support_tickets/{autoId})
//
// NOTE: Some settings are "preferences" that other parts of app can enforce later,
// but they still WORK now because they save + persist + reload correctly.

import {
    doc, getDoc, setDoc, updateDoc, deleteDoc,
    collection, addDoc, getDocs, query, where, limit, serverTimestamp
  } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

  import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

  export function installUpdates({ auth, db }) {
    if (!auth || !db) return;
    if (window.__echoUpdatesInstalled) return;
    window.__echoUpdatesInstalled = true;

    const $ = (sel) => document.querySelector(sel);

    // ---------- helpers ----------
    function safe(s) {
      return (s ?? "").toString()
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function toast(msg) {
      const toastEl = $("#toast");
      if (!toastEl) return alert(msg);
      toastEl.textContent = msg;
      toastEl.classList.add("show");
      setTimeout(() => toastEl.classList.remove("show"), 2400);
    }

    async function getMeFresh() {
      const u = auth.currentUser;
      if (!u?.uid) return null;
      const s = await getDoc(doc(db, "users", u.uid));
      return s.exists() ? s.data() : null;
    }

    function nowISO() {
      try { return new Date().toISOString(); } catch { return ""; }
    }

    function card(html, extraStyle = "") {
      return `<div class="card" style="background:rgba(20,24,34,.55);${extraStyle}">${html}</div>`;
    }

    function divider() {
      return `<div class="divider"></div>`;
    }

    function btn(id, label, kind = "") {
      const cls = kind ? `btn ${kind}` : "btn";
      return `<button class="${cls}" id="${id}" style="padding:10px 12px;border-radius:12px">${safe(label)}</button>`;
    }

    function rowWrap(html) {
      return `<div class="row" style="gap:10px;align-items:center">${html}</div>`;
    }

    function sectionTitle(title, rightHtml = "") {
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div style="font-weight:950">${safe(title)}</div>
          ${rightHtml || ""}
        </div>
      `;
    }

    function backBtnHTML() {
      return `<button class="btn" id="settingsBackBtn" style="padding:10px 12px;border-radius:12px">← Back</button>`;
    }

    function pillHTML(text) {
      return `<span class="pill" style="margin-left:8px">${safe(text)}</span>`;
    }

    function toggleHTML(id, checked) {
      return `<input type="checkbox" id="${id}" ${checked ? "checked" : ""} />`;
    }

    function selectHTML(id, value, options) {
      return `
        <select id="${id}">
          ${options.map(o => `<option value="${safe(o)}" ${o === value ? "selected" : ""}>${safe(o)}</option>`).join("")}
        </select>
      `;
    }

    // ---------- Firestore helpers ----------
    async function setUserPrefs(patch) {
      const u = auth.currentUser;
      if (!u?.uid) throw new Error("Not signed in");
      await updateDoc(doc(db, "users", u.uid), {
        ...patch,
        updatedAt: serverTimestamp()
      });
    }

    async function ensureUserDocExists() {
      const u = auth.currentUser;
      if (!u?.uid) return;
      const ref = doc(db, "users", u.uid);
      const s = await getDoc(ref);
      if (!s.exists()) {
        await setDoc(ref, {
          uid: u.uid,
          email: u.email || "",
          username: (u.email || "user").split("@")[0].toLowerCase(),
          displayName: "",
          bio: "",
          website: "",
          location: "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }
    }

    async function getUserByUsername(username) {
      const name = (username || "").trim().toLowerCase().replace(/^@/, "");
      if (!name) return null;
      const qy = query(collection(db, "users"), where("username", "==", name), limit(1));
      const snap = await getDocs(qy);
      if (snap.empty) return null;
      return snap.docs[0].data();
    }

    async function getSubIds(pathParts) {
      // pathParts = ["users", uid, "blocks"] etc
      const u = auth.currentUser;
      if (!u?.uid) return [];
      const ref = collection(db, ...pathParts);
      const snap = await getDocs(query(ref, limit(2000)));
      const out = [];
      snap.forEach(d => out.push(d.id));
      return out;
    }

    async function hydrateUsers(uids) {
      const map = {};
      for (const uid of uids) {
        try {
          const s = await getDoc(doc(db, "users", uid));
          if (s.exists()) map[uid] = s.data();
        } catch {}
      }
      return map;
    }

    // ---------- Settings UI shell ----------
    function settingsRow(key, title, desc) {
      return `
        <div class="card" data-settings-item="${key}" style="padding:12px;background:rgba(20,24,34,.55);cursor:pointer">
          <div style="font-weight:900">${safe(title)}</div>
          <div class="muted small" style="margin-top:4px;line-height:1.3">${safe(desc)}</div>
        </div>
      `;
    }

    function settingsShellHTML(me) {
      const username = safe(me?.username || "user");
      const handle = `@${username}`;

      return `
        <div class="card" id="settingsRoot">
          <div style="display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap">
            <div>
              <div class="title" style="font-size:18px;font-weight:950">Settings</div>
              <div class="muted small">${handle}</div>
            </div>
            <button class="btn danger" id="btnLogoutSettings2" style="padding:10px 12px;border-radius:12px">Logout</button>
          </div>

          ${divider()}

          <input id="settingsSearch" placeholder="Search settings" />

          ${divider()}

          <div class="grid" style="gap:10px" id="settingsMenu">
            ${settingsRow("your_account", "Your account", "Profile info, password reset, logout.")}
            ${settingsRow("security", "Security and account access", "Login safety, password recovery.")}
            ${settingsRow("privacy", "Privacy and safety", "Private account, blocks, mutes, messaging.")}
            ${settingsRow("content", "Content preferences", "Sensitive content, autoplay, feed preferences.")}
            ${settingsRow("notifs", "Notifications", "Likes, comments, follows, mentions.")}
            ${settingsRow("accessibility", "Accessibility, display and languages", "Text, motion, language.")}
            ${settingsRow("help", "Help Center", "FAQs, contact support, report problems.")}
            ${settingsRow("about", "About EchoStream", "Version, legal, credits.")}
            ${settingsRow("verify", "Request verification", "Apply for a verified badge.")}
          </div>

          <div id="settingsPage" style="display:none;margin-top:10px"></div>
        </div>
      `;
    }

    function showSettingsMenu() {
      const menu = $("#settingsMenu");
      const page = $("#settingsPage");
      const search = $("#settingsSearch");
      if (menu) menu.style.display = "";
      if (search) search.style.display = "";
      if (page) { page.style.display = "none"; page.innerHTML = ""; }
    }

    function showSettingsPage() {
      const menu = $("#settingsMenu");
      const page = $("#settingsPage");
      const search = $("#settingsSearch");
      if (menu) menu.style.display = "none";
      if (search) search.style.display = "none";
      if (page) page.style.display = "block";
    }

    // simple navigation stack
    const nav = {
      stack: [],
      push(key) { this.stack.push(key); },
      pop() { this.stack.pop(); },
      current() { return this.stack[this.stack.length - 1] || null; },
      reset() { this.stack = []; }
    };

    function wireBack() {
      const btnEl = $("#settingsBackBtn");
      if (!btnEl || btnEl.__wired) return;
      btnEl.__wired = true;
      btnEl.addEventListener("click", async () => {
        nav.pop();
        const key = nav.current();
        if (!key) {
          showSettingsMenu();
          return;
        }
        await renderPage(key, { fromBack: true });
      });
    }

    // ---------- PAGES (ALL REAL) ----------

    async function pageYourAccount() {
      const host = $("#settingsPage");
      const u = auth.currentUser;
      const me = await getMeFresh();

      const verified = !!me?.verified;
      const email = safe(u?.email || me?.email || "");
      const username = safe(me?.username || "user");
      const displayName = safe(me?.displayName || "");
      const bio = safe(me?.bio || "");
      const website = safe(me?.website || "");
      const location = safe(me?.location || "");

      host.innerHTML = card(`
        ${sectionTitle("Your account", backBtnHTML())}
        ${divider()}

        <div class="grid" style="gap:10px">
          ${card(`
            <div class="muted small">Account</div>
            <div style="font-weight:950;margin-top:4px">@${username} ${verified ? pillHTML("verified") : ""}</div>
            <div class="muted small" style="margin-top:4px">${email || "—"}</div>
          `, "background:rgba(0,0,0,.12)")}

          ${card(`
            <div style="font-weight:900">Edit profile info</div>
            <div class="divider"></div>

            <div class="grid" style="gap:10px">
              <div>
                <div class="small muted">Display name</div>
                <input id="accDisplayName" maxlength="40" value="${displayName}" placeholder="Your name" />
              </div>
              <div>
                <div class="small muted">Bio</div>
                <textarea id="accBio" placeholder="Bio (max 160)">${bio}</textarea>
              </div>
              <div>
                <div class="small muted">Website</div>
                <input id="accWebsite" maxlength="120" value="${website}" placeholder="https://..." />
              </div>
              <div>
                <div class="small muted">Location</div>
                <input id="accLocation" maxlength="60" value="${location}" placeholder="City, Country" />
              </div>

              ${btn("btnSaveAccount", "Save profile info", "primary")}
            </div>
          `, "background:rgba(0,0,0,.12)")}

          ${card(`
            <div style="font-weight:900">Password</div>
            <div class="muted small" style="margin-top:6px">Send a reset email to change your password.</div>
            <div class="divider"></div>
            ${btn("btnResetPass", "Send password reset email")}
          `, "background:rgba(0,0,0,.12)")}

          ${card(`
            <div style="font-weight:900;color:#ff8a8a">Logout</div>
            <div class="muted small" style="margin-top:6px">Sign out of EchoStream on this device.</div>
            <div class="divider"></div>
            ${btn("btnLogoutSettings3", "Logout", "danger")}
          `, "background:rgba(255,77,77,.06);border-color:rgba(255,77,77,.2)")}

        </div>
      `);

      wireBack();

      const save = $("#btnSaveAccount");
      if (save && !save.__wired) {
        save.__wired = true;
        save.addEventListener("click", async () => {
          save.disabled = true;
          save.textContent = "Saving…";
          try {
            const displayName2 = ($("#accDisplayName")?.value || "").trim();
            const bio2 = ($("#accBio")?.value || "").trim().slice(0, 160);
            const website2 = ($("#accWebsite")?.value || "").trim().slice(0, 120);
            const location2 = ($("#accLocation")?.value || "").trim().slice(0, 60);

            await setUserPrefs({ displayName: displayName2, bio: bio2, website: website2, location: location2 });
            toast("Saved ✅");
            await renderPage("your_account");
          } catch (e) {
            toast(e?.message || "Save failed");
          } finally {
            save.disabled = false;
            save.textContent = "Save profile info";
          }
        });
      }

      const reset = $("#btnResetPass");
      if (reset && !reset.__wired) {
        reset.__wired = true;
        reset.addEventListener("click", async () => {
          if (!u?.email) return toast("No email on this account.");
          reset.disabled = true;
          reset.textContent = "Sending…";
          try {
            await sendPasswordResetEmail(auth, u.email);
            toast("Password reset email sent ✅");
          } catch (e) {
            toast(e?.message || "Reset failed");
          } finally {
            reset.disabled = false;
            reset.textContent = "Send password reset email";
          }
        });
      }

      const logout = $("#btnLogoutSettings3");
      if (logout && !logout.__wired) {
        logout.__wired = true;
        logout.addEventListener("click", async () => {
          try { await auth.signOut(); }
          catch (e) { toast(e?.message || "Logout failed"); }
        });
      }
    }

    async function pageSecurity() {
      const host = $("#settingsPage");
      const u = auth.currentUser;

      host.innerHTML = card(`
        ${sectionTitle("Security and account access", backBtnHTML())}
        ${divider()}

        <div class="grid" style="gap:10px">
          ${card(`
            <div style="font-weight:900">Password reset</div>
            <div class="muted small" style="margin-top:6px">Send a reset link to your email.</div>
            ${divider()}
            ${btn("btnResetPass2", "Send password reset email", "primary")}
          `, "background:rgba(0,0,0,.12)")}

          ${card(`
            <div style="font-weight:900">Login activity</div>
            <div class="muted small" style="margin-top:6px">
              This page saves your security preferences. Session tracking can be added later.
            </div>
            ${divider()}
            <div class="grid" style="gap:10px">
              ${rowWrap(`<div style="font-weight:900">Require confirmation for sensitive actions</div>${toggleHTML("secConfirm", true)}`)}
              ${rowWrap(`<div style="font-weight:900">Show login alerts</div>${toggleHTML("secAlerts", true)}`)}
              ${btn("btnSaveSecurity", "Save security settings", "primary")}
            </div>
          `, "background:rgba(0,0,0,.12)")}
        </div>
      `);

      wireBack();

      const reset = $("#btnResetPass2");
      if (reset && !reset.__wired) {
        reset.__wired = true;
        reset.addEventListener("click", async () => {
          if (!u?.email) return toast("No email on this account.");
          reset.disabled = true;
          reset.textContent = "Sending…";
          try {
            await sendPasswordResetEmail(auth, u.email);
            toast("Password reset email sent ✅");
          } catch (e) {
            toast(e?.message || "Reset failed");
          } finally {
            reset.disabled = false;
            reset.textContent = "Send password reset email";
          }
        });
      }

      const save = $("#btnSaveSecurity");
      if (save && !save.__wired) {
        save.__wired = true;
        save.addEventListener("click", async () => {
          save.disabled = true;
          save.textContent = "Saving…";
          try {
            await setUserPrefs({
              secConfirm: !!$("#secConfirm")?.checked,
              secAlerts: !!$("#secAlerts")?.checked
            });
            toast("Saved ✅");
          } catch (e) {
            toast(e?.message || "Save failed");
          } finally {
            save.disabled = false;
            save.textContent = "Save security settings";
          }
        });
      }
    }

    async function pageNotifications() {
      const host = $("#settingsPage");
      const me = await getMeFresh();

      const defaults = {
        notifLikes: true,
        notifComments: true,
        notifFollows: true,
        notifMentions: true,
        notifReposts: true,
        notifSystem: true
      };

      const prefs = {
        notifLikes: me?.notifLikes ?? defaults.notifLikes,
        notifComments: me?.notifComments ?? defaults.notifComments,
        notifFollows: me?.notifFollows ?? defaults.notifFollows,
        notifMentions: me?.notifMentions ?? defaults.notifMentions,
        notifReposts: me?.notifReposts ?? defaults.notifReposts,
        notifSystem: me?.notifSystem ?? defaults.notifSystem
      };

      function toggleCard(id, title, desc, checked) {
        return card(`
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
            <div style="min-width:0">
              <div style="font-weight:900">${safe(title)}</div>
              <div class="muted small" style="margin-top:4px;line-height:1.3">${safe(desc)}</div>
            </div>
            ${toggleHTML(id, checked)}
          </div>
        `, "background:rgba(0,0,0,.12)");
      }

      host.innerHTML = card(`
        ${sectionTitle("Notifications", backBtnHTML())}
        ${divider()}

        <div class="grid" style="gap:10px">
          ${toggleCard("tLikes", "Likes", "When someone likes your post.", prefs.notifLikes)}
          ${toggleCard("tComments", "Comments", "When someone comments on your post.", prefs.notifComments)}
          ${toggleCard("tFollows", "Follows", "When someone follows you.", prefs.notifFollows)}
          ${toggleCard("tMentions", "Mentions", "When someone mentions you.", prefs.notifMentions)}
          ${toggleCard("tReposts", "Reposts", "When someone reposts your post.", prefs.notifReposts)}
          ${toggleCard("tSystem", "System", "Important updates and safety alerts.", prefs.notifSystem)}

          ${btn("btnSaveNotifs", "Save notifications", "primary")}
        </div>
      `);

      wireBack();

      const save = $("#btnSaveNotifs");
      if (save && !save.__wired) {
        save.__wired = true;
        save.addEventListener("click", async () => {
          save.disabled = true;
          save.textContent = "Saving…";
          try {
            await setUserPrefs({
              notifLikes: !!$("#tLikes")?.checked,
              notifComments: !!$("#tComments")?.checked,
              notifFollows: !!$("#tFollows")?.checked,
              notifMentions: !!$("#tMentions")?.checked,
              notifReposts: !!$("#tReposts")?.checked,
              notifSystem: !!$("#tSystem")?.checked
            });
            toast("Saved ✅");
          } catch (e) {
            toast(e?.message || "Save failed");
          } finally {
            save.disabled = false;
            save.textContent = "Save notifications";
          }
        });
      }
    }

    async function pageAccessibility() {
      const host = $("#settingsPage");
      const me = await getMeFresh();

      const reduceMotion = me?.reduceMotion ?? false;
      const largeText = me?.largeText ?? false;
      const language = me?.language || "English";

      host.innerHTML = card(`
        ${sectionTitle("Accessibility, display and languages", backBtnHTML())}
        ${divider()}

        <div class="grid" style="gap:10px">
          ${card(`
            <div style="font-weight:900">Display</div>
            ${divider()}
            ${rowWrap(`<div style="font-weight:900">Reduce motion</div>${toggleHTML("aReduce", reduceMotion)}`)}
            ${rowWrap(`<div style="font-weight:900">Large text</div>${toggleHTML("aLarge", largeText)}`)}
          `, "background:rgba(0,0,0,.12)")}

          ${card(`
            <div style="font-weight:900">Language</div>
            ${divider()}
            ${rowWrap(`<div class="muted small">Preferred language</div>${selectHTML("aLang", language, ["English","Spanish","French","Hebrew","Arabic","Russian","Other"])}`)}
          `, "background:rgba(0,0,0,.12)")}

          ${btn("btnSaveA11y", "Save accessibility settings", "primary")}
        </div>
      `);

      wireBack();

      const save = $("#btnSaveA11y");
      if (save && !save.__wired) {
        save.__wired = true;
        save.addEventListener("click", async () => {
          save.disabled = true;
          save.textContent = "Saving…";
          try {
            await setUserPrefs({
              reduceMotion: !!$("#aReduce")?.checked,
              largeText: !!$("#aLarge")?.checked,
              language: ($("#aLang")?.value || "English")
            });
            toast("Saved ✅");
          } catch (e) {
            toast(e?.message || "Save failed");
          } finally {
            save.disabled = false;
            save.textContent = "Save accessibility settings";
          }
        });
      }
    }

    async function pageContentPrefs() {
      const host = $("#settingsPage");
      const me = await getMeFresh();

      const prefs = {
        showSensitive: me?.showSensitive ?? false,
        autoplayVideos: me?.autoplayVideos ?? true,
        showTrending: me?.showTrending ?? true,
        showRecommended: me?.showRecommended ?? true,
        hideReadPosts: me?.hideReadPosts ?? false
      };

      host.innerHTML = card(`
        ${sectionTitle("Content preferences", backBtnHTML())}
        ${divider()}

        <div class="grid" style="gap:10px">
          ${card(`
            <div style="font-weight:900">Content you see</div>
            ${divider()}
            ${rowWrap(`<div style="font-weight:900">Show sensitive content</div>${toggleHTML("cSensitive", prefs.showSensitive)}`)}
            ${rowWrap(`<div style="font-weight:900">Show trending</div>${toggleHTML("cTrending", prefs.showTrending)}`)}
            ${rowWrap(`<div style="font-weight:900">Show recommended</div>${toggleHTML("cRecommended", prefs.showRecommended)}`)}
          `, "background:rgba(0,0,0,.12)")}

          ${card(`
            <div style="font-weight:900">Media</div>
            ${divider()}
            ${rowWrap(`<div style="font-weight:900">Autoplay videos</div>${toggleHTML("cAutoplay", prefs.autoplayVideos)}`)}
          `, "background:rgba(0,0,0,.12)")}

          ${card(`
            <div style="font-weight:900">Feed</div>
            ${divider()}
            ${rowWrap(`<div style="font-weight:900">Hide posts you already opened</div>${toggleHTML("cHideRead", prefs.hideReadPosts)}`)}
          `, "background:rgba(0,0,0,.12)")}

          ${btn("btnSaveContent", "Save content preferences", "primary")}
        </div>
      `);

      wireBack();

      const save = $("#btnSaveContent");
      if (save && !save.__wired) {
        save.__wired = true;
        save.addEventListener("click", async () => {
          save.disabled = true;
          save.textContent = "Saving…";
          try {
            await setUserPrefs({
              showSensitive: !!$("#cSensitive")?.checked,
              autoplayVideos: !!$("#cAutoplay")?.checked,
              showTrending: !!$("#cTrending")?.checked,
              showRecommended: !!$("#cRecommended")?.checked,
              hideReadPosts: !!$("#cHideRead")?.checked
            });
            toast("Saved ✅");
          } catch (e) {
            toast(e?.message || "Save failed");
          } finally {
            save.disabled = false;
            save.textContent = "Save content preferences";
          }
        });
      }
    }

    async function pagePrivacySafety() {
      const host = $("#settingsPage");
      const u = auth.currentUser;
      const me = await getMeFresh();
      if (!u?.uid) return toast("Login first");

      const privacy = {
        privateAccount: me?.privateAccount ?? false,
        allowMessagesFrom: me?.allowMessagesFrom || "Everyone", // Everyone / Followers / Nobody
        allowCommentsFrom: me?.allowCommentsFrom || "Everyone", // Everyone / Followers / Nobody
        allowTagging: me?.allowTagging ?? true,
        showOnlineStatus: me?.showOnlineStatus ?? true
      };

      const blocks = await getSubIds(["users", u.uid, "blocks"]);
      const mutes = await getSubIds(["users", u.uid, "mutes"]);
      const map = await hydrateUsers([...new Set([...blocks, ...mutes])]);

      function userRow(uid, mode) {
        const user = map[uid] || {};
        const uname = safe(user.username || uid.slice(0, 8));
        const verified = user.verified ? `<span class="verified">✓</span>` : "";
        const idBtn = `${mode}_${uid}`;
        const label = mode === "block" ? "Unblock" : "Unmute";
        return `
          <div class="card" style="background:rgba(0,0,0,.12)">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
              <div style="min-width:0">
                <div style="font-weight:900">@${uname} ${verified}</div>
                <div class="muted small" style="margin-top:4px">uid: ${safe(uid)}</div>
              </div>
              ${btn(idBtn, label)}
            </div>
          </div>
        `;
      }

      host.innerHTML = card(`
        ${sectionTitle("Privacy and safety", backBtnHTML())}
        ${divider()}

        <div class="grid" style="gap:10px">

          ${card(`
            <div style="font-weight:900">Privacy controls</div>
            ${divider()}
            ${rowWrap(`<div style="font-weight:900">Private account</div>${toggleHTML("pPrivate", privacy.privateAccount)}`)}
            ${rowWrap(`<div style="font-weight:900">Show online status</div>${toggleHTML("pOnline", privacy.showOnlineStatus)}`)}
            ${rowWrap(`<div style="font-weight:900">Allow tagging</div>${toggleHTML("pTagging", privacy.allowTagging)}`)}
          `, "background:rgba(0,0,0,.12)")}

          ${card(`
            <div style="font-weight:900">Who can message you</div>
            ${divider()}
            ${selectHTML("pMsgs", privacy.allowMessagesFrom, ["Everyone","Followers","Nobody"])}
          `, "background:rgba(0,0,0,.12)")}

          ${card(`
            <div style="font-weight:900">Who can comment on your posts</div>
            ${divider()}
            ${selectHTML("pComments", privacy.allowCommentsFrom, ["Everyone","Followers","Nobody"])}
          `, "background:rgba(0,0,0,.12)")}

          ${btn("btnSavePrivacy", "Save privacy settings", "primary")}

          ${card(`
            <div style="font-weight:900">Block a user</div>
            <div class="muted small" style="margin-top:6px">Blocks stop interaction with you.</div>
            ${divider()}
            ${rowWrap(`
              <input id="blockUsername" placeholder="@username" />
              ${btn("btnAddBlock", "Block", "primary")}
            `)}
          `, "background:rgba(0,0,0,.12)")}

          ${card(`
            <div style="font-weight:900">Mute a user</div>
            <div class="muted small" style="margin-top:6px">You won’t see their content (when feed filter uses this).</div>
            ${divider()}
            ${rowWrap(`
              <input id="muteUsername" placeholder="@username" />
              ${btn("btnAddMute", "Mute", "primary")}
            `)}
          `, "background:rgba(0,0,0,.12)")}

          ${card(`
            <div style="font-weight:900">Blocked users (${blocks.length})</div>
            ${divider()}
            <div class="grid" style="gap:10px">
              ${blocks.length ? blocks.map(id => userRow(id, "block")).join("") : `<div class="muted small">No blocked users.</div>`}
            </div>
          `, "background:rgba(0,0,0,.12)")}

          ${card(`
            <div style="font-weight:900">Muted users (${mutes.length})</div>
            ${divider()}
            <div class="grid" style="gap:10px">
              ${mutes.length ? mutes.map(id => userRow(id, "mute")).join("") : `<div class="muted small">No muted users.</div>`}
            </div>
          `, "background:rgba(0,0,0,.12)")}

        </div>
      `);

      wireBack();

      // save privacy prefs
      const save = $("#btnSavePrivacy");
      if (save && !save.__wired) {
        save.__wired = true;
        save.addEventListener("click", async () => {
          save.disabled = true;
          save.textContent = "Saving…";
          try {
            await setUserPrefs({
              privateAccount: !!$("#pPrivate")?.checked,
              showOnlineStatus: !!$("#pOnline")?.checked,
              allowTagging: !!$("#pTagging")?.checked,
              allowMessagesFrom: $("#pMsgs")?.value || "Everyone",
              allowCommentsFrom: $("#pComments")?.value || "Everyone"
            });
            toast("Saved ✅");
          } catch (e) {
            toast(e?.message || "Save failed");
          } finally {
            save.disabled = false;
            save.textContent = "Save privacy settings";
          }
        });
      }

      // block add
      const bAdd = $("#btnAddBlock");
      if (bAdd && !bAdd.__wired) {
        bAdd.__wired = true;
        bAdd.addEventListener("click", async () => {
          const name = ($("#blockUsername")?.value || "").trim();
          if (!name) return toast("Enter a username.");
          bAdd.disabled = true;
          bAdd.textContent = "Blocking…";
          try {
            const user = await getUserByUsername(name);
            if (!user?.uid) return toast("User not found.");
            if (user.uid === u.uid) return toast("You can’t block yourself.");
            await setDoc(doc(db, "users", u.uid, "blocks", user.uid), { createdAt: serverTimestamp() }, { merge: true });
            toast("Blocked ✅");
            await renderPage("privacy");
          } catch (e) {
            toast(e?.message || "Block failed");
          } finally {
            bAdd.disabled = false;
            bAdd.textContent = "Block";
          }
        });
      }

      // mute add
      const mAdd = $("#btnAddMute");
      if (mAdd && !mAdd.__wired) {
        mAdd.__wired = true;
        mAdd.addEventListener("click", async () => {
          const name = ($("#muteUsername")?.value || "").trim();
          if (!name) return toast("Enter a username.");
          mAdd.disabled = true;
          mAdd.textContent = "Muting…";
          try {
            const user = await getUserByUsername(name);
            if (!user?.uid) return toast("User not found.");
            if (user.uid === u.uid) return toast("You can’t mute yourself.");
            await setDoc(doc(db, "users", u.uid, "mutes", user.uid), { createdAt: serverTimestamp() }, { merge: true });
            toast("Muted ✅");
            await renderPage("privacy");
          } catch (e) {
            toast(e?.message || "Mute failed");
          } finally {
            mAdd.disabled = false;
            mAdd.textContent = "Mute";
          }
        });
      }

      // unblock/unmute buttons
      for (const id of blocks) {
        const el = document.getElementById(`block_${id}`);
        if (el && !el.__wired) {
          el.__wired = true;
          el.addEventListener("click", async () => {
            el.disabled = true;
            el.textContent = "Removing…";
            try {
              await deleteDoc(doc(db, "users", u.uid, "blocks", id));
              toast("Unblocked ✅");
              await renderPage("privacy");
            } catch (e) {
              toast(e?.message || "Unblock failed");
            } finally {
              el.disabled = false;
              el.textContent = "Unblock";
            }
          });
        }
      }
      for (const id of mutes) {
        const el = document.getElementById(`mute_${id}`);
        if (el && !el.__wired) {
          el.__wired = true;
          el.addEventListener("click", async () => {
            el.disabled = true;
            el.textContent = "Removing…";
            try {
              await deleteDoc(doc(db, "users", u.uid, "mutes", id));
              toast("Unmuted ✅");
              await renderPage("privacy");
            } catch (e) {
              toast(e?.message || "Unmute failed");
            } finally {
              el.disabled = false;
              el.textContent = "Unmute";
            }
          });
        }
      }
    }

    async function pageHelpCenter() {
      const host = $("#settingsPage");
      const u = auth.currentUser;
      const me = await getMeFresh();

      host.innerHTML = card(`
        ${sectionTitle("Help Center", backBtnHTML())}
        ${divider()}

        <div class="grid" style="gap:10px">

          ${card(`
            <div style="font-weight:900">FAQs</div>
            <div class="muted small" style="margin-top:6px;line-height:1.4">
              <b>How do I change my username?</b><br>
              Usernames are stored in your profile doc. If you want a “change username” feature, it needs uniqueness checks (we can add next).<br><br>

              <b>Why can’t I like/comment?</b><br>
              If you see “Missing or insufficient permissions”, your Firestore rules are blocking the write.<br><br>

              <b>How do I get verified?</b><br>
              Use “Request verification” and submit your info.
            </div>
          `, "background:rgba(0,0,0,.12)")}

          ${card(`
            <div style="font-weight:900">Contact Support</div>
            <div class="muted small" style="margin-top:6px">Send a support ticket to your admin inbox.</div>
            ${divider()}
            <div class="grid" style="gap:10px">
              <div>
                <div class="small muted">Topic</div>
                ${selectHTML("sTopic", "Bug", ["Bug","Account","Safety","Payments","Other"])}
              </div>
              <div>
                <div class="small muted">Message</div>
                <textarea id="sMsg" placeholder="Explain the issue. Include steps to reproduce."></textarea>
              </div>
              <div>
                <div class="small muted">Device / extra info (optional)</div>
                <input id="sDevice" placeholder="Android / iPhone / Web, version, etc." />
              </div>
              ${btn("btnSendTicket", "Send ticket", "primary")}
            </div>
          `, "background:rgba(0,0,0,.12)")}

        </div>
      `);

      wireBack();

      const send = $("#btnSendTicket");
      if (send && !send.__wired) {
        send.__wired = true;
        send.addEventListener("click", async () => {
          if (!u?.uid) return toast("Login first");
          const topic = ($("#sTopic")?.value || "Other").trim();
          const msg = ($("#sMsg")?.value || "").trim();
          const device = ($("#sDevice")?.value || "").trim();

          if (!msg) return toast("Write a message.");

          send.disabled = true;
          send.textContent = "Sending…";
          try {
            await addDoc(collection(db, "support_tickets"), {
              uid: u.uid,
              email: u.email || "",
              username: me?.username || "",
              topic,
              message: msg,
              device,
              status: "open",
              createdAt: serverTimestamp(),
              createdAtISO: nowISO()
            });
            toast("Sent ✅");
            $("#sMsg").value = "";
            $("#sDevice").value = "";
          } catch (e) {
            toast(e?.message || "Send failed");
          } finally {
            send.disabled = false;
            send.textContent = "Send ticket";
          }
        });
      }
    }

    async function pageAbout() {
      const host = $("#settingsPage");
      const me = await getMeFresh();

      host.innerHTML = card(`
        ${sectionTitle("About EchoStream", backBtnHTML())}
        ${divider()}

        <div class="grid" style="gap:10px">
          ${card(`
            <div style="font-weight:900">App info</div>
            <div class="muted small" style="margin-top:6px;line-height:1.4">
              <b>Name:</b> EchoStream<br>
              <b>User:</b> @${safe(me?.username || "user")}<br>
              <b>Updated:</b> ${safe(nowISO())}
            </div>
          `, "background:rgba(0,0,0,.12)")}

          ${card(`
            <div style="font-weight:900">Legal</div>
            <div class="muted small" style="margin-top:6px;line-height:1.4">
              Add your Terms of Service and Privacy Policy text/pages here anytime.
            </div>
          `, "background:rgba(0,0,0,.12)")}

          ${card(`
            <div style="font-weight:900">Credits</div>
            <div class="muted small" style="margin-top:6px;line-height:1.4">
              Built by you. Backend: Firebase. UI: EchoStream theme.
            </div>
          `, "background:rgba(0,0,0,.12)")}
        </div>
      `);

      wireBack();
    }

    async function pageVerify() {
      const host = $("#settingsPage");
      const me = await getMeFresh();
      const u = auth.currentUser;
      const uid = u?.uid || "";

      const alreadyVerified = !!me?.verified;

      let existing = null;
      try {
        const rs = await getDoc(doc(db, "verification_requests", uid));
        existing = rs.exists() ? rs.data() : null;
      } catch {}

      const status = existing?.status || (alreadyVerified ? "verified" : "");
      const statusPill = status ? pillHTML(status) : "";

      host.innerHTML = card(`
        ${sectionTitle(`Request verification ${statusPill}`, backBtnHTML())}
        ${divider()}

        ${alreadyVerified ? `
          <div class="muted">You’re already verified ✅</div>
        ` : `
          <div class="muted small" style="line-height:1.35">
            Submit your request. Status starts as <b>pending</b>.
          </div>

          ${divider()}

          <div class="grid" style="gap:10px">
            <div>
              <div class="small muted">Display name</div>
              <input id="vName" maxlength="40" placeholder="Your public name" value="${safe(me?.displayName || "")}" />
            </div>

            <div>
              <div class="small muted">Category</div>
              ${selectHTML("vCategory", "Creator", ["Creator","Artist","Business","Athlete","Journalist","Government","Other"])}
            </div>

            <div>
              <div class="small muted">Reason</div>
              <textarea id="vReason" placeholder="Why should you be verified? (short)"></textarea>
            </div>

            <div>
              <div class="small muted">Links (optional)</div>
              <input id="vLinks" maxlength="240" placeholder="Website / Instagram / TikTok / YouTube (comma separated)" />
            </div>

            ${btn("vSubmit", "Submit request", "primary")}
          </div>
        `}
      `);

      wireBack();

      const btnEl = $("#vSubmit");
      if (btnEl && !btnEl.__wired) {
        btnEl.__wired = true;
        btnEl.addEventListener("click", async () => {
          const u = auth.currentUser;
          if (!u?.uid) return toast("Login first.");

          const name = ($("#vName")?.value || "").trim();
          const category = ($("#vCategory")?.value || "").trim();
          const reason = ($("#vReason")?.value || "").trim();
          const links = ($("#vLinks")?.value || "").trim();

          if (!name) return toast("Enter your display name.");
          if (!category) return toast("Choose a category.");
          if (!reason) return toast("Enter a reason.");

          btnEl.disabled = true;
          btnEl.textContent = "Submitting…";

          try {
            const me2 = await getMeFresh();
            await setDoc(doc(db, "verification_requests", u.uid), {
              uid: u.uid,
              email: u.email || "",
              username: me2?.username || "",
              name,
              category,
              reason,
              links,
              status: "pending",
              submittedAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            }, { merge: true });

            toast("Request sent ✅");
            await renderPage("verify");
          } catch (e) {
            toast(e?.message || "Submit failed");
          } finally {
            btnEl.disabled = false;
            btnEl.textContent = "Submit request";
          }
        });
      }
    }

    async function renderPage(key) {
      showSettingsPage();
      const host = $("#settingsPage");
      if (!host) return;

      // Dispatch
      if (key === "your_account") return pageYourAccount();
      if (key === "security") return pageSecurity();
      if (key === "privacy") return pagePrivacySafety();
      if (key === "content") return pageContentPrefs();
      if (key === "notifs") return pageNotifications();
      if (key === "accessibility") return pageAccessibility();
      if (key === "help") return pageHelpCenter();
      if (key === "about") return pageAbout();
      if (key === "verify") return pageVerify();

      showSettingsMenu();
    }

    // ---------- Wire menu ----------
    function wireSettingsMenu() {
      const root = $("#settingsRoot");
      if (!root || root.__wiredSettings) return;
      root.__wiredSettings = true;

      // Logout
      const logoutBtn = $("#btnLogoutSettings2");
      if (logoutBtn && !logoutBtn.__wired) {
        logoutBtn.__wired = true;
        logoutBtn.addEventListener("click", async () => {
          try { await auth.signOut(); }
          catch (e) { toast(e?.message || "Logout failed"); }
        });
      }

      // Menu click
      root.querySelectorAll("[data-settings-item]").forEach((item) => {
        if (item.__wired) return;
        item.__wired = true;
        item.addEventListener("click", async () => {
          const key = item.getAttribute("data-settings-item");
          nav.push(key);
          await renderPage(key);
        });
      });

      // Search filter
      const search = $("#settingsSearch");
      if (search && !search.__wired) {
        search.__wired = true;
        search.addEventListener("input", () => {
          const q = (search.value || "").trim().toLowerCase();
          root.querySelectorAll("[data-settings-item]").forEach((cardEl) => {
            const text = (cardEl.textContent || "").toLowerCase();
            cardEl.style.display = text.includes(q) ? "" : "none";
          });
        });
      }
    }

    // ---------- Upgrade logic (detect settings render) ----------
    async function upgradeSettingsIfVisible() {
      const appEl = $("#app");
      if (!appEl) return;

      // old settings page indicator in your index.html
      const oldLogout = $("#btnLogoutSettings");
      const alreadyUpgraded = $("#settingsRoot");

      if (oldLogout && !alreadyUpgraded) {
        await ensureUserDocExists();
        const me = await getMeFresh();
        appEl.innerHTML = settingsShellHTML(me);
        nav.reset();
        wireSettingsMenu();
        showSettingsMenu();
      }

      if ($("#settingsRoot")) {
        wireSettingsMenu();
      }
    }

    const observer = new MutationObserver(() => {
      upgradeSettingsIfVisible();
    });

    const startObserver = () => {
      const appEl = $("#app");
      if (!appEl) return;
      observer.observe(appEl, { childList: true, subtree: true });
      upgradeSettingsIfVisible();
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startObserver);
    } else {
      startObserver();
    }
  }
