import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getDatabase, ref, onValue, get, update, set, child, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { FIREBASE_CONFIG, GAME_ID, configured } from "./config.js";

export { serverTimestamp, onValue, get, update, set };

let app, db, auth, offset = 0;

export function initFb() {
  if (!configured()) return false;
  if (!app) {
    app = initializeApp(FIREBASE_CONFIG);
    db = getDatabase(app);
    auth = getAuth(app);
    onValue(ref(db, ".info/serverTimeOffset"), (s) => { offset = s.val() || 0; });
  }
  return true;
}
export const serverNow = () => Date.now() + offset;
export const gref = (...parts) => ref(db, ["games", GAME_ID, ...parts].join("/"));

export function ensureAuth() {
  return new Promise((res, rej) => {
    onAuthStateChanged(auth, (u) => { if (u) res(u); });
    signInAnonymously(auth).catch(rej);
  });
}
export async function read(...parts) {
  const s = await get(gref(...parts));
  return s.val();
}
