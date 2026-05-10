/**
 * Multilayer cache — Layer 2 (in-memory) + Layer 3 (localStorage)
 *                  + Layer 4 (request deduplication).
 *
 * Read order:  L2 memory → L3 localStorage → L4 dedup → backend API
 * Write order: backend result written to both L2 and L3
 * Invalidation clears L2 and L3 AND cancels any in-flight dedup so the
 * next caller always starts a fresh request.
 *
 * getProject is L2 + L4 only — the full dataframe is too large for localStorage.
 * getLogs / getVizList / getMlInfo use all three persistence layers.
 */

import ApiService from "../services/api";

const TTL_MS    = 5 * 60 * 1000;
const LS_PREFIX = "clc_";

// ── Layer 2 — in-memory store ────────────────────────────────────────────────

const _store = {
  project: {},
  vizList: {},
  logs:    {},
  mlInfo:  {},
  profile: {},  // in-memory only (can be large)
};

function _valid(entry) {
  return entry && Date.now() - entry.ts < TTL_MS;
}

// ── Layer 3 — localStorage helpers ───────────────────────────────────────────

function _lsKey(type, sessionId) {
  return `${LS_PREFIX}${type}_${sessionId}`;
}

function _lsRead(type, sessionId) {
  try {
    const raw = localStorage.getItem(_lsKey(type, sessionId));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    return _valid(entry) ? entry : null;
  } catch {
    return null;
  }
}

function _lsWrite(type, sessionId, data) {
  try {
    localStorage.setItem(
      _lsKey(type, sessionId),
      JSON.stringify({ data, ts: Date.now() }),
    );
  } catch {
    // quota exceeded or private mode — silently skip
  }
}

function _lsDelete(type, sessionId) {
  try {
    localStorage.removeItem(_lsKey(type, sessionId));
  } catch {
    // ignore
  }
}

// ── Layer 4 — in-flight request deduplication ────────────────────────────────
// Maps a cache key → the pending Promise so concurrent callers share one fetch.
// Uses identity check in finally so that invalidateProject's delete doesn't
// remove a *newer* in-flight that replaced an older one.

const _inflight = {};

function _dedup(key, fetchFn) {
  if (_inflight[key]) return _inflight[key];
  const promise = fetchFn().finally(() => {
    if (_inflight[key] === promise) delete _inflight[key];
  });
  _inflight[key] = promise;
  return promise;
}

// ── Version counters — prevent stale in-flight results from poisoning cache ───
// Each invalidateProject call advances the version.  getProject captures the
// version at request-start and rejects (instead of resolving) if it finds a
// mismatch when the response arrives.  Callers receive the rejection silently
// via their .catch(() => null), so the UI never sees stale data.

const _ver = {};

// ── Cached fetchers ───────────────────────────────────────────────────────────

// getProject — L2 + L4 (no localStorage; dataframe too large)
export function getProject(sessionId) {
  const mem = _store.project[sessionId];
  if (_valid(mem)) return Promise.resolve(mem.data);

  const myVer = _ver[sessionId] ?? 0;

  return _dedup(`project:${sessionId}`, async () => {
    const data = await ApiService.getProject(sessionId);
    // Discard result if invalidateProject was called while we were in-flight.
    if ((_ver[sessionId] ?? 0) !== myVer) {
      throw new Error("stale:project");
    }
    _store.project[sessionId] = { data, ts: Date.now() };
    return data;
  });
}

// getVizList — L2 + L3 + L4
export function getVizList(sessionId) {
  const mem = _store.vizList[sessionId];
  if (_valid(mem)) return Promise.resolve(mem.data);

  const ls = _lsRead("vizList", sessionId);
  if (ls) {
    _store.vizList[sessionId] = ls;
    return Promise.resolve(ls.data);
  }

  return _dedup(`vizList:${sessionId}`, async () => {
    const data = await ApiService.listVisualizations(sessionId);
    const entry = { data, ts: Date.now() };
    _store.vizList[sessionId] = entry;
    _lsWrite("vizList", sessionId, data);
    return data;
  });
}

