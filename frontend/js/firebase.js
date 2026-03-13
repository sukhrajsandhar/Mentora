// ── firebase.js ───────────────────────────────────────────────────────────────
// Firebase init + all Firestore session CRUD operations.
// Uses Firebase modular SDK v10 via CDN (loaded as ES modules).
//
// ⚠️  To get your real config: Firebase Console → mentora-main → Project Settings
//     → Your apps → Web app → SDK setup and configuration → Config

import { initializeApp }    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore,
  collection,
  addDoc,
  setDoc,
  getDocs,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ⚠️  Replace appId with the real value from Firebase Console → Project Settings
const firebaseConfig = {
  apiKey:            "AIzaSyDCR7bj0-6Mntaxn3LOQLYytE5W2E5p4cM",
  authDomain:        "mentora-main.firebaseapp.com",
  projectId:         "mentora-main",
  storageBucket:     "mentora-main.firebasestorage.app",
  messagingSenderId: "575630818350",
  appId:             "1:575630818350:web:03d6be9b2680fc47bab3bf",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

console.log('[Firebase] Firestore ready — project: mentora-main');

// ── Device ID ─────────────────────────────────────────────────────────────────

export function getDeviceId() {
  let id = localStorage.getItem('sketchsense_device_id');
  if (!id) {
    id = 'device_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('sketchsense_device_id', id);
  }
  return id;
}

// ── Save / upsert a session ───────────────────────────────────────────────────

export async function saveSessionToFirestore(sessionData, sessionId = null) {
  try {
    const payload = {
      ...sessionData,
      deviceId:  getDeviceId(),
      updatedAt: serverTimestamp(),
    };

    if (sessionId) {
      await setDoc(doc(db, 'sessions', sessionId), payload, { merge: true });
      return sessionId;
    } else {
      payload.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db, 'sessions'), payload);
      return ref.id;
    }
  } catch (err) {
    console.error('[Firebase] Save failed:', err.message);
    return null;
  }
}

// ── Patch specific fields on a session ────────────────────────────────────────

export async function updateSessionFields(sessionId, fields) {
  try {
    await setDoc(doc(db, 'sessions', sessionId), {
      ...fields,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return true;
  } catch (err) {
    console.error('[Firebase] Update failed:', err.message);
    return false;
  }
}

// ── Load all sessions for this device ─────────────────────────────────────────

export async function loadSessionsFromFirestore() {
  try {
    const q = query(
      collection(db, 'sessions'),
      where('deviceId', '==', getDeviceId()),
      orderBy('updatedAt', 'desc'),
      limit(50)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error('[Firebase] Load failed:', err.message);
    return [];
  }
}

// ── Delete a session ───────────────────────────────────────────────────────────

export async function deleteSessionFromFirestore(sessionId) {
  try {
    await deleteDoc(doc(db, 'sessions', sessionId));
  } catch (err) {
    console.error('[Firebase] Delete failed:', err.message);
  }
}