/* auth.js (FULL — login + signup screen)
   Put this file at:
   app/src/main/assets/auth.js

   Exports: renderAuth(host, ctx)
*/

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import { $, safe, toast, card } from "./ui.js";
import { ensureUserDoc } from "./data.js";

export async function renderAuth(host, ctx) {
  const { auth, navigate } = ctx;

  host.innerHTML = `
    <div class="grid two">
      ${card(
        "EchoStream",
        `
        <div class="muted" style="margin-top:6px">Login or create an account.</div>
        <div class="divider"></div>

        <div class="col">
          <div>
            <div class="small muted">Email</div>
            <input id="authEmail" type="email" placeholder="you@email.com" autocomplete="email" />
          </div>

          <div>
            <div class="small muted">Password</div>
            <input id="authPass" type="password" placeholder="••••••••" autocomplete="current-password" />
          </div>

          <button class="btn primary" id="btnLogin">Login</button>
          <button class="btn" id="btnSignup">Create Account</button>

          <div class="hint">Uses Firebase Auth + Firestore user doc.</div>
        </div>
      `
      )}

      ${card(
        "Features",
        `
        <div class="col small">
          <div class="pill">✅ Posts</div>
          <div class="pill">✅ Likes</div>
          <div class="pill">✅ Comments</div>
          <div class="pill">✅ Follow / Following</div>
          <div class="pill">✅ Search users</div>
          <div class="pill">✅ Notifications</div>
        </div>
      `
      )}
    </div>
  `;

  const onLogin = async () => {
    const email = ($("#authEmail").value || "").trim();
    const pass = $("#authPass").value || "";
    if (!email || !pass) return toast("Enter email + password.");

    try {
      await signInWithEmailAndPassword(auth, email, pass);
      toast("Signed in ✅");
      navigate("home");
    } catch (e) {
      toast(e?.message || "Login failed.");
    }
  };

  const onSignup = async () => {
    const email = ($("#authEmail").value || "").trim();
    const pass = $("#authPass").value || "";
    if (!email || !pass) return toast("Enter email + password.");

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);

      // basic displayName
      const baseName = (email.split("@")[0] || "user").slice(0, 18);
      try {
        await updateProfile(cred.user, { displayName: baseName });
      } catch {}

      // IMPORTANT: create users/{uid} doc
      try {
        await ensureUserDoc(ctx, cred.user);
      } catch (e) {
        console.warn("ensureUserDoc failed:", e);
      }

      toast("Account created ✅");
      navigate("home");
    } catch (e) {
      toast(e?.message || "Signup failed.");
    }
  };

  $("#btnLogin").onclick = onLogin;
  $("#btnSignup").onclick = onSignup;

  // Enter key submits login
  $("#authPass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onLogin();
  });
}
