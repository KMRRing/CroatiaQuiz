// ---- paste your Firebase web-app config here (README step 2) ----
export const FIREBASE_CONFIG = {
  apiKey: "PASTE_ME",
  authDomain: "PASTE_ME.firebaseapp.com",
  databaseURL: "https://PASTE_ME-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "PASTE_ME",
  appId: "PASTE_ME",
};

// ---- game rules ----
export const RULES = {
  stipend: 10,      // every player gets this at the start of every round
  bonus: 20,        // added to the pot every round
  minStake: 10,     // floor on every stake
  timerSec: 40,     // seconds per question
};

export const GAME_ID = new URLSearchParams(location.search).get("g") || "croatia";
export const configured = () => FIREBASE_CONFIG.apiKey !== "PASTE_ME";
