/* Detector de mensagens de captura do jogo. Sem depender de chamadas internas da API. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PIWCaptureDetector = api;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const namePattern = "([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.'’♀♂\\- ]{0,42}?)";
  const trailing = "(?=\\s+(?:com\\s+sucesso|usando|utilizando|de\\s+n[ií]vel|n[ií]vel|lv\\.?|level|with|using|at\\s+level)|[!.,;\\n]|$)";
  const patterns = [
    new RegExp('(?:voc[eê]\\s+)?capturou\\s+(?:(?:um|uma|o|a)\\s+)?' + namePattern + trailing, 'i'),
    new RegExp('(?:pok[eé]mon\\s+)?capturad[oa]\\s*[:\\-]\\s*' + namePattern + trailing, 'i'),
    new RegExp('(?:voc[eê]\\s+)?(?:pegou|conseguiu\\s+capturar)\\s+(?:(?:um|uma|o|a)\\s+)?' + namePattern + trailing, 'i'),
    new RegExp('(?:you\\s+)?caught\\s+(?:a\\s+|an\\s+)?' + namePattern + trailing, 'i'),
    new RegExp(namePattern + '\\s+(?:foi\\s+)?capturad[oa](?:\\s+com\\s+sucesso)?(?=[!.,;\\n]|$)', 'i'),
    new RegExp(namePattern + '\\s+(?:was\\s+)?caught(?=[!.,;\\n]|$)', 'i')
  ];
  const generic = /(?:pok[eé]mon\s+capturad[oa](?:\s+com\s+sucesso)?|captura\s+(?:realizada|conclu[ií]da|bem.sucedida|com\s+sucesso)|(?:gotcha|peguei)!?)/i;
  const failure = /\b(?:n[aã]o\s+(?:foi\s+)?capturad[oa]|n[aã]o\s+capturou|falha|falhou|fracassou|escapou|fugiu|escapou\s+da\s+bola|errou|sem\s+sucesso|failed|escaped|broke\s+free|unsuccessful|not\s+caught)\b/i;
  const badNames = new Set(['pokemon','poke ball','pokebola','com sucesso','com','sucesso','um','uma','a','o','agora','novo pokemon','a wild pokemon','you','voce','foi','capturado','capturada']);

  function sanitizeName(value) {
    if (!value) return null;
    const name = String(value)
      .replace(/^(?:um|uma|o|a|the|an?)\s+/i, '')
      .replace(/\s*(?:\(?\s*(?:lv\.?|n[ií]vel|level)\s*\d+\s*\)?).*$/i, '')
      .replace(/\s+(?:com\s+sucesso|usando|utilizando|foi|was|capturado|capturada|caught).*$/i, '')
      .trim().replace(/^[\s:!.,\-]+|[\s:!.,\-]+$/g, '');
    if (!name || name.length > 44 || badNames.has(normalize(name))) return null;
    if (/(?:reconnect|reconectar|lan[cç]ar|sunkern\s+lv.*rattata)/i.test(name)) return null;
    return name;
  }

  function parseCaptureMessage(value, fallbackName = null) {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    if (raw.length < 7 || raw.length > 190 || failure.test(raw)) return null;
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (match) {
        const name = sanitizeName(match[1]);
        if (name) return { species: name, source: 'mensagem', message: raw };
      }
    }
    if (generic.test(raw)) {
      const name = sanitizeName(fallbackName);
      return { species: name || 'Não identificado', source: 'mensagem genérica', message: raw };
    }
    return null;
  }

  function speciesFromButton(btn) {
    if (!btn) return null;
    let cur = btn.parentElement;
    for (let depth = 0; cur && depth < 5; depth++, cur = cur.parentElement) {
      const t = String(cur.innerText || cur.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length > 210) break;
      // Ex.: Sunkern Lv1 Lançar, Rattata Lv. 5 Lançar
      const match = t.match(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.'’♀♂-]*(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9.'’♀♂-]*){0,2})\s+(?:Lv\.?\s*|N[ií]vel\s*|Level\s*)\d+/i);
      if (match) {
        const name = sanitizeName(match[1]);
        if (name) return name;
      }
    }
    return null;
  }

  return { parseCaptureMessage, speciesFromButton, sanitizeName };
});
