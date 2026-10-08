(() => {
  'use strict';

  if (window.__PIW_AUTO_HELPER_LOADED__) return;
  window.__PIW_AUTO_HELPER_LOADED__ = true;

  const DEFAULTS = {
    enabled: true,
    autoCatch: true,
    autoSwitchBalls: true,
    warnLowBalls: true,
    autoReconnect: true,
    closePopups: true,
    autoReload: true,
    showHUD: true,
    showQuickToggle: true,
    preventDiscard: true,
    cooldownMs: 4050,
    lowBallThreshold: 20,
    reloadAfterDisconnectMs: 12000
  };

  // v1.4 ULTRA LIGHT:
  // - encontra a janela CAPTURA uma vez e mantém a referência
  // - durante o jogo, procura "Lançar" SOMENTE dentro dessa janela pequena
  // - a página inteira só é varrida novamente se a janela desaparecer
  // - reconexão/pop-ups têm um scanner separado e lento
  // - observer global acompanha somente nós adicionados (sem class/style/attributes)
  const PERF = Object.freeze({
    cachedCatchPollMs: 300,
    ballManagerMs: 900,
    discoveryScanMs: 3500,
    utilityScanMs: 3000,
    watchdogMs: 6000,
    bodyDisconnectProbeMs: 20000,
    hudClockMs: 2000,
    mutationDebounceMs: 140,
    maxMutationNodesPerBatch: 60,
    maxSmallSubtreeChildren: 20
  });

  let config = { ...DEFAULTS };
  let observer = null;
  let catchTimer = null;
  let ballTimer = null;
  let discoveryTimer = null;
  let utilityTimer = null;
  let watchdogTimer = null;
  let hudTimer = null;
  let mutationTimer = null;
  let pendingMutationNodes = [];
  let lastBodyDisconnectProbe = 0;
  let cachedDisconnect = false;

  const captureCache = {
    root: null,
    discoveredAt: 0,
    scans: 0
  };

  const state = {
    startedAt: Date.now(),
    lastCatch: 0,
    lastReconnect: 0,
    disconnectedAt: 0,
    catchBusy: false,
    lastAction: 'Aguardando',
    sessionCatches: 0,
    sessionReconnects: 0,
    sessionPopups: 0,
    confirmedCaptures: 0,
    allCaptures: 0,
    lastCapturedPokemon: '',
    lastBallSwitch: 0,
    ballSnapshot: null
  };

  const hudRefs = Object.create(null);
  let hud = null;
  let quickToggle = null;
  let hudTitle = null;
  let toastHost = null;
  let hudPosition = null;

  function norm(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function fastText(el) {
    if (!el) return '';
    return String(el.textContent || el.value || '').replace(/\s+/g, ' ').trim();
  }

  function isVisibleFast(el) {
    if (!el || !el.isConnected || el.hidden) return false;
    if (el.getAttribute?.('aria-hidden') === 'true') return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects?.().length);
  }

  function isEnabled(el) {
    if (!el) return false;
    if (el.disabled || el.hasAttribute?.('disabled')) return false;
    if (el.getAttribute?.('aria-disabled') === 'true') return false;
    if (el.classList?.contains('disabled')) return false;
    return true;
  }

  function dispatchClick(el) {
    if (!el) return;
    try { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, cancelable:true, pointerType:'mouse' })); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, view:window })); } catch (_) {}
    try { el.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, cancelable:true, pointerType:'mouse' })); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles:true, cancelable:true, view:window })); } catch (_) {}
    try { el.click(); } catch (_) {}
  }

  function setAction(action) {
    if (state.lastAction === action) return;
    state.lastAction = action;
    updateHUDState();
  }

  async function bumpStats(key) {
    try {
      const current = await chrome.storage.local.get({ catches:0, reconnects:0, popups:0 });
      const patch = { lastAction:state.lastAction, lastActionAt:Date.now() };
      patch[key] = Number(current[key] || 0) + 1;
      await chrome.storage.local.set(patch);
    } catch (_) {}
  }

  // ---------------- Cache direto da janela CAPTURA ----------------
  const interactiveSelector = 'button,[role="button"],input[type="button"],input[type="submit"],a';

  function isLaunchLabel(el) {
    const label = norm(fastText(el));
    return label === 'lancar' || label.startsWith('lancar ');
  }

  function findCaptureRootFromLaunch(btn) {
    let cur = btn;
    for (let i = 0; cur && i < 10; i++, cur = cur.parentElement) {
      const children = cur.childElementCount || 0;
      if (children > 90) continue;
      const raw = fastText(cur);
      if (!raw || raw.length > 2200) continue;
      if (norm(raw).includes('captura')) return cur;
    }
    return null;
  }

  function cacheCaptureRoot(root) {
    if (!root || !root.isConnected) return false;
    if (captureCache.root === root) return true;
    captureCache.root = root;
    captureCache.discoveredAt = Date.now();
    captureCache.scans++;
    setAction('Janela CAPTURA localizada');
    updateQuickToggle();
    return true;
  }

  function invalidateCaptureCache() {
    captureCache.root = null;
    captureCache.discoveredAt = 0;
  }

  function discoverCaptureRoot(scope = document) {
    if (captureCache.root?.isConnected) return captureCache.root;

    let candidates = [];
    try {
      if (scope !== document && scope.matches?.(interactiveSelector)) candidates.push(scope);
      const found = scope.querySelectorAll?.(interactiveSelector);
      if (found) candidates.push(...found);
    } catch (_) {
      return null;
    }

    for (const el of candidates) {
      if (!isLaunchLabel(el)) continue;
      const root = findCaptureRootFromLaunch(el);
      if (root) {
        cacheCaptureRoot(root);
        return root;
      }
    }
    return null;
  }

  function captureButtonsFromCache() {
    const root = captureCache.root;
    if (!root?.isConnected) {
      invalidateCaptureCache();
      return [];
    }

    let elements;
    try {
      elements = root.querySelectorAll(interactiveSelector);
    } catch (_) {
      invalidateCaptureCache();
      return [];
    }

    const launches = [];
    for (const el of elements) {
      if (isLaunchLabel(el)) launches.push(el);
    }

    // Se a referência virou outro bloco do React/Vue, deixamos o scanner de descoberta achar a nova.
    if (!launches.length && Date.now() - captureCache.discoveredAt > 5000) {
      invalidateCaptureCache();
    }
    return launches;
  }

  function autoCatch(btn) {
    if (!config.enabled || !config.autoCatch || state.catchBusy || !btn) return false;
    if (!isEnabled(btn) || !isVisibleFast(btn)) return false;

    const now = Date.now();
    const cooldown = Math.max(4000, Number(config.cooldownMs) || 4050);
    if (now - state.lastCatch < cooldown) return false;

    state.catchBusy = true;
    state.lastCatch = now;
    state.sessionCatches++;
    setAction(`Pokébola lançada #${state.sessionCatches}`);
    dispatchClick(btn);
    bumpStats('catches');

    setTimeout(() => {
      state.catchBusy = false;
    }, cooldown);
    return true;
  }

  function cachedCatchTick() {
    if (!config.enabled || !config.autoCatch || state.catchBusy) return;
    if (!captureCache.root?.isConnected) return;

    const launches = captureButtonsFromCache();
    for (const btn of launches) {
      if (autoCatch(btn)) break;
    }
  }

  function discoveryTick() {
    if (!config.enabled || (!config.autoCatch && !config.autoSwitchBalls && !config.warnLowBalls)) return;
    if (!captureCache.root?.isConnected) discoverCaptureRoot(document);
    cachedCatchTick();
  }

  // ---------------- Gerenciador automático de Pokébolas ----------------
  const BALL_TYPES = Object.freeze([
    { key:'poke', name:'Poké Ball', priority:10, aliases:['poké ball','poke ball','pokeball','pokébola','pokebola'] },
    { key:'great', name:'Great Ball', priority:20, aliases:['great ball','greatball'] },
    { key:'ultra', name:'Ultra Ball', priority:30, aliases:['ultra ball','ultraball'] },
    { key:'premier', name:'Premier Ball', priority:35, aliases:['premier ball','premierball'] },
    { key:'heal', name:'Heal Ball', priority:36, aliases:['heal ball','healball'] },
    { key:'net', name:'Net Ball', priority:37, aliases:['net ball','netball'] },
    { key:'nest', name:'Nest Ball', priority:38, aliases:['nest ball','nestball'] },
    { key:'dive', name:'Dive Ball', priority:39, aliases:['dive ball','diveball'] },
    { key:'repeat', name:'Repeat Ball', priority:40, aliases:['repeat ball','repeatball'] },
    { key:'timer', name:'Timer Ball', priority:41, aliases:['timer ball','timerball'] },
    { key:'dusk', name:'Dusk Ball', priority:42, aliases:['dusk ball','duskball'] },
    { key:'quick', name:'Quick Ball', priority:43, aliases:['quick ball','quickball'] },
    { key:'luxury', name:'Luxury Ball', priority:44, aliases:['luxury ball','luxuryball'] },
    { key:'master', name:'Master Ball', priority:100, aliases:['master ball','masterball'] }
  ]);

  const BALL_BY_KEY = Object.fromEntries(BALL_TYPES.map(x => [x.key, x]));
  const ballWarnings = new Map();
  let ballMenuOpenAttemptAt = 0;

  function compactMeta(el) {
    if (!el) return '';
    const parts = [];
    const add = value => {
      const v = String(value || '').trim();
      if (v && v.length <= 180) parts.push(v);
    };
    add(el.getAttribute?.('aria-label'));
    add(el.getAttribute?.('title'));
    add(el.getAttribute?.('data-name'));
    add(el.getAttribute?.('data-ball'));
    add(el.getAttribute?.('alt'));
    add(el.getAttribute?.('src'));
    if (el.tagName === 'IMG') add(el.getAttribute?.('src'));
    if (parts.join(' ').length < 250) {
      const raw = fastText(el);
      if (raw.length <= 100) add(raw);
    }
    return norm(parts.join(' '));
  }

  function detectBallType(el) {
    const meta = compactMeta(el);
    if (!meta) return null;
    for (const type of BALL_TYPES) {
      for (const alias of type.aliases) {
        const a = norm(alias);
        if (meta.includes(a) || meta.includes(a.replace(/\s+/g,'')) || meta.includes(a.replace(/\s+/g,'-')) || meta.includes(a.replace(/\s+/g,'_'))) {
          return type;
        }
      }
    }
    return null;
  }

  function parseCountText(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 120) return null;
    const matches = [...text.matchAll(/(?:^|[^\d])(?:x\s*)?(\d{1,6})(?!\d)/gi)];
    if (!matches.length) return null;
    const values = matches.map(m => Number(m[1])).filter(Number.isFinite);
    if (!values.length) return null;
    // O estoque da bola costuma ser o maior inteiro dentro do pequeno seletor.
    return Math.max(...values);
  }

  function ballCountNear(el) {
    let cur = el;
    for (let depth = 0; cur && depth < 4; depth++, cur = cur.parentElement) {
      if (!captureCache.root?.contains(cur)) break;
      const raw = fastText(cur);
      if (!raw || raw.length > 120 || (cur.childElementCount || 0) > 12) continue;
      const count = parseCountText(raw);
      if (count != null) return count;
    }
    return null;
  }

  function interactiveAncestor(el) {
    let cur = el;
    for (let i = 0; cur && i < 5; i++, cur = cur.parentElement) {
      if (!captureCache.root?.contains(cur)) return null;
      if (cur.matches?.(interactiveSelector)) return cur;
      if (cur.tabIndex >= 0 && cur.getAttribute?.('role') === 'button') return cur;
    }
    return null;
  }

  function selectedScore(el) {
    let score = 0;
    for (let cur = el, i = 0; cur && i < 4; i++, cur = cur.parentElement) {
      if (!captureCache.root?.contains(cur)) break;
      const cls = norm(cur.className?.toString());
      if (/selected|active|current|checked|equipped|chosen/.test(cls)) score += 4;
      if (cur.getAttribute?.('aria-pressed') === 'true') score += 5;
      if (cur.getAttribute?.('aria-selected') === 'true') score += 5;
      if (cur.getAttribute?.('data-selected') === 'true') score += 5;
    }
    return score;
  }

  function scanBallInventory() {
    const root = captureCache.root;
    if (!root?.isConnected) return { detected:false, current:null, stocks:[], out:false, at:Date.now() };

    let nodes = [];
    try {
      nodes = [...root.querySelectorAll('img,[aria-label],[title],[data-name],[data-ball],button,[role="button"]')];
    } catch (_) {
      return { detected:false, current:null, stocks:[], out:false, at:Date.now() };
    }

    const found = new Map();
    for (const node of nodes) {
      const type = detectBallType(node);
      if (!type || !isVisibleFast(node)) continue;
      const target = interactiveAncestor(node) || node;
      const count = ballCountNear(node);
      const candidate = {
        key:type.key,
        name:type.name,
        priority:type.priority,
        count,
        target,
        selectedScore:selectedScore(node),
        visible:true
      };
      const old = found.get(type.key);
      if (!old || candidate.selectedScore > old.selectedScore || (old.count == null && candidate.count != null)) {
        found.set(type.key, candidate);
      }
    }

    const stocks = [...found.values()].sort((a,b) => a.priority - b.priority);
    let current = stocks.filter(x => x.selectedScore > 0).sort((a,b) => b.selectedScore - a.selectedScore)[0] || null;

    // Se só existe um tipo de bola visível no bloco principal, normalmente esse é o seletor atual.
    if (!current && stocks.length === 1) current = stocks[0];

    // Quando várias opções estão abertas e nenhuma tem classe de seleção, usamos a que tem contador
    // em um seletor compacto; isso é conservador e evita escolher por chute.
    if (!current) {
      const withCount = stocks.filter(x => x.count != null);
      if (withCount.length === 1) current = withCount[0];
    }

    for (const item of stocks) item.current = !!current && item.key === current.key;
    const knownCounts = stocks.filter(x => x.count != null);
    const out = !!current && current.count === 0 && knownCounts.length > 1 && knownCounts.every(x => x.count === 0);
    return { detected:stocks.length > 0, current, stocks, out, at:Date.now() };
  }

  function showToast(message, level = 'info') {
    if (!document.body) return;
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.id = 'piw-auto-helper-toasts';
      toastHost.style.cssText = [
        'position:fixed','right:14px','bottom:14px','z-index:2147483647','display:flex','flex-direction:column',
        'gap:8px','width:min(340px,calc(100vw - 28px))','pointer-events:none','font:12px/1.35 Arial,sans-serif'
      ].join(';');
      document.body.appendChild(toastHost);
    }
    const item = document.createElement('div');
    const bg = level === 'out' ? 'rgba(116,31,36,.97)' : level === 'warn' ? 'rgba(116,82,20,.97)' : 'rgba(22,78,54,.97)';
    item.style.cssText = `padding:10px 12px;border-radius:9px;background:${bg};border:1px solid rgba(255,255,255,.18);color:#fff;box-shadow:0 4px 18px rgba(0,0,0,.42);transform:translateY(4px);opacity:0;transition:.18s ease`;
    item.textContent = message;
    toastHost.appendChild(item);
    requestAnimationFrame(() => { item.style.transform = 'translateY(0)'; item.style.opacity = '1'; });
    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(4px)';
      setTimeout(() => item.remove(), 220);
    }, level === 'out' ? 9000 : 6000);
  }

  function sendBallAlert(key, title, message, level = 'warn') {
    const now = Date.now();
    const prior = ballWarnings.get(key) || 0;
    const sticky = key.startsWith('low-') || key.startsWith('switch-');
    const cooldown = level === 'out' ? 300000 : 180000;
    if ((sticky && prior) || (!sticky && now - prior < cooldown)) return;
    ballWarnings.set(key, now);
    showToast(message, level);
    try { chrome.runtime.sendMessage({ type:'BALL_ALERT', key, title, message, level }); } catch (_) {}
  }

  function resetRecoveredWarnings(snapshot) {
    const threshold = Math.max(1, Number(config.lowBallThreshold) || 20);
    for (const item of snapshot.stocks || []) {
      if (item.count != null && item.count > threshold) ballWarnings.delete(`low-${item.key}`);
      if (item.count != null && item.count > 0) ballWarnings.delete(`empty-${item.key}`);
    }
    if ((snapshot.stocks || []).some(x => x.count != null && x.count > 0)) ballWarnings.delete('all-out');
  }

  function maybeWarnBallStock(snapshot) {
    if (!config.warnLowBalls || !snapshot.detected) return;
    const threshold = Math.max(1, Number(config.lowBallThreshold) || 20);
    resetRecoveredWarnings(snapshot);
    const current = snapshot.current;
    if (current?.count != null && current.count > 0 && current.count <= threshold) {
      sendBallAlert(`low-${current.key}`, 'Pokébolas acabando', `${current.name}: só ${current.count} restante${current.count === 1 ? '' : 's'}.`, 'warn');
    }
    if (snapshot.out) {
      sendBallAlert('all-out', 'Sem Pokébolas', 'Não encontrei nenhuma Pokébola com estoque disponível na janela de captura.', 'out');
    }
  }

  function chooseReplacement(snapshot) {
    const currentKey = snapshot.current?.key;
    return (snapshot.stocks || [])
      .filter(x => x.key !== currentKey && x.count != null && x.count > 0 && isEnabled(x.target) && isVisibleFast(x.target))
      .sort((a,b) => a.priority - b.priority)[0] || null;
  }

  function canOpenBallSelector(snapshot) {
    const current = snapshot.current;
    // Mesmo que o framework use uma <div>/<img> com handler no pai, click() borbulha.
    // Só tentamos dentro da janela CAPTURA e apenas quando a bola reconhecida chegou a zero.
    return !!(current?.target && isEnabled(current.target) && isVisibleFast(current.target) && captureCache.root?.contains(current.target));
  }

  function performBallSwitch(snapshot) {
    if (!config.enabled || !config.autoSwitchBalls) return false;
    const current = snapshot.current;
    if (!current || current.count !== 0) return false;
    const now = Date.now();
    if (now - state.lastBallSwitch < 2200) return false;

    const replacement = chooseReplacement(snapshot);
    if (replacement) {
      state.lastBallSwitch = now;
      setAction(`${current.name} acabou → ${replacement.name}`);
      sendBallAlert(`switch-${current.key}-${replacement.key}`, 'Trocando Pokébola', `${current.name} acabou. Mudando automaticamente para ${replacement.name}.`, 'info');
      dispatchClick(replacement.target);
      return true;
    }

    // Algumas interfaces só mostram as alternativas depois de clicar no seletor atual.
    if (canOpenBallSelector(snapshot) && now - ballMenuOpenAttemptAt > 3500) {
      ballMenuOpenAttemptAt = now;
      dispatchClick(current.target);
      setTimeout(() => {
        const opened = scanBallInventory();
        state.ballSnapshot = opened;
        const next = chooseReplacement(opened);
        if (next && config.enabled && config.autoSwitchBalls) {
          state.lastBallSwitch = Date.now();
          setAction(`${current.name} acabou → ${next.name}`);
          dispatchClick(next.target);
          sendBallAlert(`switch-${current.key}-${next.key}`, 'Trocando Pokébola', `${current.name} acabou. Mudando automaticamente para ${next.name}.`, 'info');
        } else if (opened.current?.count === 0) {
          sendBallAlert('all-out', 'Sem Pokébolas', 'A Pokébola selecionada acabou e nenhuma alternativa com estoque foi detectada.', 'out');
        }
        updateHUDState();
      }, 260);
      return true;
    }
    return false;
  }

  function ballManagerTick() {
    if (!config.enabled || (!config.autoSwitchBalls && !config.warnLowBalls)) return;
    if (!captureCache.root?.isConnected) return;
    const snapshot = scanBallInventory();
    state.ballSnapshot = snapshot;
    maybeWarnBallStock(snapshot);
    performBallSwitch(snapshot);
    updateHUDState();
  }

  // ---------------- Utilidades lentas: reconectar/pop-ups ----------------
  const reconnectLabels = new Set([
    'reconectar', 'reconectar-se', 'tentar novamente', 'tente novamente',
    'reconectar agora', 'conectar novamente', 'voltar ao jogo', 'retry', 'reconnect'
  ].map(norm));

  const disconnectMessages = [
    'desconectado', 'voce foi desconectado', 'conexao perdida',
    'conexao encerrada', 'falha na conexao', 'servidor desconectado',
    'connection lost', 'disconnected', 'server disconnected', 'network error'
  ].map(norm);

  function autoReconnect(btn) {
    if (!config.enabled || !config.autoReconnect || !btn) return false;
    const now = Date.now();
    if (now - state.lastReconnect < 4000) return false;

    state.lastReconnect = now;
    state.sessionReconnects++;
    setAction(`Reconectando #${state.sessionReconnects}`);
    dispatchClick(btn);
    bumpStats('reconnects');
    return true;
  }

  function looksLikeModal(el) {
    if (!el) return false;
    const role = norm(el.getAttribute?.('role'));
    if (role === 'dialog' || role === 'alertdialog') return true;
    const cls = norm(el.className?.toString());
    return cls.includes('modal') || cls.includes('popup') || cls.includes('dialog') || cls.includes('overlay');
  }

  function modalParent(el) {
    let cur = el;
    for (let i = 0; cur && i < 9; i++, cur = cur.parentElement) {
      if (looksLikeModal(cur)) return cur;
    }
    return null;
  }

  function insideCapture(el) {
    const root = captureCache.root;
    return !!(root?.isConnected && root.contains(el));
  }

  function utilityScan() {
    if (!config.enabled || (!config.autoReconnect && !config.closePopups)) return;

    let elements;
    try { elements = document.querySelectorAll(interactiveSelector); }
    catch (_) { return; }

    let reconnect = null;
    let safePopup = null;

    for (const el of elements) {
      if (!isEnabled(el)) continue;
      const label = norm(fastText(el));
      if (!label) continue;

      if (!reconnect && config.autoReconnect && reconnectLabels.has(label) && isVisibleFast(el)) {
        reconnect = el;
      }

      if (!safePopup && config.closePopups) {
        const aria = norm(el.getAttribute?.('aria-label'));
        const title = norm(el.getAttribute?.('title'));
        const safeClose = label === 'fechar' || label === 'close' || label === '×' || label === 'x' ||
                          aria === 'fechar' || aria === 'close' || title === 'fechar' || title === 'close';
        if (safeClose && isVisibleFast(el) && !insideCapture(el)) {
          const modal = modalParent(el);
          if (modal) {
            const modalRaw = fastText(modal);
            if (modalRaw.length > 1200 || !disconnectMessages.some(x => norm(modalRaw).includes(x))) {
              safePopup = el;
            }
          }
        }
      }

      if (reconnect && safePopup) break;
    }

    if (reconnect) autoReconnect(reconnect);
    if (safePopup) {
      state.sessionPopups++;
      setAction(`Pop-up fechado #${state.sessionPopups}`);
      dispatchClick(safePopup);
      bumpStats('popups');
    }
  }

  // ---------------- Capturas confirmadas ----------------
  const captureNodeText = new WeakMap();
  const recentCaptureMessages = new Map();
  const captureKeyword = /captur|caught|captured/i;

  function isChatNode(el) {
    return !!el?.closest?.('[class*="chat" i],[id*="chat" i],[data-testid*="chat" i]');
  }

  function isOwnUi(el) {
    return !!el?.closest?.('#piw-auto-helper-hud,#piw-auto-helper-quick-toggle');
  }

  function inspectCaptureElement(el) {
    if (!el || !el.isConnected || isOwnUi(el) || isChatNode(el)) return;
    const raw = fastText(el);
    if (raw.length < 9 || raw.length > 260 || !captureKeyword.test(norm(raw))) return;
    if (captureNodeText.get(el) === raw) return;
    captureNodeText.set(el, raw);

    const capture = globalThis.PokeIdleCaptureParser?.parseCapture(raw);
    if (!capture) return;

    const key = `${capture.name.toLocaleLowerCase('pt-BR')}/${capture.shiny}`;
    const now = Date.now();
    if (now - (recentCaptureMessages.get(key) || 0) < 2800) return;
    recentCaptureMessages.set(key, now);
    for (const [k, stamp] of recentCaptureMessages) {
      if (now - stamp > 15000) recentCaptureMessages.delete(k);
    }

    chrome.runtime.sendMessage({
      type:'CAPTURE_CONFIRMED',
      name:capture.name,
      shiny:capture.shiny
    }, response => {
      if (chrome.runtime.lastError || !response?.ok || response?.duplicate) return;
      state.confirmedCaptures++;
      state.lastCapturedPokemon = `${capture.name}${capture.shiny ? ' ✨' : ''}`;
      setAction(`Capturado: ${state.lastCapturedPokemon}`);
      updateHUDState();
    });
  }

  function tryCaptureCacheFromAddedNode(node) {
    if (captureCache.root?.isConnected || !node?.isConnected) return;
    if ((node.childElementCount || 0) > 80) return;
    discoverCaptureRoot(node);
  }

  function queueMutationNodes(records) {
    for (const record of records) {
      for (const item of record.addedNodes || []) {
        const node = item.nodeType === Node.TEXT_NODE ? item.parentElement : item;
        if (!node || node.nodeType !== Node.ELEMENT_NODE || isOwnUi(node) || isChatNode(node)) continue;

        if (!captureCache.root?.isConnected) tryCaptureCacheFromAddedNode(node);
        if (pendingMutationNodes.length >= PERF.maxMutationNodesPerBatch) continue;

        const childCount = node.childElementCount || 0;
        if (childCount > PERF.maxSmallSubtreeChildren) continue;
        const raw = fastText(node);
        if (!raw || raw.length > 800) continue;
        if (captureKeyword.test(norm(raw))) pendingMutationNodes.push(node);
      }
    }

    if (!pendingMutationNodes.length || mutationTimer) return;
    mutationTimer = setTimeout(flushCaptureNodes, PERF.mutationDebounceMs);
  }

  function flushCaptureNodes() {
    mutationTimer = null;
    const batch = pendingMutationNodes.splice(0, PERF.maxMutationNodesPerBatch);
    for (const node of batch) inspectCaptureElement(node);
    if (pendingMutationNodes.length) mutationTimer = setTimeout(flushCaptureNodes, PERF.mutationDebounceMs);
  }

  // ---------------- Watchdog ----------------
  function textHasDisconnect(raw) {
    const n = norm(raw);
    return disconnectMessages.some(msg => n.includes(msg));
  }

  function detectDisconnectLight() {
    const candidates = document.querySelectorAll('[role="dialog"],[role="alert"],[aria-live="assertive"]');
    let checked = 0;
    for (const el of candidates) {
      if (++checked > 25) break;
      const raw = fastText(el);
      if (raw.length && raw.length <= 1500 && textHasDisconnect(raw)) return true;
    }

    const now = Date.now();
    if (now - lastBodyDisconnectProbe >= PERF.bodyDisconnectProbeMs) {
      lastBodyDisconnectProbe = now;
      const raw = document.body?.textContent || '';
      cachedDisconnect = raw.length <= 350000 ? textHasDisconnect(raw) : false;
    }
    return cachedDisconnect;
  }

  function watchdog() {
    if (!config.enabled) {
      state.disconnectedAt = 0;
      cachedDisconnect = false;
      updateHUDState();
      return;
    }

    const disconnected = detectDisconnectLight();
    if (!disconnected) {
      state.disconnectedAt = 0;
      cachedDisconnect = false;
      updateHUDState();
      return;
    }

    if (!state.disconnectedAt) {
      state.disconnectedAt = Date.now();
      setAction('Desconexão detectada');
    }

    utilityScan();
    if (!config.autoReload) return;

    const threshold = Math.max(8000, Number(config.reloadAfterDisconnectMs) || 12000);
    if (Date.now() - state.disconnectedAt < threshold) return;

    const lastReload = Number(sessionStorage.getItem('piwAutoHelperLastReload') || 0);
    if (Date.now() - lastReload < 30000) return;

    sessionStorage.setItem('piwAutoHelperLastReload', String(Date.now()));
    setAction('Recarregando após desconexão');
    location.reload();
  }

  // ---------------- Liga/desliga rápido ----------------
  async function setMasterEnabled(next, source = 'controle rápido') {
    const enabled = !!next;
    config.enabled = enabled;
    if (!enabled) {
      state.catchBusy = false;
      state.disconnectedAt = 0;
    }
    setAction(enabled ? `Auto Helper ativado (${source})` : `Auto Helper pausado (${source})`);
    updateQuickToggle();
    updateHUDState(true);
    try { await chrome.storage.sync.set({ enabled }); } catch (_) {}
    if (enabled) {
      discoveryTick();
      cachedCatchTick();
    }
  }

  function createQuickToggle() {
    if (!document.body || quickToggle) return;
    quickToggle = document.createElement('button');
    quickToggle.id = 'piw-auto-helper-quick-toggle';
    quickToggle.type = 'button';
    quickToggle.title = 'Ativar/pausar Auto Helper · Atalho: Alt+Shift+P';
    quickToggle.style.cssText = [
      'position:fixed','top:105px','right:12px','z-index:2147483647',
      'height:28px','min-width:88px','padding:0 10px','border-radius:999px',
      'border:1px solid rgba(255,255,255,.18)','color:#fff','font:700 10px Arial,sans-serif',
      'box-shadow:0 3px 10px rgba(0,0,0,.35)','cursor:pointer','user-select:none',
      'contain:layout style paint'
    ].join(';');
    quickToggle.addEventListener('click', () => setMasterEnabled(!config.enabled, 'botão no jogo'));
    document.body.appendChild(quickToggle);
    updateQuickToggle();
  }

  function updateQuickToggle() {
    if (!quickToggle) return;
    quickToggle.style.display = config.showQuickToggle ? 'block' : 'none';
    quickToggle.textContent = config.enabled ? '● AUTO ON' : 'Ⅱ AUTO OFF';
    quickToggle.style.background = config.enabled ? 'rgba(24,126,73,.94)' : 'rgba(111,45,48,.94)';
    quickToggle.style.borderColor = config.enabled ? 'rgba(109,238,160,.45)' : 'rgba(255,123,123,.4)';
  }

  // ---------------- HUD arrastável ----------------
  function clampHudPosition(pos) {
    if (!hud || !pos) return null;
    const rect = hud.getBoundingClientRect();
    const maxX = Math.max(0, window.innerWidth - Math.max(120, rect.width));
    const maxY = Math.max(0, window.innerHeight - Math.max(60, rect.height));
    return {
      x: Math.max(0, Math.min(maxX, Number(pos.x) || 0)),
      y: Math.max(0, Math.min(maxY, Number(pos.y) || 0))
    };
  }

  function applyHudPosition(pos) {
    if (!hud) return;
    if (!pos) {
      hud.style.left = 'auto';
      hud.style.right = '12px';
      hud.style.top = '140px';
      return;
    }
    const safe = clampHudPosition(pos);
    if (!safe) return;
    hud.style.right = 'auto';
    hud.style.left = `${safe.x}px`;
    hud.style.top = `${safe.y}px`;
    hudPosition = safe;
  }

  function saveHudPosition() {
    if (!hud) return;
    const rect = hud.getBoundingClientRect();
    hudPosition = clampHudPosition({ x:rect.left, y:rect.top });
    try { chrome.storage.local.set({ hudPosition }); } catch (_) {}
  }

  function resetHudPosition() {
    hudPosition = null;
    applyHudPosition(null);
    try { chrome.storage.local.remove('hudPosition'); } catch (_) {}
    showToast('Posição do Auto Helper restaurada.', 'info');
  }

  function setupHudDrag(handle) {
    if (!hud || !handle) return;
    handle.style.cursor = 'move';
    handle.style.touchAction = 'none';
    handle.title = 'Arraste para mover · duplo clique para restaurar a posição';
    handle.addEventListener('dblclick', event => {
      event.preventDefault();
      resetHudPosition();
    });
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startRect = hud.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      hud.style.right = 'auto';
      handle.setPointerCapture?.(event.pointerId);

      const move = e => {
        const pos = clampHudPosition({
          x:startRect.left + (e.clientX - startX),
          y:startRect.top + (e.clientY - startY)
        });
        if (!pos) return;
        hud.style.left = `${pos.x}px`;
        hud.style.top = `${pos.y}px`;
      };
      const up = e => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        try { handle.releasePointerCapture?.(e.pointerId); } catch (_) {}
        saveHudPosition();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  // ---------------- HUD incremental ----------------
  function addHudLine(label, key) {
    const line = document.createElement('div');
    line.append(document.createTextNode(label));
    const value = document.createElement('b');
    line.append(value);
    hud.append(line);
    hudRefs[key] = value;
  }

  function createHUD() {
    if (!document.body || hud) return;
    hud = document.createElement('div');
    hud.id = 'piw-auto-helper-hud';
    hud.style.cssText = [
      'position:fixed','top:140px','right:12px','z-index:2147483646',
      'min-width:190px','padding:9px 11px','background:rgba(15,20,29,.94)',
      'border:1px solid #465166','border-radius:9px','color:#eee',
      'font:11px/1.45 Arial,sans-serif','box-shadow:0 3px 12px rgba(0,0,0,.45)',
      'pointer-events:none','user-select:none','contain:layout style paint'
    ].join(';');

    const title = document.createElement('div');
    hudTitle = title;
    title.textContent = '↕ ⚙ AUTO HELPER v1.4';
    title.style.cssText = 'font-weight:700;color:#ffca42;margin:-3px -5px 5px;padding:3px 5px;border-radius:5px;cursor:move;pointer-events:auto;background:rgba(255,255,255,.035)';
    hud.append(title);
    setupHudDrag(title);
    addHudLine('Status: ', 'status');
    addHudLine('Pokébolas lançadas: ', 'balls');
    addHudLine('Pokébola atual: ', 'currentBall');
    addHudLine('Estoque atual: ', 'ballStock');
    addHudLine('Pokémon capturados (total): ', 'captures');
    addHudLine('Última captura: ', 'lastCapture');
    addHudLine('Reconexões: ', 'reconnects');
    addHudLine('Pop-ups: ', 'popups');
    addHudLine('CAPTURA cache: ', 'cache');
    addHudLine('Rodando: ', 'uptime');
    addHudLine('Último: ', 'lastAction');

    document.body.appendChild(hud);
    chrome.storage.local.get({ hudPosition:null }).then(({ hudPosition:pos }) => { hudPosition = pos; applyHudPosition(pos); }).catch(() => {});
    updateHUDState(true);
  }

  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function setHudText(key, value) {
    const el = hudRefs[key];
    const next = String(value);
    if (el && el.textContent !== next) el.textContent = next;
  }

  function updateHUDState(force = false) {
    updateQuickToggle();
    if (!config.showHUD) {
      if (hud) hud.style.display = 'none';
      return;
    }
    createHUD();
    if (!hud) return;
    if (hud.style.display !== 'block') hud.style.display = 'block';

    const active = config.enabled;
    const status = !active ? 'PAUSADO' : state.disconnectedAt ? 'RECONECTANDO' : 'ATIVO';
    const statusColor = !active ? '#c9c9c9' : state.disconnectedAt ? '#ff6b6b' : '#6ee792';
    setHudText('status', status);
    if (hudRefs.status && (force || hudRefs.status.style.color !== statusColor)) hudRefs.status.style.color = statusColor;
    setHudText('balls', state.sessionCatches);
    const ball = state.ballSnapshot?.current;
    const threshold = Math.max(1, Number(config.lowBallThreshold) || 20);
    setHudText('currentBall', ball?.name || '—');
    setHudText('ballStock', ball?.count != null ? ball.count : '—');
    if (hudRefs.ballStock) {
      const c = ball?.count;
      const color = c === 0 ? '#ff7770' : (c != null && c <= threshold ? '#ffd06a' : '#eeeeee');
      if (force || hudRefs.ballStock.style.color !== color) hudRefs.ballStock.style.color = color;
    }
    setHudText('captures', state.allCaptures);
    setHudText('lastCapture', state.lastCapturedPokemon || '—');
    setHudText('reconnects', state.sessionReconnects);
    setHudText('popups', state.sessionPopups);
    setHudText('cache', captureCache.root?.isConnected ? 'OK' : 'procurando');
    setHudText('lastAction', state.lastAction);
  }

  function updateHUDClock() {
    if (!config.showHUD || !hud) return;
    setHudText('uptime', formatTime(Date.now() - state.startedAt));
  }

  async function loadConfig() {
    try {
      config = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
    } catch (_) {
      config = { ...DEFAULTS };
    }
    updateQuickToggle();
    updateHUDState(true);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.captureData) {
      const fresh = changes.captureData.newValue || {};
      state.allCaptures = Number(fresh.total) || 0;
      const last = fresh.history?.[0];
      state.lastCapturedPokemon = last ? `${last.name}${last.shiny ? ' ✨' : ''}` : '';
      updateHUDState();
      return;
    }
    if (area !== 'sync') return;
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULTS) config[key] = change.newValue;
    }
    if (!config.enabled) state.catchBusy = false;
    updateQuickToggle();
    updateHUDState(true);
    if (config.enabled) { discoveryTick(); ballManagerTick(); }
  });

  function publicBallSnapshot(snapshot = state.ballSnapshot) {
    if (!snapshot) return { detected:false, current:null, stocks:[], out:false, threshold:Math.max(1, Number(config.lowBallThreshold) || 20) };
    const clean = item => item ? {
      key:item.key,
      name:item.name,
      count:item.count == null ? null : Number(item.count),
      current:!!item.current
    } : null;
    return {
      detected:!!snapshot.detected,
      current:clean(snapshot.current),
      stocks:(snapshot.stocks || []).map(clean),
      out:!!snapshot.out,
      threshold:Math.max(1, Number(config.lowBallThreshold) || 20),
      autoSwitch:!!config.autoSwitchBalls,
      warnLow:!!config.warnLowBalls
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'GET_PAGE_STATUS') {
      if (!captureCache.root?.isConnected && config.enabled) discoverCaptureRoot(document);
      const ready = captureButtonsFromCache().some(el => isEnabled(el) && isVisibleFast(el));
      sendResponse({
        ok:true,
        url:location.href,
        enabled:config.enabled,
        catchReady:ready,
        disconnected:!!state.disconnectedAt,
        performanceMode:'cached-capture-root',
        captureCache:!!captureCache.root?.isConnected,
        ballManager:publicBallSnapshot(),
        session:{
          catches:state.sessionCatches,
          confirmedCaptures:state.confirmedCaptures,
          lastCapturedPokemon:state.lastCapturedPokemon,
          reconnects:state.sessionReconnects,
          popups:state.sessionPopups,
          lastAction:state.lastAction,
          uptimeMs:Date.now() - state.startedAt
        }
      });
      return;
    }

    if (message?.type === 'SCAN_NOW') {
      invalidateCaptureCache();
      discoverCaptureRoot(document);
      cachedCatchTick();
      ballManagerTick();
      utilityScan();
      watchdog();
      sendResponse({ ok:true, captureCache:!!captureCache.root?.isConnected });
      return;
    }

    if (message?.type === 'SET_MASTER_ENABLED') {
      setMasterEnabled(!!message.enabled, 'painel').then(() => sendResponse({ ok:true, enabled:config.enabled }));
      return true;
    }
  });

  function start() {
    chrome.storage.local.get({ captureData:{ total:0, history:[] } }).then(({ captureData }) => {
      state.allCaptures = Number(captureData?.total) || 0;
      const last = captureData?.history?.[0];
      state.lastCapturedPokemon = last ? `${last.name}${last.shiny ? ' ✨' : ''}` : '';
      updateHUDState();
    }).catch(() => {});

    loadConfig().then(() => {
      createQuickToggle();
      createHUD();
      discoverCaptureRoot(document);
      cachedCatchTick();
      ballManagerTick();
      utilityScan();
      updateHUDState(true);
    });

    observer = new MutationObserver(queueMutationNodes);
    observer.observe(document.documentElement, {
      childList:true,
      subtree:true
    });

    catchTimer = setInterval(cachedCatchTick, PERF.cachedCatchPollMs);
    ballTimer = setInterval(ballManagerTick, PERF.ballManagerMs);
    discoveryTimer = setInterval(discoveryTick, PERF.discoveryScanMs);
    utilityTimer = setInterval(utilityScan, PERF.utilityScanMs);
    watchdogTimer = setInterval(watchdog, PERF.watchdogMs);
    hudTimer = setInterval(updateHUDClock, PERF.hudClockMs);
    window.addEventListener('resize', () => { if (hudPosition) applyHudPosition(hudPosition); }, { passive:true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once:true });
  } else {
    start();
  }
})();
