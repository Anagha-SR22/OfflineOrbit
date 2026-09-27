// Shared IndexedDB wrapper for OfflineOrbit.
// Part A owns storage; Part B (lessons) and Part C (dashboard) use this API.

import { broadcastProgressUpdate } from './live-signal.js';

const DB_NAME = 'offline-learning-app';
const DB_VERSION = 2;
const STORE_PROGRESS = 'progress';
const DEFAULT_STUDENT_ID = 'local-student';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
        const store = db.createObjectStore(STORE_PROGRESS, { keyPath: 'key' });
        store.createIndex('studentId', 'studentId', { unique: false });
        store.createIndex('lessonId', 'lessonId', { unique: false });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

function makeKey(lessonId, studentId) {
  return `${studentId}::${lessonId}`;
}

export async function saveProgress(lessonId, data, studentId = DEFAULT_STUDENT_ID) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROGRESS, 'readwrite');
    const store = tx.objectStore(STORE_PROGRESS);
    const key = makeKey(lessonId, studentId);

    const existingRequest = store.get(key);
    existingRequest.onsuccess = () => {
      const old = existingRequest.result || {};
      const record = {
        ...old,
        ...data,
        key,
        lessonId,
        studentId,
        completed: !!data.completed,
        score: typeof data.score === 'number' ? data.score : (old.score || 0),
        attempts: typeof data.attempts === 'number' ? data.attempts : (old.attempts || 0),
        timestamp: data.timestamp || new Date().toISOString(),
        synced: false
      };
      const req = store.put(record);
      req.onsuccess = () => {
        // Same-device "live" push: lets an already-open Teacher Board tab
        // refresh itself instantly instead of waiting for a manual refresh.
        // No network, no server — see src/shared/live-signal.js.
        broadcastProgressUpdate(record);
        resolve(record);
      };
      req.onerror = () => reject(req.error);
    };
    existingRequest.onerror = () => reject(existingRequest.error);
  });
}

export async function getProgress(lessonId, studentId = DEFAULT_STUDENT_ID) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROGRESS, 'readonly');
    const req = tx.objectStore(STORE_PROGRESS).get(makeKey(lessonId, studentId));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllProgress() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROGRESS, 'readonly');
    const req = tx.objectStore(STORE_PROGRESS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllStudents() {
  const records = await getAllProgress();
  const students = new Map();
  records.forEach((r) => {
    if (!students.has(r.studentId)) {
      students.set(r.studentId, {
        studentId: r.studentId,
        name: r.studentName || r.studentId,
        classId: r.classId || ''
      });
    }
  });
  return Array.from(students.values());
}

// ---------------------------------------------------------------------------
// Backup / Restore
//
// Everything lives in this one device's IndexedDB, so a shared tablet being
// reset or a browser cache being cleared can wipe months of progress with no
// way back. These two functions turn every progress record into a portable
// JSON file (and back), so a teacher can keep a copy off-device and reload it
// after a wipe, or move it to another tablet.
// ---------------------------------------------------------------------------

const BACKUP_FORMAT = 'offlineorbit-backup';
const BACKUP_VERSION = 1;

export async function exportBackup() {
  const records = await getAllProgress();
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    recordCount: records.length,
    records
  };
}

