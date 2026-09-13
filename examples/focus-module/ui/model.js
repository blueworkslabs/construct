'use strict';
// Shared persisted contract: future versions must keep schema 1 readable on rollback.
const FocusModel = (() => {
  const durations = [1500000, 300000, 10000];
  const fresh = (durationMs = durations[0]) => ({schema:1, phase:'idle', durationMs, remainingMs:durationMs, deadline:null});
  function valid(s) {
    return !!s && typeof s === 'object' && !Array.isArray(s) &&
      Object.keys(s).sort().join(',') === 'deadline,durationMs,phase,remainingMs,schema' &&
      s.schema === 1 && durations.includes(s.durationMs) &&
      ['idle','running','paused','done'].includes(s.phase) &&
      Number.isInteger(s.remainingMs) && s.remainingMs >= 0 && s.remainingMs <= s.durationMs &&
      (s.phase === 'running' ? Number.isSafeInteger(s.deadline) && s.deadline > 0 && s.remainingMs > 0 : s.deadline === null) &&
      (s.phase !== 'done' || s.remainingMs === 0) &&
      (s.phase !== 'paused' || s.remainingMs > 0) &&
      (s.phase !== 'idle' || s.remainingMs === s.durationMs);
  }
  function left(s, now) { return s.phase === 'running' ? Math.max(0, Math.min(s.durationMs, s.deadline - now)) : s.remainingMs; }
  function start(s, now) {
    if (s.phase === 'running') return s;
    const remainingMs = s.phase === 'done' ? s.durationMs : s.remainingMs;
    return {...s, phase:'running', remainingMs, deadline:now + remainingMs};
  }
  function pause(s, now) {
    if (s.phase !== 'running') return s;
    const remainingMs = left(s, now);
    return {...s, phase:remainingMs ? 'paused' : 'done', remainingMs, deadline:null};
  }
  function settle(s, now) { return s.phase === 'running' && left(s, now) === 0 ? {...s, phase:'done', remainingMs:0, deadline:null} : s; }
  return {durations, fresh, valid, left, start, pause, settle};
})();
if (typeof module !== 'undefined') module.exports = FocusModel;
