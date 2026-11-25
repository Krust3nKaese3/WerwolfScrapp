(function () {
  var W = window.Werwolf;
  var LOBBY_KEY = 'werwolf.lobby.v1';
  var GAME_KEY = 'werwolf.game.v1';
  var SCORE_KEY = 'werwolf.scores.v1';
  var SETUP_KEY = 'werwolf.setup.v1';
  var PLAYERS_KEY = 'werwolf.players.v1';
  var HISTORY_KEY = 'werwolf.history.v1';
  var STORAGE_TIMEOUT_MS = 4000;
  var P = window.WerwolfPlayers;
  var S = window.WerwolfStats;
  var app = document.getElementById('app');
  var state = W.newLobby();
  var scores = {};
  var roster = { v: 1, players: [] };
  var history = S.emptyHistory();
  var draft = { query: '', last: '' };
  var statsMode = null;
  var statsRole = '';
  var statsSort = 'wins';
  var statsDir = 'desc';
  var explainPool = false;
  var explainSeer = false;
  var explainWolf = false;
  var explainAmor = false;
  var explainTell = false;
  var explainLegacy = false;
  var explainCall = false;
  var confirmWolfId = 0;
  var uiJoin = false;
  var mpError = '';
  var confirmReset = false;
  var saveReady = false;
  var booting = true;
  var renderQueued = false;

  var HOME = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" d="M4 10.5 12 4l8 6.5V20h-5.2v-6.2H9.2V20H4z"/></svg>';
  var HOUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M4 11 12 4l8 7v9H4z"/><path fill="none" stroke="currentColor" stroke-width="2" d="M10 20v-6h4v6"/></svg>';
  var PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6.5 19c1.1-2.8 3-4.2 5.5-4.2S16.4 16.2 17.5 19"/></svg>';
  var LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  var MOON = '<svg class="phase-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M21 14.5A8.5 8.5 0 1 1 9.5 3a7 7 0 0 0 11.5 11.5z"/></svg>';
  var SUN = '<svg class="phase-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19"/></svg>';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function bridgeStorage() {
    // OpenScr stellt OpenScrBridge. Ältere Builds haben nur EveryAppBridge.
    var bridge = window.OpenScrBridge || window.EveryAppBridge;
    var api = bridge && bridge.storage;
    if (!api || typeof api.get !== 'function' || typeof api.set !== 'function' || typeof api.remove !== 'function') return null;
    return api;
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('timeout')); }, ms);
      Promise.resolve(promise).then(function (value) {
        clearTimeout(timer);
        resolve(value);
      }, function (error) {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function parseSaved(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch (error) { return null; }
    }
    return typeof raw === 'object' ? raw : null;
  }

  async function readKey(key) {
    var storage = bridgeStorage();
    if (storage) {
      try {
        var value = await withTimeout(storage.get(key), STORAGE_TIMEOUT_MS);
        if (value != null && value !== '') return parseSaved(value);
      } catch (error) { /* Bridge fehlt oder verweigert. */ }
    }
    try { return parseSaved(localStorage.getItem(key)); } catch (error) { return null; }
  }

  async function writeKey(key, value) {
    var raw = value == null ? null : JSON.stringify(value);
    var storage = bridgeStorage();
    if (storage) {
      try {
        if (raw == null) await withTimeout(storage.remove(key), STORAGE_TIMEOUT_MS);
        else await withTimeout(storage.set(key, raw), STORAGE_TIMEOUT_MS);
      } catch (error) { /* bleibt im localStorage, falls vorhanden */ }
    }
    try {
      if (raw == null) localStorage.removeItem(key);
      else localStorage.setItem(key, raw);
    } catch (error) { /* voll oder gesperrt */ }
  }

  function lobbySnapshot() {
    return {
      v: 1,
      screen: 'lobby',
      players: (state.players || []).map(function (p) {
        var seat = { id: p.id, name: p.name };
        if (p.pid) seat.pid = p.pid;
        if (p.first) seat.first = p.first;
        if (p.last) seat.last = p.last;
        return seat;
      }),
      nextId: state.nextId || 1,
      log: state.log || []
    };
  }

  var savedSetup = null;
  var saveQueue = Promise.resolve();

  function setupActions(type) {
    return type === 'set-count' || type === 'set-nach' || type === 'set-osiris' || type === 'set-heals' || type === 'set-wolf-min' ||
      type === 'set-wolf-max' || type === 'toggle-seer' || type === 'toggle-wolf-action' || type === 'toggle-quick-amor' ||
      type === 'toggle-self-tell' || type === 'toggle-legacy-witch' || type === 'toggle-wolf-call' || type === 'toggle-pool' || type === 'suggest' ||
      type === 'undo-deal' || type === 'to-setup';
  }

  function rememberSetup() {
    if (!state) return;
    if (!savedSetup || typeof savedSetup !== 'object') savedSetup = { v: 1 };
    if (state.counts) savedSetup.counts = JSON.parse(JSON.stringify(state.counts));
    if (state.nachUses != null) savedSetup.nachUses = state.nachUses;
    if (state.osirisUses != null) savedSetup.osirisUses = state.osirisUses;
    if (state.healPotions != null) savedSetup.healPotions = state.healPotions;
    if (state.rolePool != null) savedSetup.rolePool = !!state.rolePool;
    if (state.seerExact != null) savedSetup.seerExact = !!state.seerExact;
    savedSetup.showWolfAction = !!state.showWolfAction;
    savedSetup.quickAmor = state.quickAmor !== false;
    if (state.wolfMin != null) savedSetup.wolfMin = state.wolfMin;
    if (state.wolfMax != null) savedSetup.wolfMax = state.wolfMax;
    savedSetup.selfTell = !!state.selfTell;
    savedSetup.legacyWitch = state.legacyWitch !== false;
    savedSetup.wolfCall = !!state.wolfCall;
  }

  function applySavedSetup() {
    if (!savedSetup || !state) return;
    if (savedSetup.counts) state.counts = JSON.parse(JSON.stringify(savedSetup.counts));
    if (savedSetup.nachUses != null) state.nachUses = savedSetup.nachUses;
    if (savedSetup.osirisUses != null) state.osirisUses = savedSetup.osirisUses;
    if (savedSetup.healPotions != null) state.healPotions = savedSetup.healPotions;
    if ('rolePool' in savedSetup) state.rolePool = !!savedSetup.rolePool;
    if ('seerExact' in savedSetup) state.seerExact = !!savedSetup.seerExact;
    state.showWolfAction = savedSetup.showWolfAction === true;
    if ('quickAmor' in savedSetup) state.quickAmor = savedSetup.quickAmor !== false;
    if (savedSetup.wolfMin != null) state.wolfMin = savedSetup.wolfMin;
    if (savedSetup.wolfMax != null) state.wolfMax = savedSetup.wolfMax;
    if ('selfTell' in savedSetup) state.selfTell = !!savedSetup.selfTell;
    if ('legacyWitch' in savedSetup) state.legacyWitch = savedSetup.legacyWitch !== false;
    if ('wolfCall' in savedSetup) state.wolfCall = !!savedSetup.wolfCall;
    state.error = '';
  }

  function ensureSetup() {
    if (!state || state.remote) return;
    if (state.screen !== 'lobby' && state.screen !== 'setup') return;
    if (!state.counts) applySavedSetup();
    if (!state.counts) {
      state.counts = W.defaultCounts((state.players || []).length || 4);
      if (state.nachUses == null) state.nachUses = 1;
      if (state.healPotions == null) state.healPotions = 2;
      if (state.wolfMin == null) state.wolfMin = state.counts.werwolf || 1;
      if (state.wolfMax == null) state.wolfMax = state.wolfMin;
      if (state.rolePool == null) state.rolePool = true;
      rememberSetup();
    }
  }

  function bridgePlayers() {
    var api = window.OpenScrBridge && window.OpenScrBridge.players;
    return api && typeof api.list === 'function' ? api : null;
  }

  function asRiot(player) {
    var name = String((player && (player.name || player.first)) || '').trim();
    var tag = String((player && player.tag) || '').trim();
    return { id: String(player && player.id || ''), name: name, tag: tag, first: name, last: tag, created: 0 };
  }

  function riotLabel(player) {
    if (!player || !player.tag) return '';
    if (player.tag && player.first) return player.first + ' #' + player.tag;
    return '';
  }

  window.WerwolfLibrary = function () {
    return { roster: roster, scores: scores, history: history };
  };

  function isGuest() {
    return !!((window.WerwolfNet && window.WerwolfNet.browserGuest && window.WerwolfNet.browserGuest()) ||
      (window.WerwolfNet && window.WerwolfNet.role && window.WerwolfNet.role() === 'guest'));
  }

  function ensureGrid() {
    if (window.WerwolfNet) window.WerwolfNet.stampGrid(state);
  }

  function ui() {
    var overlay = window.WerwolfNet && window.WerwolfNet.display && window.WerwolfNet.display();
    return overlay || state;
  }

  function persist() {
    if (!saveReady || isGuest()) return;
    var lobby = lobbySnapshot();
    var game = state.screen === 'lobby' ? null : JSON.parse(JSON.stringify(state));
    var points = scores;
    var setup = savedSetup ? JSON.parse(JSON.stringify(savedSetup)) : null;
    saveQueue = saveQueue.then(function () {
      return writeKey(LOBBY_KEY, lobby).then(function () {
        return writeKey(GAME_KEY, game);
      }).then(function () {
        return writeKey(SCORE_KEY, points);
      }).then(function () {
        return writeKey(SETUP_KEY, setup);
      }).then(function () {
        if (bridgePlayers()) return null;
        return writeKey(PLAYERS_KEY, roster);
      }).then(function () {
        return writeKey(HISTORY_KEY, history);
      });
    }).then(function () {}, function () {});
  }

  function applyScores() {
    if (!state || state.screen !== 'end') return;
    var result = W.awardOnce(scores, state);
    scores = result.scores;
    recordHistory();
  }

  function recordHistory() {
    if (!state || state.screen !== 'end' || state.historySaved || !Array.isArray(state.book)) return;
    history = S.appendGame(history, S.buildRecord(state, Date.now()));
    state.historySaved = true;
  }

  function loadRoster(raw) {
    var players = raw && Array.isArray(raw.players) ? raw.players : [];
    return {
      v: 1,
      players: players.filter(function (player) {
        return player && player.id && String(player.first || '').trim() && String(player.last || '').trim();
      }).map(function (player) {
        return {
          id: String(player.id),
          first: String(player.first).trim(),
          last: String(player.last).trim(),
          tag: String(player.tag || '').trim(),
          created: Number(player.created) || 0
        };
      })
    };
  }

  function loadHistory(raw) {
    if (!raw || typeof raw !== 'object') return S.emptyHistory();
    return {
      v: 1,
      games: Array.isArray(raw.games) ? raw.games : [],
      sum: raw.sum && typeof raw.sum === 'object' ? raw.sum : {}
    };
  }

  function refreshNames() {
    (state.players || []).forEach(function (player) {
      if (player.tag && player.first) player.name = player.first + ' #' + player.tag;
    });
    var rows = [];
    (state.players || []).forEach(function (player) {
      if (player.tag) return;
      if (player.pid && player.first) rows.push({ id: player.pid, first: player.first, last: player.last || '' });
    });
    var labels = P.displayNames(rows);
    (state.players || []).forEach(function (player) {
      if (player.tag) return;
      if (player.pid && labels[player.pid]) player.name = labels[player.pid];
    });
  }

  function attachIdentities(rename) {
    (state.players || []).forEach(function (seat) {
      if (seat.pid) {
        var known = null;
        for (var i = 0; i < roster.players.length; i++) {
          if (roster.players[i].id === seat.pid) known = roster.players[i];
        }
        if (known) {
          if (!seat.first) seat.first = known.first;
          if (!seat.last) seat.last = known.last;
          if (known.tag) seat.tag = known.tag;
        }
        return;
      }
      var player = P.migrateName(roster, seat.name, Date.now(), Math.random);
      if (!player) return;
      seat.pid = player.id;
      seat.first = player.first;
      seat.last = player.last;
    });
    if (rename) refreshNames();
  }

  var shell = 'index';
  var qrPanel = '';
  var qrImage = '';
  var qrNote = '';
  var qrShare = '';
  var hostLink = 'wlan';
  var hotSsid = '';
  var hotPass = '';
  var SCRAP_URL = 'https://github.com/Krust3nKaese3/WerwolfScrapp';
  var rendering = false;
  var quietTimer = null;

  function act(action) {
    if (rendering) return;
    if (action.type === 'reset-ask') { confirmReset = true; render(); return; }
    if (action.type === 'reset-cancel') { confirmReset = false; render(); return; }
    if (action.type === 'reset-scores') {
      if (isGuest()) return;
      scores = {};
      if (state) state.scoredNames = [];
      confirmReset = false;
      persist();
      render();
      return;
    }
    confirmReset = false;
    if ((isGuest() || (state && state.remote)) && action.type === 'remove-name') return;
    if (window.WerwolfNet && window.WerwolfNet.online && window.WerwolfNet.online()) {
      rendering = true;
      try { window.WerwolfNet.local(action); }
      finally { rendering = false; }
      if (action.type === 'home' || action.type === 'abort') applySavedSetup();
      if (setupActions(action.type) || action.type === 'deal' || action.type === 'undo-deal') rememberSetup();
      persist();
      return;
    }
    rendering = true;
    try {
      W.send(state, action);
      ensureGrid();
      if (action.type === 'home' || action.type === 'abort') applySavedSetup();
      if (setupActions(action.type) || action.type === 'deal' || action.type === 'undo-deal') rememberSetup();
      applyScores();
      persist();
      render();
    } finally {
      rendering = false;
    }
  }

  var ROLE_ICON = {
    werwolf: '🐺',
    dorfbewohner: '🧑‍🌾',
    hexe: '🧙‍♀️',
    seherin: '🔮',
    amor: '💘',
    jaeger: '🏹',
    waschbaer: '🦝',
    nachahmerin: '🎭',
    nutte: '💋',
    russe: '🎲',
    politiker: '🎤',
    schaufel: '🪏',
    osiris: '⚱️'
  };

  function roleIcon(role) {
    return ROLE_ICON[role] || '❓';
  }

  function hero(glyph, label) {
    return '<p class="hero" role="img" aria-label="' + esc(label) + '">' + glyph + '</p>';
  }

  function flask(kind) {
    var heal = kind !== 'poison';
    var fill = heal ? '#d23b3b' : '#2f9e4f';
    var label = heal ? 'Heiltrank' : 'Gifttrank';
    return '<svg class="flask" viewBox="0 0 64 80" role="img" aria-label="' + label + '">' +
      '<title>' + label + '</title>' +
      '<rect x="26" y="2" width="12" height="10" rx="2" fill="#f4efe4"/>' +
      '<path fill="' + fill + '" d="M28 12h8l8 12c7 9 10 16 10 24a16 16 0 0 1-16 16H26A16 16 0 0 1 10 48c0-8 3-15 10-24l8-12z"/>' +
      '<path fill="#ffffff" opacity="0.35" d="M22 46c2-8 6-12 10-12 2 6 2 14 0 22-6 1-12-2-10-10z"/>' +
      '</svg>';
  }

  function icon(kind) {
    var house = kind === 'house';
    return '<span class="mark" role="img" aria-label="' + (house ? 'Haus' : 'Person') + '">' + (house ? '🏠' : '👤') + '</span>';
  }

  function header(eyebrow, title, home) {
    return '<header><div>' + (eyebrow ? '<p class="eyebrow">' + esc(eyebrow) + '</p>' : '') + '<h1>' + esc(title) + '</h1></div>' +
      (home ? '<button type="button" class="icon-btn" data-act="home" aria-label="Home">' + HOME + '</button>' : '') +
      '</header>';
  }

  function phaseHead(icon, title, subtitle) {
    return '<header class="phase"><div><h1>' + (icon || '') + esc(title) + '</h1>' +
      (subtitle ? '<p class="subhead">' + esc(subtitle) + '</p>' : '') + '</div></header>';
  }

  function errorHtml() {
    return state.error ? '<div class="banner error">' + esc(state.error) + '</div>' : '';
  }

  function player(id) {
    return W.playerById(state, id);
  }

  function selected(id) {
    return (state.selection || []).indexOf(Number(id)) >= 0;
  }

  function choiceButton(id, label, meta, targetKind, extra) {
    var order = (state.selection || []).indexOf(Number(id));
    var symbol = meta && !/[A-Za-zÄÖÜäöüß0-9]/.test(meta);
    var place = order >= 0 && (state.selection || []).length > 1 ? 'Platz ' + (order + 1) : '';
    var note = [symbol ? '' : meta, place].filter(Boolean).join(' · ');
    return '<button type="button" class="choice' + (meta === 'tot' ? ' dead' : '') + (selected(id) ? ' selected' : '') + '" data-act="select" data-id="' + id + '">' +
      (Number(id) > 0 ? crownMarks(label) : '') +
      icon(targetKind) + '<span><span class="who">' + mayorMark(id) + (extra || '') + esc(String(label || '').replace(/([^ ])#/g, '$1 #')) + '</span>' +
      (symbol ? '<span class="meta">' + esc(meta) + '</span>' : '') +
      (note ? '<span class="sub">' + esc(note) + '</span>' : '') +
      '</span></button>';
  }

  function blurb(role, person) {
    var uses = state.nachUses || (person && person.nachLeft) || 1;
    var text = {
      werwolf: 'Nachts wählt das Rudel gemeinsam ein Haus.',
      dorfbewohner: 'Du hast keine Sonderfähigkeit. Nachts schläfst du.',
      hexe: state.legacyWitch === false
        ? 'Du hast ' + (state.healPotions || (person && person.healsLeft) || 2) +
          ' Heiltränke für das ganze Spiel. Damit holst du eine schon tote Person zurück, keinen Schutz für ein Haus. Dazu einen Gifttrank.'
        : (state.selfTell
          ? 'Du hast ' + (state.healPotions || (person && person.healsLeft) || 2) +
            ' Heiltränke für das ganze Spiel. Wenn du nach den Wölfen aufgerufen wirst, siehst du die Opfer und kannst eines mit einem Heiltrank retten. Der Trank schützt in dieser Nacht das Haus, in dem das Opfer schläft. Mehrere Opfer darfst du heilen, solange Tränke übrig sind. Dazu einen Gifttrank.'
          : 'Du hast ' + (state.healPotions || (person && person.healsLeft) || 2) +
            ' Heiltränke für das ganze Spiel, in einer Nacht auch mehrere, jedes Haus nur einmal. Dazu einen Gifttrank. Du siehst nicht, wer angegriffen wird.'),
      seherin: state.seerExact
        ? 'Nachts siehst du die genaue Rolle einer Person.'
        : 'Nachts siehst du nur Team Dorfbewohner oder Böse.',
      amor: state.quickAmor === false
        ? 'In Nacht 1 verbindest du zwei Personen, dich selbst eingeschlossen, bevor die Wölfe wählen. Aussetzen geht nicht. Danach hast du nachts keine eigene Aktion.'
        : 'Beim Aufdecken verbindest du zwei Personen, dich selbst eingeschlossen. Aussetzen geht nicht. Danach hast du nachts keine eigene Aktion.',
      jaeger: 'Wenn du stirbst, schießt du auf eine Person.',
      waschbaer: 'Einmal darfst du die Rolle einer lebenden Person stehlen. Diese Person wird zum Dorfbewohner. Du bekommst ihre Rolle und ihre Fähigkeit.',
      nachahmerin: 'Du kannst ' + uses + ' Mal die Fähigkeit einer anderen Person nachahmen und musst sie sofort einsetzen.',
      nutte: 'Jede Nacht schläfst du in einem anderen Haus. Dein eigenes Haus ist leer.',
      russe: 'Einmal am Tag darfst du ein Duell anfangen.',
      politiker: 'Du gewinnst nur, wenn die Abstimmung dich wählt. Sonst hast du keine Fähigkeit.',
      schaufel: 'Einmal darfst du eine tote Person zurückholen. Liebe und verbrauchte Kräfte bleiben, wie sie waren.',
      osiris: 'Bis zu ' + (state.osirisUses || 1) + ' Mal im Spiel kannst du nachts auslösen, wenn schon jemand tot ist. Am Morgen stimmt das Dorf ab, wer zurückkehrt. Wer Osiris ist, bleibt verdeckt.'
    };
    return text[role] || '';
  }

  function handoff(name, extra, eyebrow) {
    return header(eyebrow || phaseEyebrow(), 'Weitergeben') +
      hero('📱', 'Weitergeben') +
      '<section class="stage"><p class="eyebrow">Als Nächstes</p><h2>' + esc(name) + '</h2>' +
      '<p class="lead">Gib das Handy weiter. Tippe erst, wenn ' + esc(name) + ' allein auf den Bildschirm schaut.</p>' +
      (extra ? '<p class="hint">' + esc(extra) + '</p>' : '') +
      '<button type="button" class="btn" data-act="ack">' + esc(name) + ' ist bereit</button>' +
      abortLink() + '</section>';
  }

  function phaseEyebrow() {
    if (state.screen === 'night') return 'Nacht ' + state.nightNumber;
    if (state.screen === 'vote') return 'Tag ' + state.day + ' · Abstimmung';
    if (state.screen === 'reveal') return 'Rollen';
    if (state.screen === 'hunter') return 'Schuss';
    if (state.screen === 'duel') return 'Duell';
    if (state.screen === 'discuss' || state.screen === 'announce') return 'Tag ' + state.day;
    return 'Werwolf';
  }

  function abortLink() {
    if (state.remote) return '';
    if (state.confirmAbort) {
      return '<div class="card stack"><p>Wirklich abbrechen?</p>' +
        '<button type="button" class="btn secondary" data-act="abort-no">Weiter spielen</button>' +
        '<button type="button" class="btn bad" data-act="abort">Ja, abbrechen</button></div>';
    }
    return '<button type="button" class="btn secondary" data-act="abort-ask">Spiel abbrechen</button>';
  }

  function mpEntry() {
    if (!window.WerwolfNet || !window.WerwolfNet.available || !window.WerwolfNet.available()) return '';
    if (isGuest()) return '';
    if (inOpenScr()) return '';
    if (window.WerwolfNet.roomInfo && window.WerwolfNet.roomInfo()) return '';
    return '<button type="button" class="btn secondary" data-act="mp-host">Mehrspieler</button>' +
      '<button type="button" class="btn secondary" data-act="mp-join">Beitreten</button>' +
      '<p class="hint">Mehrspieler macht das Spiel im lokalen Netz sichtbar. QR-Codes für WLAN, Hotspot und den Browser zeigt OpenScr, nicht diese Seite. Ohne Bridge bleibt alles auf einem Handy.</p>';
  }

  function mpBar() {
    var net = window.WerwolfNet;
    if (!net || !net.roomInfo) return '';
    var room = net.roomInfo();
    if (!room) return '';
    var away = net.hostAway ? net.hostAway() : '';
    var buttons = room.role === 'host' ? (net.qrButtons ? net.qrButtons() : []).map(function (button) {
      return '<button type="button" class="btn secondary" data-act="mp-qr" data-fn="' + esc(button.fn) + '">' + esc(button.label) + '</button>';
    }).join('') : '';
    var people = (room.players || []).map(function (person) {
      return esc(person.name) + (person.host ? ' (Host)' : '') + (person.connected ? '' : ', kurz weg');
    }).join(' · ');
    var requests = room.role === 'host' ? (room.requests || []).map(function (request) {
      return '<p>' + esc(request.name) + ' möchte beitreten.</p>' +
        '<button type="button" class="btn" data-act="mp-approve" data-id="' + esc(request.id) + '">Zulassen</button>' +
        '<button type="button" class="btn secondary" data-act="mp-deny" data-id="' + esc(request.id) + '">Ablehnen</button>';
    }).join('') : '';
    return '<div class="card stack"><p class="hint">Raum ' + esc(room.roomCode) + (people ? ' · ' + people : '') + '</p>' +
      (away ? '<div class="banner info">' + esc(away) + '</div>' : '') +
      (mpError ? '<div class="banner error">' + esc(mpError) + '</div>' : '') +
      buttons +
      (buttons ? '<p class="hint">Den QR-Code öffnet OpenScr. Gäste können die Seite im Browser mitspielen. Speicher, Spielerliste und Statistik bleiben auf dem Host.</p>' : '') +
      requests +
      (room.role === 'host' ? '<button type="button" class="btn secondary" data-act="mp-leave">Raum schließen</button>' : '<button type="button" class="btn secondary" data-act="mp-leave">Verlassen</button>') +
      '</div>';
  }

  function renderJoin() {
    var rooms = window.WerwolfNet && window.WerwolfNet.rooms ? window.WerwolfNet.rooms() : [];
    var scan = window.WerwolfNet && window.WerwolfNet.qrButtons && window.WerwolfNet.qrButtons().some(function (button) { return button.fn === 'showQr'; });
    var list = rooms.map(function (room) {
      return '<button type="button" class="btn secondary" data-act="mp-room" data-room="' + esc(room.id) + '">' +
        esc(room.hostName) + ' · Raum ' + esc(room.roomCode) + ' · ' + room.players + '/' + room.maxPlayers + '</button>';
    }).join('');
    return header('Beitreten', 'Werwolf') +
      '<div class="stack"><p class="lead">Offene Werwolf-Spiele in der Nähe, mit Hostname und Raumcode. Antippen schickt eine Anfrage. Der QR-Code am Host braucht keine Zustimmung. Ohne App öffnet der QR-Code von OpenScr diese Seite im Browser.</p>' +
      (mpError ? '<div class="banner error">' + esc(mpError) + '</div>' : '') +
      (list || '<p class="hint">Kein Spiel in der Nähe.</p>') +
      (scan ? '<button type="button" class="btn" data-act="mp-scan">QR scannen</button>' : '') +
      '<button type="button" class="btn secondary" data-act="mp-back">Zurück</button></div>';
  }

  function renderWait() {
    var away = window.WerwolfNet && window.WerwolfNet.hostAway ? window.WerwolfNet.hostAway() : '';
    return header('Werwolf', 'Verbinden') +
      '<div class="stack"><p class="lead">' + esc(state.waitText || 'Verbinden …') + '</p>' +
      (away ? '<div class="banner info">' + esc(away) + '</div>' : '') +
      '</div>';
  }

  function renderLobby() {
    var remote = !!state.remote;
    var names = state.players.map(function (p, index) {
      return '<div class="player"><span class="player-name">' + (index + 1) + '. ' + esc(p.name) +
        '</span>' + (remote ? '' : '<button type="button" class="icon-btn" data-act="remove-name" data-id="' + p.id + '" aria-label="' +
        esc(p.name) + ' entfernen">✕</button>') + '</div>';
    }).join('');
    if (window.OpenScrRoster) {
      return header('', 'Werwolf') +
        '<div class="stack">' + errorHtml() + (mpError ? '<div class="banner error">' + esc(mpError) + '</div>' : '') +
        (remote ? '<style>#openscr-roster .orl-x{display:none}</style>' : '') +
        '<div id="openscr-roster"></div></div>';
    }
    return header('', 'Werwolf') +
      '<div class="stack">' +
      errorHtml() +
      mpEntry() +
      (mpError ? '<div class="banner error">' + esc(mpError) + '</div>' : '') +
      '<form id="name-form" class="stack"><input id="name-input" type="text" maxlength="16" autocomplete="off" autocapitalize="words" placeholder="Anzeigename oder Suche" aria-label="Anzeigename oder Suche" value="' + esc(draft.query) + '">' +
      '<div id="name-suggest" class="suggest">' + suggestHtml(draft.query) + '</div>' +
      '<input id="last-input" type="text" maxlength="5" autocomplete="off" autocapitalize="characters" placeholder="Tag" aria-label="Tag" value="' + esc(draft.last) + '">' +
      '<button class="btn" type="submit">Name hinzufügen</button></form>' +
      names +
      '<button type="button" class="btn" data-act="deal"' + (state.players.length < 4 ? ' disabled' : '') + '>Rollen verteilen</button>' +
      '<p class="hint">Mindestens 4 Mitspieler. Aktuell ' + state.players.length + '.</p>' +
      '<button type="button" class="btn secondary" data-act="stats">Statistik</button>' +
      '<h2><span class="crown" aria-hidden="true">👑</span> Kronen</h2>' + scoreboardHtml(false) + resetControl() +
      rulesHtml() +
      '</div>';
  }

  function rulesHtml() {
    return '<details class="card"><summary>Kurze Regeln</summary>' +
      '<ul><li>Nachtfähigkeiten zielen auf Häuser, außer Seherin, Amor, Waschbär und die Schaufel (Personen). Tagsüber gilt immer die Person.</li>' +
      '<li>Die Gastgeberin ist nachts nie daheim. Ein Treffer auf ihr Haus verpufft, ein Treffer auf das Haus, in dem sie schläft, trifft sie und den Gastgeber.</li>' +
      '<li>Werwölfe: Mehrheit, bei Gleichstand das Haus im Uhrzeigersinn ab dem Bürgermeister.</li>' +
      '<li>Abstimmung: Bürgermeister zählt 1,5. Gleichstand heißt, niemand stirbt.</li>' +
      '<li>Nach dem Aufdecken beginnt Nacht 1. Tag 1 folgt am Morgen. Das Amt dreht ab dem Ende von Nacht 2 jeden Morgen einen lebenden Sitz weiter und zusätzlich, wenn der Bürgermeister stirbt.</li>' +
      '<li>' + (state.legacyWitch === false
        ? 'Die Hexe hat ' + (state.healPotions || 2) + ' Heiltränke für das Spiel. Sie wirft einen Trank auf eine schon tote Person und holt sie am Morgen zurück. Ein Haus schützt sie damit nicht. Dazu einen Gifttrank.'
        : (state.selfTell
        ? 'Die Hexe hat ' + (state.healPotions || 2) + ' Heiltränke für das Spiel. Im Erzählermodus sieht sie die Opfer der Werwölfe und kann eines davon retten. Ein Trank schützt in dieser Nacht das Haus des Opfers. Mehrere Opfer darf sie heilen, solange Tränke übrig sind. Gibt es kein Wolfsopfer, bleibt der Trank liegen. Dazu einen Gifttrank.'
        : 'Die Hexe hat ' + (state.healPotions || 2) + ' Heiltränke für das Spiel. Sie schützt Häuser, ohne das Opfer zu kennen. Ein Trank hält in dieser Nacht jeden Tod in dem Haus auf.')) + '</li>' +
      '</ul></details>';
  }

  function wolfBounds() {
    return '<div class="stepper"><span class="role-name">Werwolf mindestens</span><span class="row" style="flex:0 0 auto;align-items:center">' +
      '<button type="button" class="icon-btn" data-act="wolf-min" data-dir="-1" aria-label="weniger minimale Werwölfe">−</button>' +
      '<strong>' + (state.wolfMin || 0) + '</strong>' +
      '<button type="button" class="icon-btn" data-act="wolf-min" data-dir="1" aria-label="mehr minimale Werwölfe">+</button></span></div>' +
      '<div class="stepper"><span class="role-name">Werwolf höchstens</span><span class="row" style="flex:0 0 auto;align-items:center">' +
      '<button type="button" class="icon-btn" data-act="wolf-max" data-dir="-1" aria-label="weniger maximale Werwölfe">−</button>' +
      '<strong>' + (state.wolfMax || 0) + '</strong>' +
      '<button type="button" class="icon-btn" data-act="wolf-max" data-dir="1" aria-label="mehr maximale Werwölfe">+</button></span></div>';
  }

  function optionRow(act, label, pressed, explainAct, open, explain) {
    var infoIcon = '<svg viewBox="0 0 512 512" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="32" stroke-miterlimit="10" d="M248 64C146.39 64 64 146.39 64 248s82.39 184 184 184 184-82.39 184-184S349.61 64 248 64z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M220 220h32v116"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-miterlimit="10" stroke-width="32" d="M208 340h88"/><circle cx="248" cy="156" r="20" fill="currentColor"/></svg>';
    return '<div class="toggle-card"><div class="opt-row">' +
      '<button type="button" class="opt-text" data-act="' + act + '" aria-pressed="' + (pressed ? 'true' : 'false') + '">' + label + '</button>' +
      '<button type="button" class="info-btn" data-act="' + explainAct + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-label="Erklärung">' + infoIcon + '</button>' +
      '<button type="button" class="opt-rest" data-act="' + act + '" aria-label="' + label + '"></button>' +
      '<span class="opt-switch" aria-hidden="true"></span></div>' +
      (open ? '<p class="hint">' + explain + '</p>' : '') +
      '</div>';
  }

  function roleSetupHtml() {
    ensureSetup();
    var poolOn = !!state.rolePool;
    var sum = 0;
    var rows = W.ROLE_ORDER.map(function (role) {
      var count = state.counts[role] || 0;
      if (!(poolOn && role === 'werwolf')) sum += count;
      if (poolOn && role === 'werwolf') return wolfBounds();
      return '<div class="stepper"><span class="role-name" role="img" aria-label="' + esc(W.roleName(role)) + '">' + roleIcon(role) + '</span><span class="role-name">' + esc(W.roleName(role)) + '</span><span class="row" style="flex:0 0 auto;align-items:center">' +
        '<button type="button" class="icon-btn" data-act="bump" data-role="' + role + '" data-dir="-1" aria-label="' + esc(W.roleName(role)) + ' weniger">−</button><strong>' + count + '</strong>' +
        '<button type="button" class="icon-btn" data-act="bump" data-role="' + role + '" data-dir="1" aria-label="' + esc(W.roleName(role)) + ' mehr">+</button>' +
        '</span></div>';
    }).join('');
    var setupCounts = state.counts;
    if (poolOn) {
      setupCounts = {};
      W.ROLE_ORDER.forEach(function (role) { setupCounts[role] = state.counts[role] || 0; });
      setupCounts.wolfMin = state.wolfMin;
      setupCounts.wolfMax = state.wolfMax;
      sum += state.wolfMax || 0;
    }
    var problem = W.validateSetup(setupCounts, state.players.length, state.nachUses, state.healPotions == null ? 2 : state.healPotions, poolOn);
    var poolExplain = poolOn
      ? 'Der Pool hat ' + sum + ' Karten, verteilt werden ' + state.players.length + '. Übrige Karten bleiben draußen. Werwölfe liegen zwischen Minimum und Maximum.'
      : 'Die Summe muss ' + state.players.length + ' sein. Belegt: ' + sum + '.';
    var seerExplain = state.seerExact
      ? 'Die Seherin sieht nachts die genaue Rolle der Person.'
      : 'Die Seherin sieht nur Team Dorfbewohner oder Böse.';
    return optionRow('toggle-pool', 'Mehr Rollen als Spieler: ' + (poolOn ? 'an' : 'aus'), poolOn, 'explain-pool', explainPool, poolExplain) +
      optionRow('toggle-seer', 'Seherin sieht genaue Rolle: ' + (state.seerExact ? 'an' : 'aus'), !!state.seerExact, 'explain-seer', explainSeer, seerExplain) +
      optionRow('toggle-legacy-witch', 'Legacy-Hexe: ' + (state.legacyWitch !== false ? 'an' : 'aus'), state.legacyWitch !== false, 'explain-legacy', explainLegacy,
        state.legacyWitch !== false
          ? 'Der Heiltrank schützt in dieser Nacht ein Haus.'
          : 'Der Heiltrank holt eine schon tote Person am Morgen zurück. Er schützt kein Haus.') +
      optionRow('toggle-wolf-call', 'Unendliche Runde: ' + (state.wolfCall ? 'an' : 'aus'), !!state.wolfCall, 'explain-call', explainCall,
        'Das Dorf gewinnt nicht von allein. Eine Liebesgruppe, die allein übrig ist, gewinnt weiterhin. An jedem Tag kann die Mehrheit „Nur noch Dorfbewohner“ wählen. Stimmt das, gewinnt das Dorf. Stimmt es nicht, gewinnen zuerst lebende Werwölfe, sonst der Politiker, sonst der Waschbär. Sonst endet die Runde nur, wenn nur noch Werwölfe leben oder der Politiker gewählt wird.') +
      (problem ? '<div class="banner error">' + esc(problem) + '</div>' : '') +
      '<div class="card stack">' + rows +
      '<div class="stepper"><span class="role-name">Einsätze ' + esc(W.roleName('osiris')) + '</span><span class="row" style="flex:0 0 auto;align-items:center">' +
      '<button type="button" class="icon-btn" data-act="osiris-uses" data-dir="-1" aria-label="weniger Osiris-Einsätze">−</button><strong>' + (state.osirisUses == null ? 1 : state.osirisUses) + '</strong>' +
      '<button type="button" class="icon-btn" data-act="osiris-uses" data-dir="1" aria-label="mehr Osiris-Einsätze">+</button></span></div>' +
      '<div class="stepper"><span class="role-name">Einsätze ' + esc(W.roleName('nachahmerin')) + '</span><span class="row" style="flex:0 0 auto;align-items:center">' +
      '<button type="button" class="icon-btn" data-act="nach" data-dir="-1" aria-label="weniger Einsätze">−</button><strong>' + state.nachUses + '</strong>' +
      '<button type="button" class="icon-btn" data-act="nach" data-dir="1" aria-label="mehr Einsätze">+</button></span></div>' +
      '<div class="stepper"><span class="role-name">Heiltränke ' + esc(W.roleName('hexe')) + '</span><span class="row" style="flex:0 0 auto;align-items:center">' +
      '<button type="button" class="icon-btn" data-act="heals" data-dir="-1" aria-label="weniger Heiltränke">−</button><strong>' + (state.healPotions || 2) + '</strong>' +
      '<button type="button" class="icon-btn" data-act="heals" data-dir="1" aria-label="mehr Heiltränke">+</button></span></div></div>' +
      '<button type="button" class="btn secondary" data-act="suggest">Vorschlag</button>';
  }

  function renderSetup() {
    return roleSetupHtml();
  }

  function pairLine(id) {
    var other = player(id);
    if (!other) return '';
    return '<p><strong>' + esc(other.name) + '</strong> ist ' + esc(W.roleName(other.role)) + '.</p>';
  }

  function gridMetrics() {
    var count = (state.players || []).length || 1;
    var cols = state.gridCols === 2 || state.gridCols === 3
      ? state.gridCols
      : (window.WerwolfNet ? window.WerwolfNet.gridColumns(count) : 2);
    var width = Math.min(window.innerWidth || 412, 520);
    var height = window.innerHeight || 915;
    var edge = window.WerwolfNet ? window.WerwolfNet.cardEdge(count, cols, width, height) : { size: 140 };
    return { cols: cols, size: edge.size };
  }

  function seatLocked(id) {
    var owner = null;
    if (state.lockMap) owner = state.lockMap[id] || state.lockMap[String(id)] || null;
    else if (window.WerwolfNet && window.WerwolfNet.online && window.WerwolfNet.online()) owner = window.WerwolfNet.lockOwner(id);
    if (!owner) return false;
    if (!state.remote && window.WerwolfNet && owner === window.WerwolfNet.selfId()) return false;
    if (state.remote) return true;
    return true;
  }

  function sortedSeats() {
    return window.WerwolfNet ? window.WerwolfNet.sortPlayers(state.players || []) : (state.players || []).slice();
  }

  function nameGrid(html) {
    var g = gridMetrics();
    return '<div class="name-grid" data-cols="' + g.cols + '" style="--card:' + g.size + 'px;grid-template-columns:repeat(' + g.cols + ',' + g.size + 'px)">' + html + '</div>';
  }

  function crownMarks(name) {
    var n = Number(scores[name]);
    if (!n) n = Number(scores[String(name || '').replace(' #', '#')]);
    n = Math.max(0, Math.floor(n || 0));
    if (!n) return '';
    var html = '';
    var i;
    for (i = 0; i < n; i++) html += '<span class="seat-crown">👑</span>';
    return '<span class="seat-crowns" aria-label="' + n + ' Kronen">' + html + '</span>';
  }

  function mayorMark(id) {
    if (Number(id) !== Number(state.mayorId)) return '';
    return '<span class="mayor-mark" aria-label="Bürgermeister">🎖️</span>';
  }

  function nameButton(p, opts) {
    var font = window.WerwolfNet ? window.WerwolfNet.nameSize(p.name) : 18;
    var locked = seatLocked(p.id);
    var disabled = !!(opts.disabled || locked);
    return '<button type="button" class="choice' + (opts.cls || '') + (locked ? ' locked' : '') + '" data-act="' + opts.act + '" data-id="' + p.id + '"' +
      (disabled ? ' disabled' : '') + ' style="--name-size:' + font + 'px">' +
      (opts.crowns ? crownMarks(p.name) : '') +
      (locked ? '<span class="lock" aria-hidden="true">' + LOCK + '</span>' : '') +
      '<span class="who">' + mayorMark(p.id) + esc(p.name) + '</span><span class="meta">' +
      esc(locked ? 'belegt' : opts.meta) + '</span></button>';
  }

  function renderReveal() {
    if (state.step === 'confirm') {
      var named = player(state.activeId);
      if (!named) return header('Rollen', 'Werwolf');
      return header('Rollen', named.name) +
        '<section class="stage card confirm-role">' +
        '<p class="confirm-name">' + esc(named.name) + '</p>' +
        '<button type="button" class="btn" data-act="reveal-see">Rolle ansehen</button>' +
        '<button type="button" class="btn secondary xl" data-act="back">Zurück</button></section>';
    }
    if (state.step === 'love') {
      var lover = player(state.activeId);
      if (!lover) return header('Rollen', 'Werwolf');
      var partnerId = (lover.amorPair || []).filter(function (id) { return id !== lover.id; })[0];
      var partner = player(partnerId);
      return header('Liebe', lover.name) +
        '<section class="stage card">' + hero('💞', 'Liebe') +
        '<p class="eyebrow">Dein Partner</p>' +
        '<p class="big-role">' + esc(partner ? partner.name : '') + '</p>' +
        '<p class="lead">ist ' + esc(partner ? W.roleName(partner.role) : '') + '.</p>' +
        '<button type="button" class="btn" data-act="ack">Verdecken</button></section>';
    }
    if (state.step === 'link') {
      var amor = player(state.activeId);
      if (!amor) return header('Rollen', 'Werwolf');
      var choices = W.living(state).map(function (p) {
        return choiceButton(p.id, p.name, p.id === amor.id ? 'du selbst' : '', 'person');
      }).join('');
      return header('Deine Rolle', amor.name) +
        '<section class="stage">' + hero('💘', 'Amor') +
        '<p class="eyebrow">Nur für ' + esc(amor.name) + '</p>' +
        '<p class="big-role">Amor</p>' +
        '<p class="lead">Du bist Amor. Wähle jetzt zwei Personen. Du selbst darfst dabei sein. Aussetzen geht nicht.</p>' +
        errorHtml() +
        '<div class="stack">' + choices + '</div>' +
        '<button type="button" class="btn" data-act="confirm">Fertig</button>' +
        '<button type="button" class="btn secondary" data-act="back">Zurück</button></section>';
    }
    if (state.step === 'show') {
      var person = player(state.activeId);
      if (!person) return header('Rollen', 'Werwolf');
      var pair = person.role === 'amor' && person.amorPair
        ? '<div class="card stack"><p class="hint">Dein Paar</p>' + person.amorPair.map(pairLine).join('') + '</div>'
        : '';
      return header('Deine Rolle', person.name) +
        '<section class="stage card">' + hero(roleIcon(person.role), W.roleName(person.role)) +
        '<p class="big-role">' + esc(W.roleName(person.role)) + '</p>' +
        '<p class="lead">' + esc(blurb(person.role, person)) + '</p>' +
        pair +
        '<button type="button" class="btn" data-act="ack">Verstanden, verdecken</button>' +
        '<button type="button" class="btn secondary" data-act="back">Zurück</button></section>';
    }
    var names = nameGrid(sortedSeats().map(function (p) {
      var seen = state.finishedIds ? state.finishedIds.indexOf(p.id) >= 0 : W.revealDone(state, p);
      return nameButton(p, {
        act: 'reveal-pick',
        cls: seen ? ' seen' : '',
        meta: seen ? 'fertig, noch mal möglich' : 'Rolle ansehen',
        crowns: true
      });
    }).join(''));
    var startReady = state.finishedIds ? state.finishedIds.length >= (state.players || []).length && !(state.pendingNamesPublic && state.pendingNamesPublic.length) : W.revealReady(state);
    var confirm = state.remote ? '' : (state.confirmUndoDeal
      ? '<div class="banner error">Mehr als eine Person hat die Rolle schon gesehen. Zurück zur Rollenwahl verwirft die verteilten Rollen.</div>' +
        '<button type="button" class="btn bad" data-act="undo-deal" data-confirm="1">Ja, Rollen verwerfen</button>' +
        '<button type="button" class="btn secondary" data-act="undo-deal-no">Abbrechen</button>'
      : '<button type="button" class="btn secondary" data-act="undo-deal">Zurück</button>');
    return phaseHead(MOON, 'Rollen', '') +
      '<div class="stack">' + errorHtml() +
      (state.selfTell ? '<p class="hint">Danach behält nur der Erzähler das Handy. Er spielt nicht mit.</p>' : '') +
      '<div class="stack">' + names + '</div>' +
      '<button type="button" class="btn" data-act="start-game"' + (startReady ? '' : ' disabled') + '>Spiel starten</button>' +
      confirm + '</div>';
  }

  function renderDiscuss() {
    var list = nameGrid(sortedSeats().map(function (p) {
      var badges = [];
      var mayor = p.id === state.mayorId && p.alive;
      if (!p.alive) badges.push('tot');
      var font = window.WerwolfNet ? window.WerwolfNet.nameSize(p.name) : 18;
      return '<div class="choice' + (p.alive ? '' : ' dead') + '" style="--name-size:' + font + 'px">' +
        crownMarks(p.name) +
        '<span class="who">' + (mayor ? '<span class="mayor-mark" aria-label="Bürgermeister">🎖️</span>' : '') + esc(p.name) +
        '</span>' + (badges.length ? '<span class="meta">' + esc(badges.join(' · ')) + '</span>' : '') + '</div>';
    }).join(''));
    var telling = !!state.selfTell && !state.remoteNarrator;
    var russePossible = !!(state.counts && state.counts.russe) || !!state.russePossible;
    var lead = state.remoteNarrator
      ? 'Der Erzähler hat das Host-Handy. Hier siehst du nur den Stand.'
      : (telling
        ? 'Du behältst das Handy. Trag Duell und Abstimmung ein. Die App wertet nach den bisherigen Regeln aus, inklusive Bürgermeisterstimme, Politiker und Jäger.'
        : 'Redet offen. Das Duell geht vor der Abstimmung, einmal pro Russe. Die Abstimmung ist geheim.');
    if (!russePossible && !state.remoteNarrator && !telling) lead = '';
    return phaseHead(SUN, 'Tag ' + state.day, 'Diskussion') +
      '<div class="stack">' +
      (lead ? '<p class="lead">' + lead + '</p>' : '') +
      (telling ? '<h2>Alle Rollen</h2><div class="stack">' + roleSheetRows() + '</div>' : list) +
      (russePossible ? '<button type="button" class="btn secondary" data-act="to-duel">Duell</button>' : '') +
      (state.remoteNarrator ? '' : '<button type="button" class="btn" data-act="to-vote">Zur Abstimmung</button>') +
      abortLink() + '</div>';
  }

  function renderAnnounce() {
    var box = state.announce || { title: 'Weiter', lines: [], button: 'Weiter' };
    if (box.title === 'Abstimmung') return renderVoteBoard(box);
    return header(phaseEyebrow(), box.title) +
      hero('📢', 'Ansage') +
      '<div class="stack">' +
      '<div class="card stack">' + announceLines(box.lines).map(statusLine).join('') + '</div>' +
      (isGuest() || state.remote ? '' : '<button type="button" class="btn" data-act="ack">' + esc(box.button || 'Weiter') + '</button>') + '</div>';
  }

  function voteMarks(weight) {
    var halves = Number(weight) || 0;
    if (halves <= 0) return '';
    var full = Math.floor(halves / 2);
    var half = halves % 2;
    var html = '';
    var i;
    for (i = 0; i < full; i++) html += '<span class="vote-x"></span>';
    if (half) html += '<span class="vote-x half"></span>';
    var spoken = (halves / 2).toFixed(1).replace('.', ',') + ' Stimmen';
    return '<span class="votes" aria-label="' + esc(spoken) + '">' + html + '</span>';
  }

  function claimVoteCard(weight) {
    var font = window.WerwolfNet ? window.WerwolfNet.nameSize('Nur noch Dorfbewohner') : 16;
    return '<div class="choice" data-id="-1" style="--name-size:' + font + 'px">' +
      voteMarks(weight) +
      '<span class="who-block"><span class="who">' + esc('Nur noch Dorfbewohner') + '</span></span></div>';
  }

  function nobodyVoteCard(weight) {
    var font = window.WerwolfNet ? window.WerwolfNet.nameSize('Niemand') : 18;
    return '<div class="choice" data-id="0" style="--name-size:' + font + 'px">' +
      voteMarks(weight) +
      '<span class="who-block"><span class="who">' + icon('person') + esc('Niemand') + '</span></span></div>';
  }

  function renderVoteBoard(box) {
    var tally = state.lastTally || {};
    var condemned = Number(state.pendingCondemn);
    var list = nameGrid(sortedSeats().map(function (p) {
      var mayor = p.id === state.mayorId && p.alive;
      var font = window.WerwolfNet ? window.WerwolfNet.nameSize(p.name) : 18;
      var raised = Number(state.pendingOsiris) === p.id;
      var shift = p.id === condemned && p.alive
        ? '<span class="card-status" aria-label="gestorben"><span class="before">❤️</span><span class="arrow">→</span><span>💀</span></span>'
        : (raised
          ? '<span class="card-status" aria-label="zurückgeholt"><span class="before">💀</span><span class="arrow">→</span><span>❤️</span></span>'
          : '');
      return '<div class="choice' + (p.alive ? '' : ' dead') + '" style="--name-size:' + font + 'px">' +
        crownMarks(p.name) +
        voteMarks(tally[String(p.id)]) +
        '<span class="who-block"><span class="who">' + (mayor ? '<span class="mayor-mark" aria-label="Bürgermeister">🎖️</span>' : '') + esc(p.name) +
        '</span>' + shift + '</span></div>';
    }).join('') + nobodyVoteCard(tally['0']) + (box.claim ? claimVoteCard(tally['-1']) : ''));
    return phaseHead(SUN, 'Tag ' + state.day, '') +
      '<div class="stack">' + list +
      (isGuest() || state.remote ? '' : '<button type="button" class="btn" data-act="ack">' + esc(box.button || 'Weiter') + '</button>') + '</div>';
  }

  function announceLines(lines) {
    var rest = [];
    var dead = [];
    var alive = [];
    (lines || []).forEach(function (line) {
      if (/Stimme des Bürgermeisters zählt/.test(line)) return;
      if (/ ist gestorben/.test(line)) dead.push(line);
      else if (/ ist wieder im Dorf/.test(line)) alive.push(line);
      else rest.push(line);
    });
    var byName = function (a, b) { return String(a).localeCompare(String(b), 'de'); };
    dead.sort(byName);
    alive.sort(byName);
    return rest.concat(dead, alive);
  }

  function statusLine(line) {
    var text = String(line || '');
    var dead = text.match(/^(.*) ist gestorben(?: \([^)]*\))?\.$/);
    var back = text.match(/^(.*) ist wieder im Dorf\.$/);
    if (dead) return statusRow(dead[1], '❤️', '💀', 'gestorben');
    if (back) return statusRow(back[1], '💀', '❤️', 'wieder da');
    return '<p>' + esc(text) + '</p>';
  }

  function statusRow(name, before, after, label) {
    return '<p class="status-row"><span>' + esc(name) + '</span><span class="status-icons" aria-label="' + esc(label) + '"><span class="before">' + before + '</span><span class="arrow">→</span><span>' + after + '</span></span></p>';
  }

  function roleSheetRows() {
    return state.players.map(function (p, index) {
      var badges = [];
      if (p.id === state.mayorId && p.alive) badges.push('Bürgermeister');
      badges.push(p.alive ? 'lebt' : 'tot');
      return '<div class="player' + (p.alive ? '' : ' dead') + '"><span class="life" role="img" aria-label="' + (p.alive ? 'lebt' : 'tot') + '">' +
        (p.alive ? '❤️' : '💀') + '</span><span><span class="player-name">' + (index + 1) + '. ' + esc(p.name) +
        '</span><span class="sub">' + esc(badges.join(' · ')) + '</span></span><strong>' +
        roleIcon(p.role) + ' ' + esc(W.roleName(p.role)) + '</strong></div>';
    }).join('');
  }

  function narratorCall() {
    var calls = state.narratorCalls || [];
    return calls[state.narratorIndex] || null;
  }

  function wakeLine(role) {
    return '<p class="call-line">' + esc(W.narratorWakeText(role)) + '</p>';
  }

  function renderNarratorSheet() {
    var back = !!state.sheetBack;
    return header(phaseEyebrow(), 'Alle Rollen') +
      hero('📖', 'Rollen') +
      '<div class="stack">' +
      '<p class="lead">Nur der Erzähler sieht diese Liste. Name, Rolle, lebend oder tot.</p>' +
      '<div class="stack">' + roleSheetRows() + '</div>' +
      '<button type="button" class="btn" data-act="' + (back ? 'ack' : 'narrator-begin') + '">' +
      (back ? 'Zurück zum Aufruf' : 'Nacht beginnen') + '</button>' +
      abortLink() + '</div>';
  }

  function renderNarratorCall() {
    var call = narratorCall();
    var role = call ? call.role : 'dorfbewohner';
    var person = call && call.playerId != null ? player(call.playerId) : null;
    var hint = 'Niemand handelt.';
    if (state.narratorReason === 'done') hint = 'Niemand handelt. Schon erledigt.';
    else if (state.narratorReason !== 'cover' && person && person.alive && person.notice) hint = 'Niemand handelt. Die Rolle wurde gestohlen.';
    return header(phaseEyebrow(), W.roleName(role)) +
      hero(roleIcon(role), W.roleName(role)) +
      '<section class="stage">' +
      wakeLine(role) +
      '<p class="quiet-note">' + esc(hint) + '</p>' +
      '<button type="button" class="btn" data-act="ack" data-quiet="1" disabled>Weiter</button>' +
      '<button type="button" class="btn secondary" data-act="narrator-sheet">Rollenliste</button>' +
      '</section>';
  }

  function renderNarratorLovers() {
    var lovers = W.narratorLovers(state);
    var cards = lovers.map(function (p) {
      return '<div class="lover-card">' +
        '<p class="hero" role="img" aria-label="' + esc(W.roleName(p.role)) + '">' + roleIcon(p.role) + '</p>' +
        '<p class="lover-huge">' + esc(p.name) + '</p>' +
        '<p class="lead">' + roleIcon(p.role) + ' ' + esc(W.roleName(p.role)) + '</p></div>';
    }).join('');
    var body = lovers.length
      ? '<p class="lead">Tippe die beiden Verliebten an, sie wachen auf und sehen sich.</p>' + cards
      : '<p class="victim-none">Niemand ist verliebt</p><p class="hint">Tu so, als ob du das Liebespaar antippst.</p>';
    return header(phaseEyebrow(), 'Liebespaar') +
      '<section class="stage">' + body +
      '<button type="button" class="btn" data-act="ack">Weiter</button>' +
      '<button type="button" class="btn secondary" data-act="narrator-sheet">Rollenliste</button>' +
      '</section>';
  }

  function renderNarratorAction() {
    var call = narratorCall();
    var person = player(state.activeId);
    if (!person) return renderNarratorCall();
    var prompt = W.view(state).prompt;
    if (!prompt) return renderNarratorCall();
    if (prompt.kind === 'seer-result') {
      return header(phaseEyebrow(), 'Seherin') + '<div class="stack">' + errorHtml() + promptHtml(person, prompt) + '</div>';
    }
    var started = (state.promptIndex || 0) > 0;
    var picked = (state.selection || []).length > 0;
    var back = (!started || picked)
      ? '<button type="button" class="btn secondary" data-act="back">Zurück</button>' +
        (started ? '' : '<button type="button" class="btn secondary" data-act="narrator-sheet">Rollenliste</button>')
      : '';
    return header(phaseEyebrow(), W.roleName(person.role)) +
      '<div class="stack">' + errorHtml() +
      wakeLine(call ? call.role : person.role) +
      '<p class="hint">Du tippst für ' + esc(person.name) + '.</p>' +
      promptHtml(person, prompt) + back + '</div>';
  }

  function renderTurn() {
    if (state.selfTell && state.screen === 'night') {
      if (state.step === 'sheet') return renderNarratorSheet();
      if (state.step === 'call' && narratorCall() && narratorCall().role === 'liebespaar') return renderNarratorLovers();
      if (state.step === 'call') return renderNarratorCall();
      if (state.step === 'show') return renderNarratorAction();
    }
    if (state.screen === 'night' && state.step === 'list') return renderNightList();
    if (state.screen === 'vote' && state.step === 'list') return renderVoteList();
    if ((state.screen === 'night' || state.screen === 'vote') && state.step === 'ready') return renderNightReady();
    var person = (state.screen === 'night' || state.screen === 'vote') ? player(state.activeId) : player((state.order || [])[state.cursor]);
    if (!person) {
      if (state.screen === 'night') {
        if (!Array.isArray(state.nightDone)) state.nightDone = [];
        state.step = 'list';
        state.activeId = null;
        return renderNightList();
      }
      return header('Werwolf', 'Weiter') +
        '<div class="stack"><button type="button" class="btn secondary" data-act="abort-ask">Spiel abbrechen</button></div>';
    }
    if (state.step !== 'show') return handoff(person.name);
    var prompt = W.view(state).prompt;
    if (!prompt) return handoff(person.name);
    var back = (state.promptIndex || 0) === 0
      ? '<button type="button" class="btn secondary" data-act="back">Zurück</button>'
      : '';
    return header(phaseEyebrow(), person.name) + '<div class="stack">' + errorHtml() + promptHtml(person, prompt) + back + '</div>' + wolfAttackAsk();
  }

  function wolfAttackAsk() {
    if (!confirmWolfId) return '';
    return '<div class="modal"><div class="card stack"><p>Sicher einen Werwolf angreifen?</p>' +
      '<button type="button" class="btn secondary" data-act="wolf-attack-no">Zurück</button>' +
      '<button type="button" class="btn bad" data-act="select" data-id="' + confirmWolfId + '" data-sure="1">Ja, angreifen</button></div></div>';
  }

  function renderNightList() {
    var done = state.finishedIds || state.nightDone || [];
    var waits = !state.remote && W.nightWaitsForAmor(state);
    var names = nameGrid(sortedSeats().map(function (p) {
      var finished = done.indexOf(p.id) >= 0;
      var dead = !p.alive;
      var held = waits && p.role !== 'amor';
      return nameButton(p, {
        act: 'night-pick',
        cls: (finished ? ' done' : '') + (dead ? ' dead' : ''),
        disabled: finished || held || dead,
        meta: dead ? 'tot' : (finished ? 'schon dran' : 'tippen, wenn du dran bist'),
        crowns: true
      });
    }).join(''));
    return phaseHead(MOON, 'Nacht ' + state.nightNumber, '') +
      '<div class="stack">' + errorHtml() +
      (waits ? '<p class="hint">Zuerst tippt Amor. Zurück vor dem Bestätigen verbraucht nichts. Danach ist die Reihenfolge egal, die Wölfe erst nach Amor.</p>' : '') +
      names + abortLink() + '</div>';
  }

  function renderVoteList() {
    var done = state.finishedIds || state.voteDone || [];
    var names = nameGrid(sortedSeats().map(function (p) {
      var finished = done.indexOf(p.id) >= 0;
      var dead = !p.alive;
      return nameButton(p, {
        act: 'vote-pick',
        cls: (finished ? ' done' : '') + (dead ? ' dead' : ''),
        disabled: finished || dead,
        meta: dead ? 'tot' : (finished ? 'Stimme abgegeben' : (p.id === state.mayorId ? 'Bürgermeister, Stimme 1,5' : 'Stimme abgeben')),
        crowns: true
      });
    }).join(''));
    var osirisVote = state.voteKind === 'osiris';
    return phaseHead(SUN, osirisVote ? 'Morgen' : ('Tag ' + state.day), osirisVote ? 'Osiris hat gesprochen. Wen holt das Dorf zurück?' : (state.selfTell ? 'Tippe jede lebende Person, dann ihre Stimme.' : '')) +
      '<div class="stack">' + errorHtml() +
      (state.selfTell ? '<p class="hint">Die Reihenfolge ist egal. Zurück vor dem Bestätigen verbraucht die Stimme nicht. Der Bürgermeister zählt 1,5.</p>' : '') +
      names +
      (!osirisVote && ((state.counts && state.counts.russe) || state.russePossible) ? '<button type="button" class="btn secondary" data-act="to-duel">Duell</button>' : '') +
      abortLink() + '</div>';
  }

  function renderNightReady() {
    var person = player(state.activeId);
    var name = person ? person.name : '';
    return header(phaseEyebrow(), name) +
      (state.screen === 'vote' ? hero('🗳️', 'Abstimmung') : hero('🌙', 'Nacht')) +
      '<section class="stage"><p class="lead">Nur ' + esc(name) + ' schaut jetzt hin.</p>' +
      '<button type="button" class="btn" data-act="go">Go</button>' +
      '<button type="button" class="btn secondary" data-act="back">Zurück</button></section>';
  }

  function promptHtml(person, prompt) {
    if (prompt.kind === 'sleep') {
      return hero('😴', 'Schlafen') + '<section class="stage"><p class="lead">Du schläfst. Für dich gibt es nichts zu tun.</p>' +
        '<button type="button" class="btn" data-act="ack">🚫 Ich will gar nichts machen</button></section>';
    }
    if (prompt.kind === 'notice') {
      var text = person.role === 'dorfbewohner'
        ? 'Jemand hat deine Rolle gestohlen. Du bist jetzt Dorfbewohner.'
        : 'Jemand hat deine Rolle gestohlen. In dieser Nacht gilt deine bisherige Rolle noch. Ab der nächsten Nacht bist du Dorfbewohner.';
      return hero('🦝', 'Diebstahl') + '<div class="banner love">' + esc(text) + '</div><button type="button" class="btn" data-act="ack">Weiter</button>';
    }
    if (prompt.kind === 'love') {
      var partners = W.loverComponent(state, person.id).filter(function (id) {
        var other = player(id);
        return id !== person.id && other && other.alive;
      });
      var lines = partners.map(function (id) {
        var other = player(id);
        return '<p><strong>' + esc(other.name) + '</strong> ist ' + esc(W.roleName(other.role)) + '.</p>';
      }).join('');
      return hero('💞', 'Liebe') + '<div class="banner love">Du bist verliebt. Stirbt eine Person aus dieser Gruppe, sterben alle verbundenen Personen mit.</div>' +
        '<div class="card stack">' + lines + '</div><button type="button" class="btn" data-act="ack">Verdecken</button>';
    }
    if (prompt.kind === 'info' && prompt.victimReveal) return victimRevealBlock(prompt);
    if (prompt.kind === 'info') {
      return hero('📢', 'Hinweis') + '<div class="card"><p class="lead">' + esc(prompt.text) + '</p></div><button type="button" class="btn" data-act="ack">Weiter</button>';
    }
    if (prompt.kind === 'seer-result') {
      var seen = player(prompt.seenId);
      var exact = !!prompt.exact;
      var headline = exact
        ? roleIcon(prompt.role) + ' ' + esc(seen ? seen.name : '')
        : esc(seen ? seen.name : '');
      var detail = exact ? W.roleName(prompt.role) : (prompt.label || 'Team Dorfbewohner');
      var evil = !exact && detail === 'Böse';
      var side = exact
        ? '<p class="lead">ist ' + esc(detail) + '.</p>'
        : '<p class="seer-side" aria-label="' + esc(detail) + '">= <span class="hand">' + (evil ? '👎' : '👍') + '</span></p>';
      var huge = state.selfTell ? ' seer-huge' : '';
      var forSeer = state.selfTell ? '<p class="lead">Zeig das Ergebnis der Seherin, dann verdecken.</p>' : '';
      return hero('👁️', 'Seherin') + '<section class="stage card"><p class="eyebrow">Seherin</p><p class="big-role' + huge + '">' + headline + '</p>' +
        side + forSeer +
        '<button type="button" class="btn" data-act="ack">Verdecken</button></section>';
    }
    return choiceBlock(person, prompt);
  }

  function victimNames(ids) {
    return (ids || []).map(function (id) {
      var person = player(id);
      return person ? person.name : '';
    }).filter(Boolean);
  }

  function victimRevealHtml(ids) {
    var names = victimNames(ids);
    if (!names.length) return '<p class="victim-none">Heute Nacht kein Opfer der Wölfe</p>';
    return '<p class="eyebrow">Opfer der Wölfe</p>' + names.map(function (name) {
      return '<p class="victim-huge">' + esc(name) + '</p>';
    }).join('');
  }

  function victimRevealBlock(prompt) {
    var names = victimNames(prompt.victims);
    var extra = names.length && prompt.text && prompt.text !== 'Heute Nacht kein Opfer der Wölfe'
      ? '<p class="lead">' + esc(prompt.text) + '</p>' : '';
    return '<p class="hero">' + flask('heal') + '</p>' + victimRevealHtml(prompt.victims) + extra +
      '<button type="button" class="btn" data-act="ack">Weiter</button>';
  }

  function choiceBlock(person, prompt) {
    var kind = prompt.target === 'house' ? 'house' : 'person';
    var intro = intros(person, prompt);
    var list = '';
    if (prompt.kind === 'osiris') {
      list = '';
    } else if (prompt.kind === 'vote' && state.voteKind === 'osiris') {
      list = nameGrid(W.targetsFor(state, prompt, person.id).map(function (p) {
        return choiceButton(p.id, p.name, 'tot', 'person');
      }).join('') + choiceButton(0, 'Niemand', '', 'person'));
    } else if (prompt.kind === 'vote') {
      list = nameGrid(W.targetsFor(state, prompt, person.id).map(function (p) {
        return choiceButton(p.id, p.name, '', 'person');
      }).join('') + choiceButton(0, 'Niemand', '', 'person') +
        (state.wolfCall ? choiceButton(-1, 'Nur noch Dorfbewohner', '', 'person') : ''));
    } else if (prompt.kind === 'schaufel' || prompt.kind === 'revive') {
      list = W.targetsFor(state, prompt, person.id).map(function (p) {
        return choiceButton(p.id, p.name, 'tot', 'person');
      }).join('');
    } else {
      var targets = W.targetsFor(state, prompt, person.id);
      list = targets.map(function (p) {
        var label = p.name;
        var meta = '';
        if (prompt.kind === 'wolf' && p.role === 'werwolf') meta = roleIcon('werwolf');
        if (prompt.kind === 'seer' && !p.alive) meta = 'tot';
        return choiceButton(p.id, label, meta, kind);
      }).join('');
    }
    var skipLabel = '🚫 Ich will gar nichts machen';
    if (prompt.kind === 'heal' || prompt.kind === 'revive') skipLabel = (state.heals || []).length ? 'Keine weiteren Heiltränke' : 'Keinen Heiltrank';
    if (prompt.kind === 'poison') skipLabel = 'Kein Gift';
    if (prompt.kind === 'osiris') skipLabel = 'Passen';
    var canSkip = !prompt.forced && (prompt.kind === 'steal' || prompt.kind === 'copy' || prompt.kind === 'heal' ||
      prompt.kind === 'poison' || prompt.kind === 'schaufel' || prompt.kind === 'revive' || prompt.kind === 'osiris' || prompt.kind === 'wolf' || prompt.kind === 'seer');
    var skip = canSkip ? '<button type="button" class="btn secondary" data-act="skip">' + skipLabel + '</button>' : '';
    var confirmLabel = prompt.kind === 'vote' ? 'Stimme abgeben' : (prompt.kind === 'osiris' ? 'Einsetzen' : (prompt.kind === 'nutte' ? 'Hier schlafen' : 'Fertig'));
    return intro + '<div class="stack">' + list + '</div>' +
      '<button type="button" class="btn" data-act="confirm">' + confirmLabel + '</button>' + skip;
  }

  function intros(person, prompt) {
    var text = {
      vote: 'Wen wählst du? Der Bürgermeister zählt 1,5. Bei Gleichstand stirbt niemand.',
      wolf: 'Das Rudel wählt ein Haus.',
      nutte: 'In wessen Haus schläfst du diese Nacht? Dein eigenes Haus bleibt leer.',
      steal: 'Wessen Rolle stiehlst du? Hat die Person heute noch nicht gehandelt, gilt der Diebstahl sofort und du spielst die neue Fähigkeit noch in dieser Nacht. Sonst ab der nächsten Nacht. Das Haus der Gastgeberin spielt keine Rolle.',
      seer: 'Wessen Rolle willst du sehen?',
      amor: 'Wähle zwei Personen. Du selbst darfst dabei sein. Aussetzen geht nicht. Wer heute schon dran war, erfährt die Liebe erst in der nächsten Nacht.',
      copy: 'Wen ahmst du nach? Die Fähigkeit ist frisch und muss in dieser Nacht eingesetzt werden.',
      heal: prompt.reactive
        ? 'Wen rettest du? Die Liste zeigt nur die Opfer. Ein Heiltrank rettet die Person vor den Wölfen und schützt in dieser Nacht das Haus, in dem sie schläft. Jedes Haus nur einmal. Noch ' +
          (prompt.healsLeft || 0) + ' Heiltrank' + ((prompt.healsLeft || 0) === 1 ? '' : 'e') + '.'
        : 'Du darfst ein Haus schützen, ohne zu wissen, wer angegriffen wird. Der Trank gilt nur diese Nacht und hält jeden Tod in diesem Haus auf: Wölfe, Gift und nächtliche Schüsse. Jedes Haus nur einmal. Noch ' +
          (prompt.healsLeft || 0) + ' Heiltrank' + ((prompt.healsLeft || 0) === 1 ? '' : 'e') + '.',
      poison: 'Welches andere Haus vergiftest du? Alle, die darin sind, sterben, außer ein Heiltrank schützt das Haus in dieser Nacht.',
      kill: prompt.attack === 'wolf'
        ? 'Zusätzlicher Werwolf-Angriff: wähle ein Haus.'
        : 'Nächtlicher Schuss: wähle ein Haus. Alle darin sterben.',
      schaufel: 'Wen holst du am Morgen zurück? Die Person behält Rolle und verbrauchte Kräfte und ist nicht mehr verliebt.',
      osiris: 'Schon jemand ist tot. Einsetzen verbraucht einen Einsatz. Am Morgen stimmt das Dorf ab, wer zurückkehrt. Du wählst die Person nicht selbst. Passen lässt den Einsatz liegen.',
      revive: 'Wen holst du mit dem Heiltrank zurück? Die Person ist am Morgen wieder lebendig, behält Rolle und verbrauchte Kräfte und ist nicht mehr verliebt. Ein Haus schützt der Trank so nicht.'
    };
    var marks = {
      vote: hero('🗳️', 'Abstimmung'),
      wolf: hero('🩸', 'Wolfsangriff'),
      nutte: hero('💋', 'Gastgeberin'),
      steal: hero('🦝', 'Diebstahl'),
      seer: hero('👁️', 'Seherin'),
      amor: hero('💘', 'Amor'),
      copy: hero('🎭', 'Nachahmen'),
      heal: '<p class="hero">' + flask('heal') + '</p>',
      revive: '<p class="hero">' + flask('heal') + '</p>',
      poison: '<p class="hero">' + flask('poison') + '</p>',
      kill: hero('🩸', 'Angriff'),
      schaufel: hero('🪏', 'Schaufel'),
      osiris: hero('⚱️', 'Osiris')
    };
    var reveal = prompt.reactive ? victimRevealHtml(prompt.victims) : '';
    return (marks[prompt.kind] || '') + '<p class="lead">' + esc(text[prompt.kind] || 'Wähle.') + '</p>' + reveal;
  }

  function renderHunter() {
    if (state.step === 'list' || state.step === 'handoff') {
      var pending = state.hunters || [];
      var names = nameGrid(sortedSeats().map(function (p) {
        var shooting = pending.indexOf(p.id) >= 0;
        return nameButton(p, {
          act: 'hunter-pick',
          cls: shooting ? '' : ' done',
          disabled: !shooting,
          meta: shooting ? 'Schuss abgeben' : 'nicht dran'
        });
      }).join(''));
      return phaseHead('', 'Schuss', '') +
        '<div class="stack">' + errorHtml() +
        '<p class="hint">' + (state.selfTell
          ? 'Tippe den Jäger, der schießt. Die Reihenfolge ist egal. Zurück vor dem Schuss verbraucht nichts.'
          : 'Nur wer schießen muss, ist antippbar. Die Reihenfolge ist egal. Danach ist der Name grau.') + '</p>' +
        names + '</div>';
    }
    if (state.step === 'ready') {
      var ready = player(state.hunterId);
      var readyName = ready ? ready.name : '';
      return header('Jäger', readyName) +
        hero('🏹', 'Jäger') +
        '<section class="stage"><p class="lead">Nur ' + esc(readyName) + ' schaut jetzt hin.</p>' +
        '<button type="button" class="btn" data-act="go">Go</button>' +
        '<button type="button" class="btn secondary" data-act="back">Zurück</button></section>';
    }
    var hunter = player(state.hunterId);
    if (!hunter) return header('Schuss', 'Weiter');
    var list = W.living(state).map(function (p) {
      return choiceButton(p.id, p.name, '', 'person');
    }).join('');
    var when = state.resolution === 'morning'
      ? 'Du bist in der Nacht gestorben. Der Schuss gilt am Morgen und trifft eine Person, kein Haus.'
      : 'Du stirbst und schießt noch auf eine Person.';
    return header('Jäger', hunter.name) + hero('🏹', 'Jäger') + '<div class="stack">' + errorHtml() +
      '<p class="lead">' + esc(when) + '</p><div class="stack">' + list + '</div>' +
      '<button type="button" class="btn bad" data-act="confirm">Schießen</button>' +
      '<button type="button" class="btn secondary" data-act="back">Zurück</button></div>';
  }

  function renderDuel() {
    var duel = state.duel || { stage: 'who' };
    if (duel.stage === 'who') {
      var people = nameGrid(sortedSeats().map(function (p) {
        return nameButton(p, {
          act: 'duel-pick',
          cls: p.alive ? '' : ' dead',
          disabled: !p.alive,
          meta: p.alive ? 'Das bin ich' : 'tot'
        });
      }).join(''));
      return phaseHead('', 'Duell', '') + '<div class="stack">' + errorHtml() +
        (state.selfTell ? '<p class="hint">Tippe den Namen, der das Duell ansagt. Die Liste hat keine feste Reihenfolge.</p>' : '') +
        '<div class="stack">' + people + '</div>' +
        '<button type="button" class="btn secondary" data-act="cancel">Zurück</button></div>';
    }
    if (duel.stage === 'claim') {
      var claim = player(duel.claimId);
      var claimName = claim ? claim.name : '';
      return header('Duell', claimName) + hero('🎲', 'Duell') + '<div class="stack">' + errorHtml() +
        '<p class="lead">' + (state.selfTell
          ? 'Du tippst für ' + esc(claimName) + '. Zurück verbraucht nichts.'
          : 'Nur ' + esc(claimName) + ' schaut jetzt hin.') + '</p>' +
        '<button type="button" class="btn" data-act="confirm">Das bin ich</button>' +
        '<button type="button" class="btn secondary" data-act="back">Zurück</button></div>';
    }
    if (duel.stage === 'noop') {
      return header('Duell', 'Nichts passiert') + hero('🚫', 'Nichts') +
        '<section class="stage"><p class="lead">Nichts passiert.</p><button type="button" class="btn" data-act="ack">Zurück</button></section>';
    }
    if (duel.stage === 'pick') {
      var russe = player(duel.russeId);
      var foes = W.living(state).filter(function (p) { return p.id !== duel.russeId; }).map(function (p) {
        return choiceButton(p.id, p.name, '', 'person');
      }).join('');
      return header('Duell', russe ? russe.name : 'Russe') + hero('🎲', 'Duell') + '<div class="stack">' + errorHtml() +
        '<div class="banner love">' + esc(duel.forced ? 'Du musst jetzt ein Duell anfangen. Nur heute.' : ((russe ? russe.name : '') + ' ist der Russe.')) + '</div>' +
        '<p class="lead">Fordere 1 bis 5 Personen heraus. Du schießt zuerst, dann in der gewählten Reihenfolge, immer im Kreis. Eine Kugel, sechs Kammern, keine neue Drehung.</p>' +
        '<div class="stack">' + foes + '</div>' +
        '<button type="button" class="btn" data-act="confirm">Duell starten</button>' +
        (duel.forced ? '' : '<button type="button" class="btn secondary" data-act="cancel">Abbrechen</button>') + '</div>';
    }
    var puller = player(duel.order[duel.pull % duel.order.length]);
    var name = puller ? puller.name : '';
if (duel.stage === 'pull-handoff' || duel.stage === 'pull-ready') {
      return header('Duell', name) + hero('🎲', 'Duell') + '<section class="stage"><p class="eyebrow">Zug ' + (duel.pull + 1) + ' von 6</p>' +
        '<p class="lead">Eine Kugel liegt in einer der sechs Kammern. Tippe für den Abzug.</p>' +
        '<button type="button" class="btn bad" data-act="ack">Abzug ziehen</button></section>';
    }
    return header('Duell', name) + hero(duel.hit ? '💥' : '🎲', duel.hit ? 'Treffer' : 'Leer') + '<section class="stage"><p class="big-role">' + (duel.hit ? 'Knall.' : 'Klick.') + '</p>' +
      '<p class="lead">' + (duel.hit ? 'Die Kugel trifft.' : 'Die Kammer ist leer.') + '</p>' +
      '<button type="button" class="btn" data-act="ack">Weiter</button></section>';
  }

  function renderEnd() {
    var winners = {};
    (W.scoreRecipients ? W.scoreRecipients(state) : []).forEach(function (name) { winners[name] = true; });
    var people = (state.players || []).slice().sort(function (a, b) {
      var rank = function (p) { return winners[p.name] ? 0 : (p.alive ? 1 : 2); };
      return rank(a) - rank(b);
    });
    var rows = people.map(function (p) {
      var love = (p.loverIds || []).map(function (id) {
        var other = player(id);
        return other ? other.name : '';
      }).filter(Boolean);
      var old = [];
      (state.bonds || []).forEach(function (pair) {
        var otherId = pair[0] === p.id ? pair[1] : pair[1] === p.id ? pair[0] : null;
        if (!otherId || love.indexOf(player(otherId).name) >= 0) return;
        var other = player(otherId);
        if (other && old.indexOf(other.name) < 0) old.push(other.name);
      });
      var meta = [];
      var mayor = p.id === state.mayorId;
      if (love.length) meta.push('verliebt in ' + love.join(', '));
      else if (old.length) meta.push('Liebesband gelöst, war mit ' + old.join(', '));
      var aliveLoser = p.alive && !winners[p.name];
      return '<div class="rank"><span class="life' + (aliveLoser ? ' faded' : '') + '" role="img" aria-label="' + (p.alive ? 'lebt' : 'tot') + '">' + (p.alive ? '❤️' : '💀') + '</span><span>' +
        (mayor ? '<span class="mayor-mark" aria-label="Bürgermeister">🎖️</span>' : '') + esc(p.name) +
        (meta.length ? '<span class="sub">' + esc(meta.join(' · ')) + '</span>' : '') + '</span><strong class="role-only" aria-label="' + esc(W.roleName(p.role)) + '">' +
        roleIcon(p.role) + '</strong></div>';
    }).join('');
    return header('Ende', 'Werwolf') +
      hero('🏆', 'Sieg') +
      '<div class="stack"><div class="banner win">' + esc(W.WIN_TEXT[state.winner] || 'Spiel zu Ende') + '</div>' +
      '<div class="card">' + rows + '</div>' +
      '<button type="button" class="btn" data-act="home">Weiter</button>' +
      (state.remote
        ? '<p class="hint">Kronen und Statistik stehen nur auf dem Host-Handy.</p>'
        : '<h2><span class="crown" aria-hidden="true">👑</span> Kronen</h2>' + scoreboardHtml(true) + resetControl()) +
      '</div>';
  }

  function scoreboardHtml(highlight) {
    var names = {};
    Object.keys(scores).forEach(function (name) { names[name] = true; });
    (state.players || []).forEach(function (p) { if (p.name) names[p.name] = true; });
    var rows = Object.keys(names).map(function (name) {
      return {
        name: name,
        points: scores[name] || 0,
        plus: !!(highlight && (state.scoredNames || []).indexOf(name) >= 0)
      };
    });
    rows.sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    if (!rows.length) return '<p class="hint">Noch keine Kronen. Wer am Ende lebt und im Siegerteam ist, bekommt eine Krone.</p>';
    return '<div class="card">' + rows.map(function (row) {
      return '<div class="rank' + (row.plus ? ' scored' : '') + '"><span>' + esc(row.name) +
        (row.plus ? ' <strong class="plus">+<span class="crown" aria-hidden="true">👑</span></strong>' : '') +
        '</span><strong>' + row.points + ' <span class="crown" aria-hidden="true">👑</span></strong></div>';
    }).join('') + '</div>';
  }

  function resetControl() {
    if (!confirmReset) return '<button type="button" class="btn secondary" data-act="reset-ask">Kronen zurücksetzen</button>';
    return '<div class="banner error">Alle gespeicherten Kronen löschen? Namen in alten Runden bleiben in der Liste, bis du bestätigst.</div>' +
      '<button type="button" class="btn bad" data-act="reset-scores">Ja, Kronen zurücksetzen</button>' +
      '<button type="button" class="btn secondary" data-act="reset-cancel">Abbrechen</button>';
  }

  function suggestHtml(query) {
    var exclude = [];
    (state.players || []).forEach(function (player) { if (player.pid) exclude.push(player.pid); });
    return P.search(roster.players, query, exclude).slice(0, 6).map(function (player) {
      var label = player.tag ? (player.first + ' #' + player.tag) : (player.first + ' ' + player.last);
      return '<button type="button" class="choice" data-act="use-player" data-pid="' + esc(player.id) + '">' +
        esc(label) + '</button>';
    }).join('');
  }

  function formatPercent(won, got) {
    if (!got) return '–';
    var n = Math.round((won / got) * 1000) / 10;
    return (n % 1 ? n.toFixed(1).replace('.', ',') : String(n)) + ' %';
  }

  function formatAvg(sum, count) {
    if (!count) return '–';
    var n = Math.round((sum / count) * 10) / 10;
    return n % 1 ? n.toFixed(1).replace('.', ',') : String(n);
  }

  function otherKillHtml(other) {
    var keys = Object.keys(other || {}).filter(function (role) { return other[role]; });
    keys.sort(function (a, b) {
      var ia = W.ROLE_ORDER.indexOf(a);
      var ib = W.ROLE_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    if (!keys.length) return '<p class="hint">Keine.</p>';
    return keys.map(function (role) {
      return '<p>' + esc(W.roleName(role)) + ': ' + other[role] + '</p>';
    }).join('');
  }

  function metricTile(label, value) {
    return '<div class="metric"><span class="metric-label">' + esc(label) + '</span><strong>' + esc(String(value)) + '</strong></div>';
  }

  function renderStatPlayer(pid) {
    var player = null;
    roster.players.forEach(function (candidate) { if (candidate.id === pid) player = candidate; });
    if (!player) {
      statsMode = 'list';
      return renderStats();
    }
    var stats = S.playerStats(history, pid);
    var roles = W.ROLE_ORDER.filter(function (role) { return stats.roles[role]; });
    Object.keys(stats.roles).forEach(function (role) {
      if (roles.indexOf(role) < 0) roles.push(role);
    });
    var healed = 0;
    var kills = 0;
    roles.forEach(function (role) {
      var row = stats.roles[role];
      healed += row.healed || 0;
      kills += row.teamKills || 0;
      Object.keys(row.otherKills || {}).forEach(function (key) { kills += row.otherKills[key] || 0; });
    });
    var cards = roles.map(function (role) {
      var row = stats.roles[role];
      var rate = row.got ? Math.max(0, Math.min(100, Math.round((row.won / row.got) * 100))) : 0;
      return '<div class="role-stat"><div class="role-top"><span>' + esc(W.roleName(role)) + '</span><span>' +
        row.got + 'x ' + formatPercent(row.won, row.got) + '</span></div>' +
        '<div class="bar" role="img" aria-label="Siegquote ' + esc(formatPercent(row.won, row.got)) + '"><span style="width:' + rate + '%"></span></div>' +
        '<p class="hint">Gestorben: ' + row.deaths + ' · Ø Todesrunde: ' + formatAvg(row.deathRoundSum, row.deaths) +
        ' · Geheilt: ' + row.healed + ' · Team: ' + row.teamKills + '</p>' +
        (Object.keys(row.otherKills || {}).length ? '<p class="hint">Andere Rollen</p>' + otherKillHtml(row.otherKills) : '') +
        '</div>';
    }).join('');
    var initial = (player.first || '?').charAt(0).toUpperCase();
    return '<div class="stat-id"><span class="avatar" aria-hidden="true">' + esc(initial) + '</span><div><h1>' +
      esc(player.first + ' ' + player.last) + '</h1><p class="subhead">' +
      esc(stats.games + ' Spiele · ' + formatPercent(stats.wins, stats.games) + ' Siege') + '</p></div></div>' +
      '<div class="stack">' +
      '<div class="metrics">' +
      metricTile('Spiele', stats.games) +
      metricTile('Siege', stats.wins) +
      metricTile('Siegquote', formatPercent(stats.wins, stats.games)) +
      metricTile('Ø Todesrunde', formatAvg(stats.deathRoundSum, stats.deaths)) +
      metricTile('Heilungen', healed) +
      metricTile('Kills', kills) +
      '</div>' +
      (cards ? '<h2>Rollen</h2>' + cards : '<p class="hint">Noch keine Rolle in einem beendeten Spiel.</p>') +
      '<button type="button" class="btn secondary" data-act="stats-back">Zurück</button></div>';
  }

  function renderStats() {
    if (statsMode !== 'list') return renderStatPlayer(statsMode);
    var people = roster.players.slice();
    function readStat(player, field) {
      var stats = S.playerStats(history, player.id);
      if (!statsRole) return stats[field] || 0;
      var row = stats.roles[statsRole];
      if (!row) return 0;
      if (field === 'games') return row.got || 0;
      if (field === 'wins') return row.won || 0;
      return row.deaths || 0;
    }
    function personLabel(player) {
      return player.tag ? (player.first + ' #' + player.tag) : ((player.first + ' ' + player.last).trim() || player.first);
    }
    people.sort(function (a, b) {
      var factor = statsDir === 'asc' ? 1 : -1;
      if (statsSort === 'name') return personLabel(a).localeCompare(personLabel(b), 'de') * factor;
      return (readStat(a, statsSort) - readStat(b, statsSort)) * factor;
    });
    var columns = [
      { key: 'name', label: 'Name' },
      { key: 'games', label: 'Spiele' },
      { key: 'wins', label: 'Siege' },
      { key: 'deaths', label: 'Tode' }
    ];
    var filters = [
      { id: '', label: 'Alle' },
      { id: 'werwolf', label: 'Wolf' },
      { id: 'dorfbewohner', label: 'Dorf' }
    ];
    var filterHtml = '<div class="stats-filters">' + filters.map(function (filter) {
      var on = statsRole === filter.id;
      return '<button type="button" data-act="stats-role" data-role="' + filter.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + filter.label + '</button>';
    }).join('') + '</div>';
    var head = '<div class="stats-row head">' + columns.map(function (column) {
      var on = statsSort === column.key;
      var arrow = on ? (statsDir === 'asc' ? ' ▲' : ' ▼') : '';
      return '<button type="button" class="' + (column.key === 'name' ? 'name' : '') + (on ? ' on' : '') + '" data-act="stats-sort" data-key="' + column.key + '">' + column.label + arrow + '</button>';
    }).join('') + '</div>';
    var body = people.map(function (player) {
      return '<div class="stats-row"><span class="name">' + esc(personLabel(player)) + '</span><span>' +
        readStat(player, 'games') + '</span><span>' + readStat(player, 'wins') + '</span><span>' + readStat(player, 'deaths') + '</span></div>';
    }).join('');
    return header('', 'Statistik') +
      '<div class="stack">' + filterHtml +
      (people.length ? '<div class="stats-table">' + head + body + '</div>' : '<p class="hint">Noch niemand gespeichert.</p>') +
      '<button type="button" class="btn secondary" data-act="stats-back">Zurück</button></div>';
  }

  function takePlayer(pid) {
    var player = null;
    for (var i = 0; i < roster.players.length; i++) if (roster.players[i].id === pid) player = roster.players[i];
    if (!player) return;
    draft.query = '';
    draft.last = '';
    var label = player.tag ? (player.first + ' #' + player.tag) : ((player.first + ' #' + player.last).trim());
    if (state && (isGuest() || state.remote)) {
      var known = (state.players || []).some(function (seat) { return String(seat.pid || '') === String(player.id); });
      if (!known) {
        state.players.push({ id: state.nextId || (state.players.length + 1), pid: player.id, first: player.first, last: player.last, tag: player.tag || player.last, name: label });
        state.nextId = (state.nextId || state.players.length) + 1;
      }
      pushSharedRoster();
    }
    act({ type: 'add-player', pid: player.id, first: player.first, last: player.last, tag: player.tag || '', name: label });
  }

  function submitName() {
    var firstEl = document.getElementById('name-input');
    var lastEl = document.getElementById('last-input');
    if (firstEl) draft.query = firstEl.value;
    if (lastEl) draft.last = lastEl.value;
    var first = String(draft.query || '').trim().slice(0, 16);
    var last = String(draft.last || '').trim().slice(0, 5);
    if (!first) {
      state.error = 'Bitte einen Anzeigenamen eingeben.';
      render();
      return;
    }
    if (!last) {
      state.error = 'Bitte auch den Tag eingeben.';
      render();
      return;
    }
    if (isGuest() || (state && state.remote)) {
      draft.query = '';
      draft.last = '';
      act({ type: 'add-player', create: true, first: first, last: last, tag: last, name: first + ' #' + last });
      return;
    }
    var bridge = bridgePlayers();
    if (bridge) {
      bridge.add({ name: first, tag: last }).then(function (created) {
        var player = asRiot(created);
        roster.players.push(player);
        draft.query = '';
        draft.last = '';
        act({ type: 'add-player', pid: player.id, first: player.first, last: player.last, tag: player.tag, name: player.first + ' #' + player.tag });
        pushSharedRoster();
      }, function (error) {
        state.error = (error && error.message) || 'Der Name konnte nicht gespeichert werden.';
        render();
      });
      return;
    }
    var player;
    try {
      player = P.registerPlayer(roster, first, last, Date.now(), Math.random);
    } catch (error) {
      state.error = error.message;
      render();
      return;
    }
    draft.query = '';
    draft.last = '';
    act({ type: 'add-player', pid: player.id, first: player.first, last: player.last, name: player.first });
    pushSharedRoster();
  }

  function typingField() {
    var el = document.activeElement;
    if (!el || !app.contains(el)) return false;
    if (el.isContentEditable) return true;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function mpApi() {
    var bridge = window.OpenScrBridge || window.EveryAppBridge;
    return bridge && bridge.multiplayer ? bridge.multiplayer : null;
  }

  function inOpenScr() {
    return !!(window.ReactNativeWebView && window.ReactNativeWebView.postMessage);
  }

  function postShell(page) {
    shell = page;
    if (!inOpenScr()) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'shell-page', page: page }));
  }

  function wifiPayload(ssid, password) {
    var escWifi = function (value) { return String(value || '').replace(/([\\;,:"])/g, '\\$1'); };
    return 'WIFI:T:WPA;S:' + escWifi(ssid) + ';P:' + escWifi(password) + ';;';
  }

  function qrButton(action, label, extra) {
    return '<div class="qr-panel' + (extra ? ' is-open' : '') + '">' +
      '<button type="button" class="btn secondary qr-btn" data-act="' + action + '"><span>' + label + '</span></button>' +
      (extra || '') + '</div>';
  }

  function renderShellQr() {
    if (window.OpenScrQr) {
      return header('Werwolf', 'Einladung') + '<div class="stack"><div id="openscr-qr"></div></div>';
    }
    var requests = '';
    var room = window.WerwolfNet && window.WerwolfNet.roomInfo && window.WerwolfNet.roomInfo();
    if (room && room.role === 'host' && room.requests) {
      requests = room.requests.map(function (request) {
        return '<p class="hint">' + esc(request.name) + ' möchte beitreten.</p>' +
          '<div class="row"><button type="button" class="btn" data-act="mp-approve" data-id="' + esc(request.id) + '">Zulassen</button>' +
          '<button type="button" class="btn secondary" data-act="mp-deny" data-id="' + esc(request.id) + '">Ablehnen</button></div>';
      }).join('');
    }
    var hostExtra = qrPanel !== 'host' ? '' : (
      '<div class="row">' +
      '<button type="button" class="btn' + (hostLink === 'wlan' ? '' : ' ghost') + '" data-act="qr-wlan">WLAN</button>' +
      '<button type="button" class="btn' + (hostLink === 'hotspot' ? '' : ' ghost') + '" data-act="qr-hotspot">Hotspot</button>' +
      '</div>' +
      (hostLink === 'hotspot'
        ? '<form class="stack" data-act="qr-hotspot-show"><input id="hotSsid" type="text" maxlength="64" placeholder="Hotspot-Name" value="' + esc(hotSsid) + '" aria-label="Hotspot-Name">' +
          '<input id="hotPass" type="text" maxlength="64" placeholder="Hotspot-Passwort" value="' + esc(hotPass) + '" aria-label="Hotspot-Passwort">' +
          '<button class="btn secondary" type="submit">QR-Code zeigen</button></form>'
        : '') +
      (qrNote ? '<p class="hint">' + esc(qrNote) + '</p>' : '') +
      (qrImage ? '<img class="qr-image" alt="QR-Code" src="' + esc(qrImage) + '">' : '') +
      (qrShare ? '<div class="row"><button type="button" class="btn ghost" data-act="qr-copy">Link kopieren</button><button type="button" class="btn ghost" data-act="qr-share">Teilen</button></div>' : '') +
      '<button type="button" class="btn bad" data-act="mp-leave">Hosting beenden</button>'
    );
    var downloadExtra = qrPanel !== 'download' ? '' : (
      (qrImage ? '<img class="qr-image" alt="QR-Code zum Herunterladen" src="' + esc(qrImage) + '">' : '') +
      (qrNote ? '<p class="hint">' + esc(qrNote) + '</p>' : '') +
      (qrShare ? '<div class="row"><button type="button" class="btn ghost" data-act="qr-copy">Link kopieren</button><button type="button" class="btn ghost" data-act="qr-share">Teilen</button></div>' : '')
    );
    return header('Werwolf', 'Einladung') + '<div class="stack">' +
      qrButton('qr-join', 'Code scannen') +
      qrButton('qr-host', 'Host Multiplayer', hostExtra) +
      qrButton('qr-download', 'Download Scrap', downloadExtra) +
      requests +
      '</div>';
  }

  function renderShellOptions() {
    var telling = !!state.selfTell;
    var wolf = !!(state && state.showWolfAction);
    var quick = !state || state.quickAmor !== false;
    var tellExplain = telling
      ? 'Der Erzähler behält das Handy und spielt nicht mit. Er trägt Duell und Abstimmung ein.'
      : 'Jede Person tippt nachts und bei der Abstimmung selbst.';
    var wolfExplain = wolf
      ? 'Am Morgen und am Tag steht dazu, woran jemand gestorben ist.'
      : 'Am Morgen und am Tag steht nur, wer gestorben ist. Nicht, ob Werwolf, Hexe, Liebe, Gastgeberin oder Duell.';
    var amorExplain = quick
      ? 'Amor verbindet beim Aufdecken. Spiel starten wartet auf das Paar.'
      : 'Amor verbindet in Nacht 1, als erste Rolle, vor den Wölfen.';
    return header('Werwolf', 'Optionen') + '<div class="stack">' +
      optionRow('toggle-self-tell', 'Wir erzählen selber: ' + (telling ? 'an' : 'aus'), telling, 'explain-tell', explainTell, tellExplain) +
      optionRow('toggle-wolf-action', 'Werwolf-Aktion anzeigen: ' + (wolf ? 'an' : 'aus'), wolf, 'explain-wolf', explainWolf, wolfExplain) +
      optionRow('toggle-quick-amor', 'Quick Amor: ' + (quick ? 'an' : 'aus'), quick, 'explain-amor', explainAmor, amorExplain) +
      roleSetupHtml() +
      rulesHtml() +
      '</div>';
  }

  function paintHostQr() {
    qrPanel = 'host';
    var net = window.WerwolfNet;
    var running = net && net.roomInfo && net.roomInfo() && net.roomInfo().role === 'host';
    var start = running ? Promise.resolve() : net.host();
    start.then(function () {
      var mp = mpApi();
      if (!mp || typeof mp.codes !== 'function') {
        qrNote = 'Raum ist offen. Den Code zeigt OpenScr.';
        qrImage = '';
        render();
        return null;
      }
      return mp.codes();
    }).then(function (codes) {
      if (!codes && qrNote) return null;
      var url = codes && (codes.gameUrl || codes.qrPayload) || '';
      qrShare = url;
      var mp = mpApi();
      var text = url;
      if (hostLink === 'hotspot') {
        text = hotSsid ? wifiPayload(hotSsid, hotPass) : '';
        qrNote = hotSsid ? 'Hotspot scannen, danach den Spiel-Link öffnen.' : 'Name und Passwort eintragen.';
      } else {
        qrNote = url ? 'Gleiches WLAN. Der Code öffnet das Spiel im Browser.' : 'Der Spiel-Link wird vorbereitet.';
      }
      if (!text || !mp || typeof mp.qrDataUrl !== 'function') {
        qrImage = '';
        render();
        return null;
      }
      return mp.qrDataUrl(text);
    }).then(function (image) {
      if (typeof image === 'string') qrImage = image;
      render();
    }, function (error) {
      qrNote = (error && error.message) || 'Hosting nicht verfügbar.';
      qrImage = '';
      render();
    });
  }

  function rosterLabel(player) {
    if (!player) return '';
    if (player.tag) {
      var base = String(player.name || player.first || '');
      if (base.indexOf('#') < 0) return base + ' #' + player.tag;
      return base.replace(/([^ ])#/g, '$1 #');
    }
    return player.name || player.first || '';
  }

  function lobbyRoles() {
    ensureSetup();
    var counts = state.counts || W.defaultCounts((state.players || []).length || 4);
    var pool = !!state.rolePool;
    var teams = { wolf: 'Werwölfe', village: 'Dorf', politiker: 'Politiker', waschbaer: 'Waschbär' };
    return W.ROLE_ORDER.filter(function (role) {
      if ((counts[role] || 0) > 0) return true;
      return pool && role === 'werwolf' && (state.wolfMax || 0) > 0;
    }).map(function (role) {
      var team = role === 'waschbaer' ? 'waschbaer' : W.teamOfRole(role);
      return {
        id: role,
        emoji: ROLE_ICON[role] || '❓',
        name: W.roleName(role),
        team: teams[team] || '',
        text: blurb(role)
      };
    });
  }

  function sharedRosterModel() {
    return {
      query: draft.query || '',
      directory: (roster.players || []).map(function (player) {
        var tag = player.tag || (!player.first || String(player.first).indexOf(' ') < 0 ? '' : player.last);
        return { id: String(player.id), label: tag ? (player.first + ' #' + tag) : ((player.first + ' ' + player.last).trim() || player.first) };
      }),
      seated: (state.players || []).map(function (player) {
        return { id: String(player.id), pid: String(player.pid || ''), label: rosterLabel(player) };
      }),
      startLabel: 'Rollen verteilen',
      startDisabled: (state.players || []).length < 4,
      statsLabel: 'Statistik',
      canRemove: !state.remote,
      roles: lobbyRoles(),
      rulesHtml: rulesHtml()
    };
  }

  function pushSharedRoster() {
    if (!window.OpenScrRoster || !document.getElementById('openscr-roster')) return;
    window.OpenScrRoster.setModel(sharedRosterModel());
  }

  function mountSharedQr() {
    var el = document.getElementById('openscr-qr');
    if (!el || !window.OpenScrQr || shell !== 'qr') return;
    var room = window.WerwolfNet && window.WerwolfNet.roomInfo && window.WerwolfNet.roomInfo();
    var requests = room && room.role === 'host' && room.requests ? room.requests : [];
    window.OpenScrQr.attach(el, {
      onScan: function () {
        shell = 'index';
        postShell('index');
        uiJoin = true;
        if (window.WerwolfNet && window.WerwolfNet.discover) window.WerwolfNet.discover();
        render();
      },
      onHost: function () { hostLink = 'wlan'; paintHostQr(); },
      onDownload: function () {
        qrPanel = 'download';
        qrShare = SCRAP_URL;
        qrNote = 'In OpenScr scannen, um Werwolf zu laden.';
        var mp = mpApi();
        if (mp && mp.qrDataUrl) mp.qrDataUrl(SCRAP_URL).then(function (image) { qrImage = image || ''; render(); });
        else render();
      },
      onWlan: function () { hostLink = 'wlan'; paintHostQr(); },
      onHotspot: function () { hostLink = 'hotspot'; qrImage = ''; qrNote = 'Name und Passwort eintragen.'; render(); },
      onHotspotShow: function (draft) {
        hotSsid = draft.ssid || '';
        hotPass = draft.pass || '';
        paintHostQr();
      },
      onCopy: function () {
        if (!qrShare) return;
        var mp = mpApi();
        var write = mp && mp.clipboard && mp.clipboard.setString ? mp.clipboard.setString(qrShare) : (navigator.clipboard ? navigator.clipboard.writeText(qrShare) : Promise.resolve());
        Promise.resolve(write).then(function () { render(); }, function () { render(); });
      },
      onShare: function () {
        if (!qrShare || !navigator.share) return;
        navigator.share({ title: 'Werwolf', text: qrShare, url: qrShare }).catch(function () {});
      },
      onStop: function () {
        qrPanel = '';
        qrImage = '';
        qrShare = '';
        if (window.WerwolfNet && window.WerwolfNet.leave) window.WerwolfNet.leave();
        render();
      },
      onApprove: function (id) { if (window.WerwolfNet && window.WerwolfNet.approve) window.WerwolfNet.approve(id); },
      onDeny: function (id) { if (window.WerwolfNet && window.WerwolfNet.deny) window.WerwolfNet.deny(id); }
    });
    window.OpenScrQr.setModel({
      open: qrPanel || '',
      hostLink: hostLink || 'wlan',
      ssid: hotSsid || '',
      pass: hotPass || '',
      note: qrNote || '',
      image: qrImage || '',
      share: qrShare || '',
      copied: false,
      requests: requests.map(function (request) { return { id: request.id, name: request.name }; })
    });
  }

  function mountSharedRoster() {
    var el = document.getElementById('openscr-roster');
    if (!el || !window.OpenScrRoster || !state || state.screen !== 'lobby' || shell !== 'index') return;
    window.OpenScrRoster.attach(el, {
      onQuery: function (value) { draft.query = value; },
      onPick: function (id) { takePlayer(id); pushSharedRoster(); },
      onRemove: function (id) {
        if (state.remote || isGuest()) return;
        act({ type: 'remove-name', id: Number(id) });
        pushSharedRoster();
      },
      onCreate: function (draftPerson) {
        draft.query = draftPerson.name || '';
        draft.last = draftPerson.tag || '';
        submitName();
      },
      onStart: function () { act({ type: 'deal' }); },
      onStats: function () { statsMode = 'list'; statsRole = ''; statsSort = 'wins'; statsDir = 'desc'; render(); }
    });
    pushSharedRoster();
  }

  var duelSoundKey = '';
  function playDuelSound() {
    var duel = state && state.screen === 'duel' ? state.duel : null;
    if (!duel) { duelSoundKey = ''; return; }
    var file = '';
    var key = '';
    if (duel.stage === 'pull-ready' && duel.pull === 0) {
      file = 'spin.mp3';
      key = 'spin';
    } else if (duel.stage === 'pull-ready' || duel.stage === 'pull-handoff') {
      file = 'cock.mp3';
      key = 'cock:' + duel.pull + ':' + duel.stage;
    } else if (duel.stage === 'pull-result') {
      file = duel.hit ? 'shot.mp3' : 'dry.mp3';
      key = file + ':' + duel.pull;
    } else {
      return;
    }
    if (key === duelSoundKey) return;
    duelSoundKey = key;
    try {
      var audio = new Audio('assets/revolver/' + file);
      var played = audio.play();
      if (played && played.catch) played.catch(function () {});
    } catch (error) {}
  }

  function render() {
    // Tastatur auf Android feuert resize. Ein innerHTML-Neuaufbau würde das
    // fokussierte Feld entfernen und die Tastatur sofort wieder schließen.
    if (typingField()) {
      renderQueued = true;
      if (state && state.screen === 'lobby') pushSharedRoster();
      return;
    }
    renderQueued = false;
    if (booting) {
      app.innerHTML = '<p class="lead">Laden …</p>';
      return;
    }
    var overlay = window.WerwolfNet && window.WerwolfNet.display && window.WerwolfNet.display();
    var auth = state;
    if (overlay) state = overlay;
    try {
      if (!state || state.screen !== 'lobby') statsMode = null;
      var html = '';
      var away = window.WerwolfNet && window.WerwolfNet.hostAway ? window.WerwolfNet.hostAway() : '';
      if (shell === 'qr') html = renderShellQr();
      else if (shell === 'options') html = renderShellOptions();
      else if (uiJoin && !isGuest()) html = renderJoin();
      else if (statsMode && state.screen === 'lobby') html = renderStats();
      else if (state.screen === 'wait') html = renderWait();
      else if (state.screen === 'lobby' || state.screen === 'setup') html = renderLobby();
      else if (state.screen === 'reveal') html = renderReveal();
      else if (state.screen === 'discuss') {
        if (!state.remoteNarrator && !isGuest()) {
          W.send(state, { type: 'to-vote' });
          html = renderTurn();
        } else html = renderDiscuss();
      }
      else if (state.screen === 'announce') html = renderAnnounce();
      else if (state.screen === 'night' || state.screen === 'vote') html = renderTurn();
      else if (state.screen === 'hunter') html = renderHunter();
      else if (state.screen === 'duel') html = renderDuel();
      else if (state.screen === 'end') html = renderEnd();
      else html = renderLobby();
      if (away && state.screen !== 'wait' && shell === 'index') html = '<div class="banner info">' + esc(away) + '</div>' + html;
      app.innerHTML = html;
      playDuelSound();
      mountSharedRoster();
      mountSharedQr();
      armQuiet(!!(state && state.selfTell && state.screen === 'night' && state.step === 'call' && state.narratorQuiet));
      syncSettings();
    } finally {
      state = auth;
    }
  }

  function syncSettings() {
    var tell = document.getElementById('set-tell');
    var wolf = document.getElementById('set-wolf');
    if (!tell || !wolf) return;
    var amor = document.getElementById('set-amor');
    var telling = !!(state && state.selfTell);
    var showing = !!(state && state.showWolfAction);
    var quick = !state || state.quickAmor !== false;
    var linked = !!(state && state.players && state.players.some(function (p) { return p.role === 'amor' && p.amorLinked; }));
    tell.textContent = 'Wir erzählen selber: ' + (telling ? 'an' : 'aus');
    tell.setAttribute('aria-pressed', telling ? 'true' : 'false');
    wolf.textContent = 'Werwolf-Aktion anzeigen: ' + (showing ? 'an' : 'aus');
    wolf.setAttribute('aria-pressed', showing ? 'true' : 'false');
    if (!amor) return;
    amor.textContent = 'Quick Amor: ' + (quick ? 'an' : 'aus');
    amor.setAttribute('aria-pressed', quick ? 'true' : 'false');
    amor.disabled = linked;
  }

  function armQuiet(on) {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = null;
    if (!on) return;
    quietTimer = setTimeout(function () {
      quietTimer = null;
      var btn = document.querySelector('#app [data-quiet="1"]');
      if (btn) btn.disabled = false;
    }, 800);
  }

  app.addEventListener('focusout', function () {
    if (!renderQueued) return;
    setTimeout(function () {
      if (renderQueued && !typingField()) render();
    }, 0);
  });

  var namePick = null;
  document.addEventListener('pointerdown', function (event) {
    var button = event.target && event.target.closest && event.target.closest('#openscr-roster [data-act="pick"]');
    if (!button || button.dataset.seated === '1') { namePick = null; return; }
    event.preventDefault();
    event.stopPropagation();
    namePick = { id: button.dataset.id, x: event.clientX, y: event.clientY };
  }, true);
  document.addEventListener('pointerup', function (event) {
    var pick = namePick;
    namePick = null;
    if (!pick) return;
    var dx = event.clientX - pick.x;
    var dy = event.clientY - pick.y;
    if (dx * dx + dy * dy > 256) return;
    takePlayer(pick.id);
  }, true);

  document.addEventListener('click', function (event) {
    var button = event.target && event.target.closest && event.target.closest('button');
    if (!button || button.type !== 'submit') return;
    var form = button.form;
    if (!form || form.getAttribute('data-act') !== 'create') return;
    event.preventDefault();
    event.stopPropagation();
    var name = form.querySelector('#orl-first');
    var tag = form.querySelector('#orl-tag');
    draft.query = name ? name.value : '';
    draft.last = tag ? tag.value : '';
    submitName();
  }, true);

  app.addEventListener('click', function (event) {
    if (rendering) return;
    var el = event.target.closest('[data-act]');
    if (!el || el.disabled || el.tagName === 'FORM') return;
    var type = el.getAttribute('data-act');
    if (type === 'stats') { statsMode = 'list'; statsRole = ''; statsSort = 'wins'; statsDir = 'desc'; render(); return; }
    if (type === 'stats-role') { statsRole = el.getAttribute('data-role') || ''; render(); return; }
    if (type === 'stats-sort') {
      var key = el.getAttribute('data-key') || 'wins';
      if (key === statsSort) statsDir = statsDir === 'desc' ? 'asc' : 'desc';
      else { statsSort = key; statsDir = key === 'name' ? 'asc' : 'desc'; }
      render();
      return;
    }
    if (type === 'stats-back') {
      statsMode = statsMode && statsMode !== 'list' ? 'list' : null;
      render();
      return;
    }
    if (type === 'open-player') { statsMode = el.getAttribute('data-pid'); render(); return; }
    if (type === 'use-player') { takePlayer(el.getAttribute('data-pid')); return; }
    if (type === 'bump') {
      var role = el.getAttribute('data-role');
      act({ type: 'set-count', role: role, value: (state.counts[role] || 0) + Number(el.getAttribute('data-dir')) });
      return;
    }
    if (type === 'osiris-uses') {
      var osirisUses = (state.osirisUses == null ? 1 : state.osirisUses) + Number(el.getAttribute('data-dir'));
      if (osirisUses < 1) osirisUses = 1;
      if (osirisUses > 5) osirisUses = 5;
      act({ type: 'set-osiris', value: osirisUses });
      return;
    }
    if (type === 'nach') {
      var next = (state.nachUses || 1) + Number(el.getAttribute('data-dir'));
      if (next < 1) next = 1;
      if (next > 5) next = 5;
      act({ type: 'set-nach', value: next });
      return;
    }
    if (type === 'explain-pool' || type === 'explain-seer' || type === 'explain-wolf' || type === 'explain-amor' || type === 'explain-tell' || type === 'explain-legacy') {
      var nextPool = type === 'explain-pool' && !explainPool;
      var nextSeer = type === 'explain-seer' && !explainSeer;
      var nextWolf = type === 'explain-wolf' && !explainWolf;
      var nextAmor = type === 'explain-amor' && !explainAmor;
      var nextTell = type === 'explain-tell' && !explainTell;
      var nextLegacy = type === 'explain-legacy' && !explainLegacy;
      var nextCall = type === 'explain-call' && !explainCall;
      explainPool = nextPool;
      explainSeer = nextSeer;
      explainWolf = nextWolf;
      explainAmor = nextAmor;
      explainTell = nextTell;
      explainLegacy = nextLegacy;
      explainCall = nextCall;
      render();
      return;
    }
    if (type === 'toggle-pool') {
      act({ type: 'toggle-pool' });
      return;
    }
    if (type === 'toggle-legacy-witch') {
      act({ type: 'toggle-legacy-witch' });
      return;
    }
    if (type === 'toggle-wolf-call') {
      act({ type: 'toggle-wolf-call' });
      return;
    }
    if (type === 'toggle-seer') {
      act({ type: 'toggle-seer' });
      return;
    }
    if (type === 'wolf-min' || type === 'wolf-max') {
      var key = type === 'wolf-min' ? 'wolfMin' : 'wolfMax';
      var value = (state[key] || 0) + Number(el.getAttribute('data-dir'));
      if (value < 0) value = 0;
      act({ type: type === 'wolf-min' ? 'set-wolf-min' : 'set-wolf-max', value: value });
      return;
    }
    if (type === 'heals') {
      var heals = (state.healPotions == null ? 2 : state.healPotions) + Number(el.getAttribute('data-dir'));
      if (heals < 1) heals = 1;
      if (heals > 8) heals = 8;
      act({ type: 'set-heals', value: heals });
      return;
    }
    if (type === 'qr-host') { paintHostQr(); return; }
    if (type === 'qr-wlan') { hostLink = 'wlan'; paintHostQr(); return; }
    if (type === 'qr-hotspot') { hostLink = 'hotspot'; qrImage = ''; qrNote = 'Name und Passwort eintragen.'; render(); return; }
    if (type === 'qr-download') {
      qrPanel = 'download';
      qrShare = SCRAP_URL;
      qrNote = 'In OpenScr scannen, um Werwolf zu laden.';
      var mp = mpApi();
      if (mp && mp.qrDataUrl) mp.qrDataUrl(SCRAP_URL).then(function (image) { qrImage = image || ''; render(); });
      else render();
      return;
    }
    if (type === 'qr-join') {
      shell = 'index';
      postShell('index');
      uiJoin = true;
      if (window.WerwolfNet && window.WerwolfNet.discover) window.WerwolfNet.discover();
      render();
      return;
    }
    if (type === 'qr-copy') {
      var clip = (window.OpenScrBridge || window.EveryAppBridge);
      var write = clip && clip.clipboard && clip.clipboard.setString;
      if (write) write(qrShare);
      else if (navigator.clipboard) navigator.clipboard.writeText(qrShare);
      return;
    }
    if (type === 'qr-share') {
      if (navigator.share) navigator.share({ title: 'Werwolf', text: qrShare, url: qrShare }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(qrShare);
      return;
    }
    if (type === 'bug-open') {
      var bugPanel = document.getElementById('bug-panel');
      if (bugPanel) bugPanel.hidden = false;
      return;
    }
    if (type === 'mp-host') {
      if (isGuest()) return;
      mpError = '';
      window.WerwolfNet.host().then(function () { uiJoin = false; }, function (error) {
        mpError = (error && error.message) || 'Mehrspieler braucht die Berechtigung und einen neuen OpenScr-Build.';
        render();
      });
      return;
    }
    if (type === 'mp-join') {
      mpError = '';
      uiJoin = true;
      window.WerwolfNet.discover().then(function () {}, function (error) {
        mpError = (error && error.message) || 'Suche nicht verfügbar.';
        render();
      });
      render();
      return;
    }
    if (type === 'mp-back') {
      uiJoin = false;
      if (window.WerwolfNet.stopDiscovery) window.WerwolfNet.stopDiscovery();
      render();
      return;
    }
    if (type === 'mp-room') {
      mpError = '';
      window.WerwolfNet.joinRoom(el.getAttribute('data-room'), 'Handy').then(function () { uiJoin = false; }, function (error) {
        mpError = (error && error.message) || 'Beitritt abgelehnt.';
        render();
      });
      return;
    }
    if (type === 'mp-scan') {
      mpError = '';
      window.WerwolfNet.joinQr(null, 'Handy').then(function () { uiJoin = false; }, function (error) {
        mpError = (error && error.message) || 'QR-Scan nicht verfügbar.';
        render();
      });
      return;
    }
    if (type === 'mp-approve') { window.WerwolfNet.approve(el.getAttribute('data-id')); return; }
    if (type === 'mp-deny') { window.WerwolfNet.deny(el.getAttribute('data-id')); return; }
    if (type === 'mp-qr') { window.WerwolfNet.showQr(el.getAttribute('data-fn') || 'showQr'); return; }
    if (type === 'mp-leave') {
      var guestLeft = isGuest();
      if (window.WerwolfNet.leave) window.WerwolfNet.leave();
      uiJoin = false;
      if (guestLeft) state = W.newLobby();
      render();
      return;
    }
    if (isGuest() && (type === 'toggle-self-tell' || type === 'stats' || type === 'reset-ask')) return;
    if (type === 'confirm') {
      var ids = (ui().selection || []).slice();
      act({ type: 'confirm', id: ids.length ? ids[0] : undefined, ids: ids });
      return;
    }
    if (type === 'undo-deal') {
      act({ type: 'undo-deal', confirm: el.getAttribute('data-confirm') === '1' });
      return;
    }
    if (type === 'wolf-attack-no') { confirmWolfId = 0; render(); return; }
    if (type === 'select') {
      var pickedId = Number(el.getAttribute('data-id'));
      var view = W.view(ui());
      var prompt = view && view.prompt;
      var picked = player(pickedId);
      if (el.getAttribute('data-sure') !== '1' && prompt && prompt.kind === 'wolf' && picked && picked.role === 'werwolf') {
        confirmWolfId = pickedId;
        render();
        return;
      }
      confirmWolfId = 0;
      act({ type: 'select', id: pickedId });
      return;
    }
    if (type === 'remove-name' || type === 'night-pick' || type === 'reveal-pick' || type === 'vote-pick' || type === 'hunter-pick' || type === 'duel-pick') {
      act({ type: type, id: Number(el.getAttribute('data-id')) });
      return;
    }
    act({ type: type });
  });

  app.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form) return;
    if (form.getAttribute('data-act') === 'qr-hotspot-show') {
      event.preventDefault();
      var ssid = document.getElementById('hotSsid');
      var pass = document.getElementById('hotPass');
      hotSsid = ssid ? ssid.value : '';
      hotPass = pass ? pass.value : '';
      paintHostQr();
      return;
    }
    if (form.id !== 'name-form') return;
    event.preventDefault();
    submitName();
  });

  app.addEventListener('input', function (event) {
    var el = event.target;
    if (!el) return;
    if (el.id === 'name-input') {
      draft.query = el.value;
      var box = document.getElementById('name-suggest');
      if (box) box.innerHTML = suggestHtml(draft.query);
    } else if (el.id === 'last-input') draft.last = el.value;
  });

  var gearBtn = document.getElementById('gear-btn');
  var settingsPanel = document.getElementById('settings-panel');
  if (gearBtn) gearBtn.addEventListener('click', function () {
    syncSettings();
    settingsPanel.hidden = false;
  });
  document.getElementById('settings-close').addEventListener('click', function () {
    settingsPanel.hidden = true;
  });
  document.getElementById('set-tell').addEventListener('click', function () {
    if (isGuest()) return;
    act({ type: 'toggle-self-tell' });
  });
  document.getElementById('set-wolf').addEventListener('click', function () {
    if (isGuest()) return;
    act({ type: 'toggle-wolf-action' });
  });
  document.getElementById('set-amor').addEventListener('click', function () {
    if (isGuest()) return;
    act({ type: 'toggle-quick-amor' });
  });

  var bugBtn = document.getElementById('bug-btn');
  var bugPanel = document.getElementById('bug-panel');
  var bugText = document.getElementById('bug-text');
  var bugStatus = document.getElementById('bug-status');
  function putReport(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        bugStatus.textContent = 'Kopiert. Du kannst den Text einfügen.';
      }, function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }
  if (bugBtn && bugPanel && bugText && bugStatus) {
  bugBtn.addEventListener('click', function () {
    bugPanel.hidden = false;
    bugStatus.textContent = '';
    if (!isGuest()) {
      W.note(state, 'Fehlerbericht geöffnet');
      persist();
    }
  });
  document.getElementById('bug-close').addEventListener('click', function () {
    bugPanel.hidden = true;
    if (!isGuest()) {
      W.note(state, 'Fehlerbericht geschlossen');
      persist();
    }
  });
  document.getElementById('bug-copy').addEventListener('click', function () {
    var description = bugText.value;
    function finish(text) {
      if (!text) {
        bugStatus.textContent = 'Der Host hat keinen Bericht geschickt.';
        return;
      }
      if (!isGuest()) {
        W.note(state, 'Fehlerbericht kopiert');
        persist();
      }
      putReport(text);
    }
    if (isGuest() && window.WerwolfNet && window.WerwolfNet.requestReport) {
      bugStatus.textContent = 'Hole den Bericht vom Host …';
      window.WerwolfNet.requestReport(description).then(finish);
      return;
    }
    var actions = window.WerwolfNet && window.WerwolfNet.guestActions ? window.WerwolfNet.guestActions() : [];
    finish(W.report(state, description, actions));
  });
  }

  function fallbackCopy(text) {
    bugText.value = text;
    bugText.focus();
    bugText.select();
    bugStatus.textContent = 'Markiert. Bitte manuell kopieren.';
  }

  window.addEventListener('error', function (event) {
    if (!state || !saveReady) return;
    W.note(state, 'Fehler ' + event.message + '\n' + (event.error && event.error.stack ? event.error.stack : ''));
    persist();
  });
  window.addEventListener('unhandledrejection', function (event) {
    if (!state || !saveReady) return;
    var reason = event.reason;
    W.note(state, 'Fehler ' + (reason && reason.message ? reason.message : reason) + '\n' + (reason && reason.stack ? reason.stack : ''));
    persist();
  });

  function onNet() {
    if (!isGuest()) {
      ensureGrid();
      if (state && (state.screen === 'lobby' || state.screen === 'setup')) ensureSetup();
      rememberSetup();
      applyScores();
      persist();
    }
    render();
  }

  window.addEventListener('openscr-shell', function (event) {
    var page = event.detail === 'qr' || event.detail === 'options' ? event.detail : 'index';
    if (page === shell) return;
    postShell(page);
    render();
  });

  async function boot() {
    console.log('[werwolf] boot', bridgePlayers() ? 'mit gemeinsamer Namensliste' : 'ohne Namensbrücke');
    var guestBoot = !!(window.WerwolfNet && window.WerwolfNet.browserGuest && window.WerwolfNet.browserGuest());
    if (window.WerwolfNet && window.WerwolfNet.available && window.WerwolfNet.available()) {
      window.WerwolfNet.hold(true);
      window.WerwolfNet.attach({
        apply: function (game, action) { return W.send(game, action); },
        getState: function () { return state; },
        setState: function (next) { state = next; },
        createPlayer: function (info, done) {
          var first = String((info && info.first) || '').trim().slice(0, 16);
          var last = String((info && info.last) || '').trim().slice(0, 5);
          var bridge = bridgePlayers();
          if (bridge) {
            bridge.add({ name: first, tag: last }).then(function (created) {
              var player = asRiot(created);
              roster.players.push(player);
              done({ pid: player.id, first: player.first, last: player.last, tag: player.tag, name: player.first + ' #' + player.tag });
            }, function (error) { done(null, error); });
            return;
          }
          try {
            var player = P.registerPlayer(roster, first, last, Date.now(), Math.random);
            done({ pid: player.id, first: player.first, last: player.last, name: player.first });
          } catch (error) {
            done(null, error);
          }
        },
        takeLibrary: function (lib) {
          if (!lib) return;
          if (lib.roster) roster = loadRoster(lib.roster);
          if (lib.scores && typeof lib.scores === 'object') scores = lib.scores;
          if (lib.history) history = loadHistory(lib.history);
        },
        after: function () { ensureGrid(); },
        changed: onNet
      });
      try {
        var resumed = await window.WerwolfNet.resume();
        guestBoot = guestBoot || !!(resumed && resumed.role === 'guest');
      } catch (error) { guestBoot = false; }
    }
    if (guestBoot) {
      if (!state || !state.remote) {
        state = { v: 1, screen: 'wait', players: [], remote: true, waitText: 'Verbinden …' };
      }
      booting = false;
      saveReady = true;
      window.WerwolfNet.hold(false);
      render();
      return;
    }
    scores = W.grantPoints(await readKey(SCORE_KEY), []);
    roster = loadRoster(await readKey(PLAYERS_KEY));
    var shared = bridgePlayers();
    if (shared) {
      try {
        console.log('[werwolf] players.list');
        var listed = await shared.list();
        console.log('[werwolf] players.list fertig', listed && listed.length);
        roster = { v: 1, players: (listed || []).map(asRiot).filter(function (player) { return player.id && player.name && player.tag; }) };
      } catch (error) {
        console.error('[werwolf] players.list fehlgeschlagen', error && error.message ? error.message : error);
      }
    }
    history = loadHistory(await readKey(HISTORY_KEY));
    savedSetup = await readKey(SETUP_KEY);
    var savedGame = await readKey(GAME_KEY);
    var savedLobby = await readKey(LOBBY_KEY);
    if (savedGame && savedGame.screen && savedGame.screen !== 'lobby' && savedGame.players) {
      state = savedGame;
      if (!state.log) state.log = [];
      if (!state.selection) state.selection = [];
      if (!state.bonds) state.bonds = [];
      W.adoptSaved(state);
      attachIdentities(false);
    } else if (savedLobby && savedLobby.players) {
      state = W.newLobby();
      state.players = savedLobby.players;
      state.nextId = savedLobby.nextId || (state.players.length + 1);
      state.log = savedLobby.log || [];
      attachIdentities(true);
    }
    if (state && (state.screen === 'lobby' || state.screen === 'setup')) {
      state.selfTell = !!(savedSetup && savedSetup.selfTell);
      state.showWolfAction = !!(savedSetup && savedSetup.showWolfAction === true);
      state.quickAmor = !savedSetup || savedSetup.quickAmor !== false;
      state.legacyWitch = !savedSetup || savedSetup.legacyWitch !== false;
      state.wolfCall = !!(savedSetup && savedSetup.wolfCall);
      if (savedSetup && 'seerExact' in savedSetup) state.seerExact = !!savedSetup.seerExact;
      if (savedSetup && 'rolePool' in savedSetup) state.rolePool = !!savedSetup.rolePool;
      if (savedSetup && savedSetup.counts) state.counts = JSON.parse(JSON.stringify(savedSetup.counts));
      if (savedSetup && savedSetup.nachUses != null) state.nachUses = savedSetup.nachUses;
      if (savedSetup && savedSetup.osirisUses != null) state.osirisUses = savedSetup.osirisUses;
      if (savedSetup && savedSetup.healPotions != null) state.healPotions = savedSetup.healPotions;
      if (savedSetup && savedSetup.wolfMin != null) state.wolfMin = savedSetup.wolfMin;
      if (savedSetup && savedSetup.wolfMax != null) state.wolfMax = savedSetup.wolfMax;
      if (state.screen === 'setup') state.screen = 'lobby';
    }
    ensureGrid();
    booting = false;
    saveReady = true;
    applyScores();
    persist();
    if (window.WerwolfNet && window.WerwolfNet.hold) window.WerwolfNet.hold(false);
    render();
  }

  boot();
})();