// getLogs — L2 + L3 + L4
export function getLogs(sessionId) {
  const mem = _store.logs[sessionId];
  if (_valid(mem)) return Promise.resolve(mem.data);

  const ls = _lsRead("logs", sessionId);
  if (ls) {
    _store.logs[sessionId] = ls;
    return Promise.resolve(ls.data);
  }

  return _dedup(`logs:${sessionId}`, async () => {
    const data = await ApiService.getPreprocessingLogs(sessionId);
    const entry = { data, ts: Date.now() };
    _store.logs[sessionId] = entry;
    _lsWrite("logs", sessionId, data);
    return data;
  });
}

// getMlInfo — L2 + L3 + L4
export function getMlInfo(sessionId) {
  const mem = _store.mlInfo[sessionId];
  if (_valid(mem)) return Promise.resolve(mem.data);

  const ls = _lsRead("mlInfo", sessionId);
  if (ls) {
    _store.mlInfo[sessionId] = ls;
    return Promise.resolve(ls.data);
  }

  return _dedup(`mlInfo:${sessionId}`, async () => {
    const data = await ApiService.getMLSessionInfo(sessionId);
    const entry = { data, ts: Date.now() };
    _store.mlInfo[sessionId] = entry;
    _lsWrite("mlInfo", sessionId, data);
    return data;
  });
}

// ── Layer 5 — prefetching ────────────────────────────────────────────────────
// Called after the current page's critical data is loaded. Warms the cache for
// the other pages during browser idle time so navigation is instant.

const _idle = window.requestIdleCallback
  ? (fn) => window.requestIdleCallback(fn, { timeout: 2000 })
  : (fn) => setTimeout(fn, 300);

export function prefetch(sessionId) {
  if (!sessionId) return;
  _idle(() => getVizList(sessionId).catch(() => {}));
  _idle(() => getLogs(sessionId).catch(() => {}));
  _idle(() => getMlInfo(sessionId).catch(() => {}));
}

// ── Profile cache — in-memory only (can be large) ────────────────────────────

/** Read profile from cache synchronously. Returns null on miss or expiry. */
export function getProfileSync(sessionId) {
  if (!sessionId) return null;
  const entry = _store.profile[sessionId];
  return _valid(entry) ? entry.data : null;
}

/** Write profile into cache. */
export function setProfileCache(sessionId, data) {
  if (!sessionId || !data) return;
  _store.profile[sessionId] = { data, ts: Date.now() };
}

/** Clear profile cache (call after any mutation that changes profile stats). */
export function invalidateProfile(sessionId) {
  delete _store.profile[sessionId];
}

// ── Invalidators — clear L2, L3, in-flight dedup, and version ────────────────

export function invalidateProject(sessionId) {
  delete _store.project[sessionId];
  // Advance version so any in-flight getProject rejects instead of writing
  // stale data back into the cache or resolving .then handlers with old steps.
  _ver[sessionId] = (_ver[sessionId] ?? 0) + 1;
  // Remove the dedup entry so the next getProject starts a fresh network
  // request rather than joining the now-stale in-flight promise.
  delete _inflight[`project:${sessionId}`];
}

export function invalidateVizList(sessionId) {
  delete _store.vizList[sessionId];
  _lsDelete("vizList", sessionId);
}

export function invalidateLogs(sessionId) {
  delete _store.logs[sessionId];
  _lsDelete("logs", sessionId);
}

export function invalidateMlInfo(sessionId) {
  delete _store.mlInfo[sessionId];
  _lsDelete("mlInfo", sessionId);
}

export function invalidateAll(sessionId) {
  delete _store.project[sessionId];
  delete _store.vizList[sessionId];
  delete _store.logs[sessionId];
  delete _store.mlInfo[sessionId];
  delete _store.profile[sessionId];
  _lsDelete("vizList", sessionId);
  _lsDelete("logs", sessionId);
  _lsDelete("mlInfo", sessionId);
}
