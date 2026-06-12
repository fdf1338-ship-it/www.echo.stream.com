import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCmY_zfNcH5XnEaQxlqaTW1D8EUR670-Zo",
  authDomain: "echostream-a102a.firebaseapp.com",
  databaseURL: "https://echostream-a102a-default-rtdb.firebaseio.com",
  projectId: "echostream-a102a",
  storageBucket: "echostream-a102a.firebasestorage.app",
  messagingSenderId: "789062222400",
  appId: "1:789062222400:web:73d478269135a77d7d55a5",
  measurementId: "G-QCJ1240EC5"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
// expose for other files (updates.js / updates-messages.js)
window.auth = auth;
window.db = db;
window.storage = storage;
