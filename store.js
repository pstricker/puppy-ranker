// Shared state: { order, taken, notes }.
//
// With a Firebase config the board lives in Realtime Database and every
// change goes through a transaction, so two phones editing at once apply
// their moves to the latest list instead of overwriting each other. Without
// a config (or if Firebase can't be reached) the board lives in localStorage.

import { normalizeOrder } from './logic.js';
import { firebaseConfig } from './firebase-config.js';

const LS_KEY = 'puppy-ranker:v1';
const BOARD_PATH = 'boards/main';
const FIREBASE_VERSION = '10.12.2';

function pruned(map, keep) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) if (keep(v)) out[k] = v;
  return out;
}

export async function createStore(dogIds, onChange) {
  const clean = (raw) => ({
    order: normalizeOrder(raw?.order, dogIds),
    taken: pruned(raw?.taken, (v) => v === true),
    notes: pruned(raw?.notes, (v) => typeof v === 'string' && v.trim() !== ''),
  });

  const readLocal = () => {
    try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; }
  };
  const writeLocal = (s) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* private mode */ }
  };

  let state = clean(readLocal());
  let status = 'local'; // 'local' | 'connecting' | 'live' | 'offline'
  let liveUpdate = null;

  const emit = () => onChange(state, status);
  const applyLocal = (fn) => {
    state = clean(fn(state));
    writeLocal(state);
    emit();
  };

  // Keep two tabs on the same device in step when running local-only.
  window.addEventListener('storage', (e) => {
    if (e.key !== LS_KEY || liveUpdate) return;
    state = clean(readLocal());
    emit();
  });

  if (firebaseConfig && firebaseConfig.databaseURL) {
    status = 'connecting';
    try {
      const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
      const [{ initializeApp }, db] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-database.js`),
      ]);
      const database = db.getDatabase(initializeApp(firebaseConfig));
      const boardRef = db.ref(database, BOARD_PATH);

      let seeded = false;
      db.onValue(boardRef, (snap) => {
        const val = snap.val();
        if (val === null && !seeded) {
          // First visit ever: start the shared board from whatever this
          // device already has.
          seeded = true;
          db.set(boardRef, state).catch((err) => console.warn('Could not seed board', err));
          return;
        }
        seeded = true;
        state = clean(val);
        writeLocal(state);
        emit();
      }, (err) => {
        console.warn('Sync stopped; saving on this device only.', err);
        liveUpdate = null;
        status = 'local';
        emit();
      });

      db.onValue(db.ref(database, '.info/connected'), (snap) => {
        if (!liveUpdate) return;
        status = snap.val() ? 'live' : 'offline';
        emit();
      });

      liveUpdate = (fn) =>
        db.runTransaction(boardRef, (current) => clean(fn(clean(current)))).catch((err) => {
          console.warn('Change not saved to the shared board', err);
          applyLocal(fn);
        });
    } catch (err) {
      console.warn('Firebase unavailable; saving on this device only.', err);
      liveUpdate = null;
      status = 'local';
    }
  }

  emit();

  return {
    /** Apply fn(state) -> state. */
    update(fn) {
      if (liveUpdate) liveUpdate(fn);
      else applyLocal(fn);
    },
  };
}
