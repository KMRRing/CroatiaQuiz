# Croatia Quiz

Parimutuel end-of-year quiz. 25 phones + a big screen + a host console, all static pages
on GitHub Pages, with Firebase Realtime Database carrying the live state. No server of ours.

## Rules baked in (edit `js/config.js`)
- $10 stipend to every player at the start of every round; minimum stake $10 of your stack.
- Stake = % of holdings via slider; pot = losers' stakes + $20 bonus + any rollover.
- Winners split the pot pro rata to stake: payout = stake x (W + pot) / W. Nobody right -> pot rolls over.
- No answer by the buzzer -> minimum stake rides and loses.
- AIs: answers shown at reveal, stakes never (computed at settlement, never written to the DB),
  stated confidences only at the finale calibration board. Two monkeys included.

## Views
| URL hash   | What it is |
|------------|-----------------------------------------------|
| `#join`    | player phone (default)                        |
| `#screen`  | big screen: QR lobby, question, reveal, finale|
| `#host`    | host console (claim, start, settle, finish)   |
| `#swarm?n=25` | test harness: 25 fake players             |

## Setup (one-time, ~15 min, all in the browser)

1. **Firebase project.** console.firebase.google.com -> Add project (any name, Analytics off).
2. **Web app + config.** Project overview -> the `</>` (web) icon -> register app (no hosting) ->
   copy the `firebaseConfig` object -> paste its values into `js/config.js` -> commit & push.
3. **Realtime Database.** Build -> Realtime Database -> Create database -> Belgium (europe-west1) ->
   locked mode. Then copy `databaseURL` from the database page into `js/config.js` too
   (format `https://<project>-default-rtdb.europe-west1.firebasedatabase.app`).
4. **Rules.** Database -> Rules tab -> replace everything with the contents of
   `database.rules.json` -> Publish.
5. **Anonymous auth.** Build -> Authentication -> Get started -> Sign-in method ->
   Anonymous -> Enable -> Save.
6. **GitHub Pages.** Repo -> Settings -> Pages -> Source: Deploy from a branch ->
   `main` / root -> Save. Site: `https://kmrringqa.github.io/CroatiaQuiz/`.

## Running the night
1. Open `#host` on your laptop, "Claim host on this device", then "Open lobby". Keep the tab open
   and the laptop awake - the host tab is the referee (it adds stipends, closes rounds, settles).
2. Open `#screen` on the TV. Players scan the QR.
3. "Start question 1". Rounds auto-close and settle at 0s; talk through the reveal; "Start question 2"...
4. After Q16's reveal: "Finish -> finale".

## Rehearsal
Open `#swarm?n=25` in one tab, `#screen` in another, `#host` in a third; play a phone yourself.
Then once more with a phone on mobile data (kill wifi mid-question - it should reclaim its
character and keep playing).

## Filling in the AI answers
`js/bots.js` -> `AI_ANSWERS`. One entry per question: `{ a: "1", c: 0.9 }`
(a = sorted option indices, so "01234" for a select-all; c = stated confidence 0..1).
Get them by pasting all 16 questions into each chat app and asking for exactly that JSON.

## Multiple games / reruns
Everything lives under one game id (`croatia`). Append `?g=test` to any URL for a parallel
throwaway game (e.g. for the swarm rehearsal), or use the host console's Reset.
