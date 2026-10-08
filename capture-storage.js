/* Storage controlado pelo service worker, protegido contra gravações simultâneas. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PIWCaptureStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const MAX_HISTORY = 600;
  function addCapture(stats, data) {
    const species = String(data.species || 'Não identificado').trim().slice(0, 60);
    const caught = Number(stats.caught || 0) + 1;
    const bySpecies = { ...(stats.bySpecies || {}) };
    bySpecies[species] = Number(bySpecies[species] || 0) + 1;
    const item = {
      id: String(data.id || `${Date.now()}-${caught}`).slice(0, 96),
      species,
      at: Number(data.at) || Date.now()
    };
    return {
      caught,
      bySpecies,
      captureHistory: [item, ...(stats.captureHistory || [])].slice(0, MAX_HISTORY),
      lastCaptured: item,
      lastAction: `Capturado: ${species}`,
      lastActionAt: Date.now()
    };
  }
  return { addCapture, MAX_HISTORY };
});
