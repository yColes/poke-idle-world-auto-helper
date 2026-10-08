/* Detector conservador: só registra mensagens que afirmam sucesso na captura.
   Não considera clique em Pokébola como captura confirmada. */
(() => {
  'use strict';

  const accentless = value => String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  function sanitizeName(raw) {
    if (!raw) return '';
    const name = raw
      .replace(/^[\s:–—-]*(?:um|uma|o|a|pok[eé]mon)\s+/i, '')
      .replace(/\s*(?:[!.,;:]|\s*[|•].*)$/g, '')
      .replace(/\s+(?:com|de)\s+(?:iv|quality|qualidade|potencial|lvl|level|n[ií]vel)\b.*$/i, '')
      .replace(/\s*[([]\s*(?:shiny|iv|quality|qualidade|lv\.?|lvl)\b.*$/i, '')
      .replace(/\s+com\s+sucesso[.!]?$/i, '')
      .replace(/^shiny\s+/i, '')
      .replace(/\s+\b(?:shiny|normal)\b$/i, '')
      .trim();
    if (!name || name.length > 70 || name.split(/\s+/).length > 6) return '';
    if (!/^[\p{L}\p{N}]/u.test(name)) return '';
    if (/^(?:pokemon|pok[eé]mon|captura|capturado|com sucesso|sucesso|pokebola|pok[eé]bola)$/i.test(accentless(name))) return '';
    return name;
  }

  function parseCapture(message) {
    const raw = String(message ?? '').replace(/\s+/g, ' ').trim();
    if (raw.length < 9 || raw.length > 260) return null;
    const plain = accentless(raw).toLowerCase();
    if (!/(captur|capture|caught)/.test(plain)) return null;
    if (/(?:nao|not|falh|failed|escap|fugiu|fugid|quebr|sem sucesso|tentativa|chance|probabilidade|status|taxa de captura)/.test(plain)) return null;

    // O nome precisa estar explícito na mensagem. Evita inventar nomes.
    const patterns = [
      /(?:voc[eê]\s+)?capturou\s+(?:um(?:a)?\s+)?(?:pok[eé]mon\s+)?(?<name>[\p{L}\p{N}][\p{L}\p{N} .♀♂'’\-]{1,65})(?=\s*(?:!|\s*\(|$))/iu,
      /(?:you\s+)?(?:caught|captured)\s+(?:a\s+)?(?<name>[\p{L}\p{N}][\p{L}\p{N} .♀♂'’\-]{1,65})(?=\s*(?:!|$))/iu,
      /(?<name>[\p{L}\p{N}][\p{L}\p{N} .♀♂'’\-]{1,65}?)\s+(?:foi\s+capturad[oa]|capturad[oa](?:\s+com\s+sucesso)?|was\s+caught)(?:\s|[!.,]|$)/iu,
      /(?:pok[eé]mon\s+)?capturad[oa](?:\s+com\s+sucesso)?\s*[:!–-]\s*(?<name>[\p{L}\p{N}][\p{L}\p{N} .♀♂'’\-]{1,65})(?=\s*(?:!|\s*\(|$))/iu,
      /(?:captura\s+(?:realizada|conclu[ií]da)\s+com\s+sucesso|sucesso\s+na\s+captura)\s*[:!–-]\s*(?<name>[\p{L}\p{N}][\p{L}\p{N} .♀♂'’\-]{1,65})(?=\s*(?:!|$))/iu
    ];

    for (const pattern of patterns) {
      const m = raw.match(pattern);
      if (!m) continue;
      const name = sanitizeName(m.groups?.name);
      if (!name) continue;
      return { name, shiny: /\bshiny\b/i.test(raw), message: raw };
    }
    return null;
  }

  const api = Object.freeze({ parseCapture, sanitizeName });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.PokeIdleCaptureParser = api;
})();
