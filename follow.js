import { db } from "./firebase.js";
import { getUser, getMe, toast, getBanned } from "./ui.js";
import {
  doc, getDoc, setDoc, deleteDoc, serverTimestamp,
  collection, addDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function toggleFollow(targetUid){
  if(getBanned()) return toast("Banned: disabled");
  const u = getUser();
  if(!u?.uid) return toast("Login first");
  if(!targetUid || targetUid === u.uid) return;

  const followingRef = doc(db,"users",u.uid,"following",targetUid);
  const followerRef  = doc(db,"users",targetUid,"followers",u.uid);

  try{
    const snap = await getDoc(followingRef);
    if(snap.exists()){
      await deleteDoc(followingRef);
      await deleteDoc(followerRef);
      toast("Unfollowed");
    }else{
      await setDoc(followingRef,{ uid:targetUid, createdAt:serverTimestamp() });
      await setDoc(followerRef,{ uid:u.uid, createdAt:serverTimestamp() });
      toast("Followed ✅");

      await addDoc(collection(db,"notifications",targetUid,"items"),{
        type:"follow",
        text:`@${getMe()?.username || "user"} followed you`,
        fromUid:u.uid,
        createdAt:serverTimestamp()
      });
    }
  }catch(e){
    toast(e?.message || "Follow failed");
  }
}
