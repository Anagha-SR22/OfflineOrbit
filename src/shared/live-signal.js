// Lightweight "live" signal channel for OfflineOrbit.
//
// IMPORTANT — what this can and can't do:
// OfflineOrbit is offline-first: every record lives only in this browser's
// IndexedDB, and there is no server relaying anything between separate
// physical devices (that's what the optional "Sync now" endpoint in db.js
// is for, and it's a one-way, on-demand push). What this module *can* do
// honestly, with no backend and no network, is make something that happens
// in one browser tab on this device (a student answering a question, a
// student raising a hand) show up instantly in another tab open on the
// *same* device/browser — e.g. a shared classroom laptop with a student's
// lesson tab and the teacher's dashboard tab open side by side. It uses the
// browser's BroadcastChannel API, so it's push, not polling, and it never
// touches the network. It does not make the Teacher Board update live from
// a *different* tablet across the room; that would need a real always-on
// server in the middle.

const HAS_BROADCAST = typeof BroadcastChannel !== 'undefined';

// Whether same-device live push (BroadcastChannel) is available at all in
// this browser. When false, the Teacher Board still works — it just falls
// back to the manual "Refresh" button and to loading raised hands on open.
export const LIVE_UPDATES_SUPPORTED = HAS_BROADCAST;

const PROGRESS_CHANNEL_NAME = 'offlineorbit-progress-live';
const HANDS_CHANNEL_NAME = 'offlineorbit-raised-hands-live';
const HANDS_KEY = 'offlineOrbitRaisedHands';

const progressChannel = HAS_BROADCAST ? new BroadcastChannel(PROGRESS_CHANNEL_NAME) : null;
const handsChannel = HAS_BROADCAST ? new BroadcastChannel(HANDS_CHANNEL_NAME) : null;

// ---------------------------------------------------------------------------
// Progress updates — lets the Teacher Board refresh itself the instant a
// student (in another tab on this device) saves an answer, instead of
// waiting for a manual "Refresh" tap. Carries just enough to know something
// changed; listeners re-read IndexedDB for the actual data.
// ---------------------------------------------------------------------------

export function broadcastProgressUpdate(record) {
  if (!progressChannel || !record) return;
  try {
    progressChannel.postMessage({
      studentId: record.studentId,
      lessonId: record.lessonId,
      timestamp: record.timestamp || new Date().toISOString()
    });
  } catch {
    // BroadcastChannel can throw if the tab is being torn down; safe to ignore.
  }
}

// Returns an unsubscribe function. No-op (but still safe to call) in
// browsers without BroadcastChannel support.
export function onProgressUpdate(callback) {
  if (!progressChannel) return () => {};
  const handler = (event) => callback(event.data);
  progressChannel.addEventListener('message', handler);
  return () => progressChannel.removeEventListener('message', handler);
}

// ---------------------------------------------------------------------------
// Raised hands — a student taps "I'm stuck" on a question; it appears on the
// Teacher Board with their name and which question, until the teacher (or
// the student) clears it. Backed by localStorage so it also works if the
// Teacher Board tab is opened *after* the hand was raised, and broadcast so
// an already-open Teacher Board updates immediately.
// ---------------------------------------------------------------------------

function readHands() {
  try {
    const raw = JSON.parse(localStorage.getItem(HANDS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeHands(hands) {
  try { localStorage.setItem(HANDS_KEY, JSON.stringify(hands)); } catch { /* storage full/unavailable */ }
}

export function getRaisedHands() {
  return readHands();
}

export function isHandRaised(studentId) {
  return readHands().some((h) => h.studentId === studentId);
}

export function raiseHand({ studentId, name, classId, lessonId, questionIndex, questionText }) {
  if (!studentId) return null;
  const entry = {
    studentId,
    name: name || studentId,
    classId: classId || '',
    lessonId: lessonId || '',
    questionIndex: typeof questionIndex === 'number' ? questionIndex : null,
    questionText: questionText || '',
    timestamp: new Date().toISOString()
  };
  const hands = readHands().filter((h) => h.studentId !== studentId);
  hands.push(entry);
  writeHands(hands);
  try { handsChannel?.postMessage({ type: 'raised', entry }); } catch { /* ignore */ }
  return entry;
}

export function lowerHand(studentId) {
  if (!studentId) return;
  const hands = readHands().filter((h) => h.studentId !== studentId);
  writeHands(hands);
  try { handsChannel?.postMessage({ type: 'lowered', studentId }); } catch { /* ignore */ }
}

// Fires on: another tab raising/lowering a hand (BroadcastChannel, instant)
// and, as a fallback for browsers without BroadcastChannel, on the native
// 'storage' event (which only fires in *other* tabs, per the spec). Returns
// an unsubscribe function.
export function onHandsChanged(callback) {
  const bcHandler = (event) => callback(event.data || { type: 'sync' });
  handsChannel?.addEventListener('message', bcHandler);

  const storageHandler = (event) => {
    if (event.key === HANDS_KEY) callback({ type: 'sync' });
  };
  window.addEventListener('storage', storageHandler);

  return () => {
    handsChannel?.removeEventListener('message', bcHandler);
    window.removeEventListener('storage', storageHandler);
  };
}
