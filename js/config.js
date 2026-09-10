// ---- Firebase web-app config (croatiabio) ----
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCfl6mWI_7cf2VYnpxXB9WwTU_weoH8vA0",
  authDomain: "croatiabio.firebaseapp.com",
  projectId: "croatiabio",
  storageBucket: "croatiabio.firebasestorage.app",
  messagingSenderId: "113693793639",
  appId: "1:113693793639:web:b24cbab9ade143042523c2",
};

// The Realtime Database URL depends on the region picked at creation.
// The app probes these in order at startup and uses the first that exists.
export const DB_URL_CANDIDATES = [
  "https://croatiabio-default-rtdb.europe-west1.firebasedatabase.app",
  "https://croatiabio-default-rtdb.firebaseio.com",
];

// ---- game rules ----
export const RULES = {
  start: 5, stipend: 10,      // every player gets this at the start of every round
  bonus: 20,        // added to the pot every round
  minStake: 10,     // floor on every stake
  timerSec: 35,     // seconds per question
};

export const BUILD = "b152-tutfix";
export const SHOW_REFRESH = true;  // set false for the real event

export const GAME_ID = (typeof location !== "undefined" ? new URLSearchParams(location.search).get("g") : null) || "croatia";
export const TEST_MODE = /^test/i.test(GAME_ID);
export const configured = () => FIREBASE_CONFIG.apiKey !== "PASTE_ME";
