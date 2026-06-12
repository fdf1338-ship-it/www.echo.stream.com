import { auth, db, storage } from "./firebase.js";
import {
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const nameInput = document.getElementById("nameInput");
const photoInput = document.getElementById("photoInput");
const saveBtn = document.getElementById("saveBtn");
const msg = document.getElementById("msg");

const user = auth.currentUser;

if (!user) {
  location.href = "index.html";
}

nameInput.value = user.displayName || "";

saveBtn.onclick = async () => {
  saveBtn.disabled = true;
  msg.textContent = "Saving…";

  try {
    let photoURL = user.photoURL;

    if (photoInput.files[0]) {
      const file = photoInput.files[0];
      const imgRef = ref(storage, `avatars/${user.uid}.jpg`);
      await uploadBytes(imgRef, file);
      photoURL = await getDownloadURL(imgRef);
    }

    await updateProfile(user, {
      displayName: nameInput.value,
      photoURL
    });

    await setDoc(
      doc(db, "users", user.uid),
      {
        name: nameInput.value,
        photoURL,
        updatedAt: Date.now()
      },
      { merge: true }
    );

    msg.textContent = "Profile updated ✅";
  } catch (e) {
    msg.textContent = e.message;
  }

  saveBtn.disabled = false;
};