// Restores records from a previously exported backup object (already parsed
// from JSON). Merges into whatever is already on this device rather than
// wiping it: for each record, whichever copy (existing vs. incoming) has the
// newer `timestamp` wins, so restoring an old backup on top of newer local
// progress can't accidentally roll a student back. Pass `overwrite: true` to
// skip that comparison and force every incoming record to win instead (used
// right after a device reset, when "existing" data is stale prototype data
// or simply absent).
export async function importBackup(payload, { overwrite = false } = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('This file is not a valid OfflineOrbit backup.');
  }
  if (payload.format !== BACKUP_FORMAT || !Array.isArray(payload.records)) {
    throw new Error('This file is not a valid OfflineOrbit backup.');
  }

  const db = await openDatabase();
  let imported = 0;
  let skipped = 0;

  for (const incoming of payload.records) {
    if (!incoming || !incoming.lessonId || !incoming.studentId) { skipped++; continue; }
    const key = incoming.key || makeKey(incoming.lessonId, incoming.studentId);

    // eslint-disable-next-line no-await-in-loop
    const existing = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROGRESS, 'readonly');
      const req = tx.objectStore(STORE_PROGRESS).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });

    const incomingTime = incoming.timestamp ? new Date(incoming.timestamp).getTime() : 0;
    const existingTime = existing?.timestamp ? new Date(existing.timestamp).getTime() : -1;
    if (!overwrite && existing && existingTime > incomingTime) { skipped++; continue; }

    const record = { ...incoming, key };
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROGRESS, 'readwrite');
      const req = tx.objectStore(STORE_PROGRESS).put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    imported++;
  }

  return { imported, skipped, total: payload.records.length };
}

// ---------------------------------------------------------------------------
// Optional online sync
//
// Every progress record already carries a `synced` flag (set to false on
// every save) but nothing consumed it. These functions let a "Sync now"
// button push whatever hasn't been synced yet to a simple HTTP endpoint —
// a school's own server, or a Google Apps Script Web App URL sitting in
// front of a Google Sheet both work, since both just need a POST with a
// JSON body. Nothing here requires an endpoint to exist: if it isn't
// configured, or the device is offline, callers get a clear error instead
// of a silent failure.
// ---------------------------------------------------------------------------

export async function getUnsyncedProgress() {
  const records = await getAllProgress();
  return records.filter((r) => !r.synced);
}

export async function markProgressSynced(keys) {
  if (!keys.length) return;
  const db = await openDatabase();
  const tx = db.transaction(STORE_PROGRESS, 'readwrite');
  const store = tx.objectStore(STORE_PROGRESS);
  await Promise.all(keys.map((key) => new Promise((resolve, reject) => {
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) { resolve(); return; }
      const putReq = store.put({ ...record, synced: true });
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  })));
}

// Pushes every unsynced record to `endpointUrl` as one POST request with
// { device, records }. On a 2xx response every record just sent is marked
// synced. Throws (rather than swallowing) on network failure or a non-2xx
// response so the UI can tell the user the sync didn't go through — that
// matters more here than most fetches, since a silent failure would look
// identical to a successful sync.
//
// The body is still JSON, but it's sent with a `text/plain` Content-Type
// rather than `application/json`. That's deliberate: `application/json` is
// a "non-simple" content type, so the browser sends a CORS preflight
// (an OPTIONS request) before the real POST. A Google Apps Script Web
// App — the exact kind of endpoint this app's own README suggests as a
// zero-backend sync target — has no way to answer an OPTIONS request, so
// that preflight fails and the browser blocks the POST from ever being
// sent. `text/plain` is a "simple" content type that skips the preflight
// entirely, so the POST goes straight through; the receiving script can
// still `JSON.parse()` the body regardless of what the header says.
export async function syncProgress(endpointUrl) {
  if (!endpointUrl) throw new Error('No sync endpoint is configured yet.');
  const pending = await getUnsyncedProgress();
  if (!pending.length) return { sent: 0, endpoint: endpointUrl };

  let response;
  try {
    response = await fetch(endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        device: 'offlineorbit-tablet',
        exportedAt: new Date().toISOString(),
        records: pending
      })
    });
  } catch (networkError) {
    throw new Error('Could not reach the sync server. Check the URL, that it allows cross-origin requests, and the internet connection.');
  }

  if (!response.ok) {
    throw new Error(`Sync server rejected the upload (${response.status}).`);
  }

  await markProgressSynced(pending.map((r) => r.key));
  return { sent: pending.length, endpoint: endpointUrl };
}
