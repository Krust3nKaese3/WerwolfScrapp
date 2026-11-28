/* Lokaler Mehrspieler. Transport ist die Multiplayer-Bridge (native oder Browser-Shim).
   Dieselbe Oberfläche: host, join, send, broadcast, Events. Kein eigener Socket, kein eigener QR-Code.
   Gäste nutzen nur diese API, keinen Speicher und keine anderen nativen Aufrufe.
   Der Host rechnet, speichert und hält optional den Bildschirm wach, wenn keepAwake da ist.
   Kartenraster: Spaltenzahl einmal zur Referenz Pixel 7, Größe je Bildschirm.
   Mindestkante anpassen: GRID_MIN_CARD. */
(function (root) {
  var GRID_REF_WIDTH = 412;
  var GRID_REF_HEIGHT = 915;
  var GRID_MIN_CARD = 96;
  var GRID_GAP = 10;
  var GRID_PAD = 32;
  var GRID_CHROME = 340;
  var MAX_PLAYERS = 16;

  function naturalCard(count, cols, width, height) {
    var rows = Math.max(1, Math.ceil((count || 1) / cols));
    var innerW = width - GRID_PAD;
    var innerH = height - GRID_CHROME;
    var byW = (innerW - GRID_GAP * (cols - 1)) / cols;
    var byH = (innerH - GRID_GAP * (rows - 1)) / rows;
    return Math.min(byW, byH);
  }

  function gridColumns(count, width, height) {
    width = width || GRID_REF_WIDTH;
    height = height || GRID_REF_HEIGHT;
    if (naturalCard(count, 2, width, height) >= GRID_MIN_CARD) return 2;
    return 3;
  }

  function cardEdge(count, cols, width, height) {
    width = width || GRID_REF_WIDTH;
    height = height || GRID_REF_HEIGHT;
    var size = naturalCard(count, cols, width, height);
    if (size >= GRID_MIN_CARD) return { size: Math.floor(size), scroll: false };
    return { size: GRID_MIN_CARD, scroll: true };
  }

  function sortPlayers(players) {
    return (players || []).slice().sort(function (a, b) {
      var cmp = String(a.name || '').localeCompare(String(b.name || ''), 'de', { sensitivity: 'base' });
      if (cmp) return cmp;
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
  }

  function nameSize(name) {
    var n = String(name || '').length;
    if (n <= 10) return 20;
    if (n <= 14) return 16;
    if (n <= 18) return 14;
    if (n <= 24) return 12;
    return 11;
  }

  var wakeHeld = false;
    var actionLog = [];
    var reportWait = null;

    function actionBrief(action) {
      action = action || {};
      var bits = [String(action.type || '?')];
      ['id', 'role', 'value', 'name', 'first', 'last', 'tag', 'pid'].forEach(function (key) {
        if (action[key] != null && action[key] !== '') bits.push(key + '=' + action[key]);
      });
      return bits.join(' ').slice(0, 240);
    }

    function trace(from, action, result) {
      if (!from || from === selfId) return;
      actionLog.push({ t: Date.now(), from: String(from).slice(0, 12), action: actionBrief(action), result: String(result || '') });
      if (actionLog.length > 200) actionLog.splice(0, actionLog.length - 200);
    }

    var holdPublish = false;

  function bridgeObject() {
    return root.OpenScrBridge || root.EveryAppBridge || null;
  }

  function keepAwakeApi() {
    var bridge = bridgeObject();
    var ka = bridge && bridge.keepAwake;
    if (!ka) return null;
    if (typeof ka.acquire === 'function' && typeof ka.release === 'function') return ka;
    if (typeof ka.start === 'function' && typeof ka.stop === 'function') {
      return { acquire: function () { return ka.start(); }, release: function () { return ka.stop(); } };
    }
    if (typeof ka === 'function') {
      return { acquire: function () { return ka(true); }, release: function () { return ka(false); } };
    }
    return null;
  }

  function syncWake(state, role) {
    if (role !== 'host') return;
    var api = keepAwakeApi();
    if (!api) return;
    var playing = !!(state && state.screen && state.screen !== 'lobby' && state.screen !== 'setup' && state.screen !== 'wait');
    if (playing && !wakeHeld) {
      wakeHeld = true;
      try { api.acquire(); } catch (error) { wakeHeld = false; }
      return;
    }
    if (!playing && wakeHeld) {
      wakeHeld = false;
      try { api.release(); } catch (error) { /* optional */ }
    }
  }

  function browserGuest() {
    var bridge = bridgeObject();
    return !!(bridge && bridge.guest === true);
  }

  function qrButtons(mp) {
    var buttons = [];
    if (!mp || browserGuest()) return buttons;
    if (typeof mp.showQr === 'function') buttons.push({ fn: 'showQr', label: 'QR-Code' });
    if (typeof mp.showWifiQr === 'function') buttons.push({ fn: 'showWifiQr', label: 'WLAN-QR' });
    if (typeof mp.showHotspotQr === 'function') buttons.push({ fn: 'showHotspotQr', label: 'Hotspot-QR' });
    if (typeof mp.showGameQr === 'function') buttons.push({ fn: 'showGameQr', label: 'Spiel-QR' });
    return buttons;
  }

  function stampGrid(state) {
    if (!state || state.screen === 'lobby' || state.screen === 'setup') return;
    if (state.gridCols === 2 || state.gridCols === 3) return;
    state.gridCols = gridColumns((state.players || []).length);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function playerOf(state, id) {
    var players = (state && state.players) || [];
    for (var i = 0; i < players.length; i++) {
      if (Number(players[i].id) === Number(id)) return players[i];
    }
    return null;
  }

  function blankSeat(p) {
    p.role = '';
    p.healsLeft = 0;
    p.poisonLeft = false;
    p.stealUsed = false;
    p.nachLeft = 0;
    p.schaufelUsed = false;
    p.osirisLeft = 0;
    p.oracleLast = null;
    p.russeUsed = false;
    p.hunterShot = false;
    p.amorPair = null;
    p.amorLinked = false;
    p.loverIds = [];
    p.notice = null;
  }

  function finishedIds(state) {
    var W = root.Werwolf;
    if (!state || !state.players) return [];
    if (state.screen === 'reveal' && W && W.revealDone) {
      return state.players.filter(function (p) { return W.revealDone(state, p); }).map(function (p) { return p.id; });
    }
    if (state.screen === 'night') return (state.nightDone || []).slice();
    if (state.screen === 'vote') return (state.voteDone || []).slice();
    if (state.screen === 'hunter') {
      var pending = {};
      (state.hunters || []).forEach(function (id) { pending[id] = true; });
      return state.players.map(function (p) { return p.id; }).filter(function (id) { return !pending[id]; });
    }
    return [];
  }

  function stripBag(copy, keepPlay) {
    delete copy.log;
    delete copy.book;
    delete copy.dealt;
    delete copy.roleCards;
    delete copy.peeked;
    delete copy.pendingThefts;
    delete copy.copyHexes;
    delete copy.extraAttacks;
    delete copy.pendingRevives;
    delete copy.pendingDuels;
    delete copy.lastTally;
    delete copy._rng;
    if (!keepPlay) {
      delete copy.wolfVotes;
      delete copy.votes;
      delete copy.heals;
      delete copy.poisons;
      delete copy.hosts;
      delete copy.prompts;
      delete copy.selection;
      delete copy.seenLove;
      delete copy.bonds;
    }
    if (copy.config) {
      copy.config = {
        showWolfAction: !!copy.config.showWolfAction,
        selfTell: !!copy.config.selfTell,
        quickAmor: copy.config.quickAmor !== false
      };
    }
  }

  function publicState(state, locks) {
    var W = root.Werwolf;
    var copy = clone(state);
    var ended = copy.screen === 'end';
    var pending = [];
    if (!ended && copy.screen === 'reveal' && W && W.pendingNames) pending = W.pendingNames(state).slice();
    var done = finishedIds(state);
    stripBag(copy, false);
    copy.russePossible = !!(state.counts && state.counts.russe);
    if (copy.screen === 'night') delete copy.osirisMorning;
    if (copy.screen === 'announce' && copy.announce && copy.announce.title === 'Abstimmung') {
      copy.lastTally = clone(state.lastTally || {});
    }
    if (!ended) {
      (copy.players || []).forEach(blankSeat);
      if (copy.screen !== 'lobby') delete copy.counts;
    }
    if (copy.screen === 'setup') {
      copy.screen = 'wait';
      copy.waitText = 'Der Host richtet die Rollen ein.';
    }
    if (!ended && copy.selfTell && copy.screen !== 'announce' && copy.screen !== 'lobby' && copy.screen !== 'wait') {
      copy.screen = 'discuss';
      copy.remoteNarrator = true;
      copy.step = 'list';
      copy.activeId = null;
    } else if (!ended && (copy.step === 'confirm' || copy.step === 'show' || copy.step === 'ready' || copy.step === 'link' || copy.step === 'love' || copy.step === 'handoff')) {
      copy.step = 'list';
      copy.activeId = null;
      copy.actorId = null;
    }
    copy.remote = true;
    if (copy.screen === 'lobby' && typeof root.WerwolfLibrary === 'function') {
      copy.library = clone(root.WerwolfLibrary());
    }
    copy.lockMap = clone(locks || {});
    copy.finishedIds = done;
    copy.pendingNamesPublic = pending;
    if (copy.screen !== 'lobby') copy.error = '';
    delete copy.wolfVotes;
    delete copy.wolfPack;
    return copy;
  }

  function keepIds(preview, seatId) {
    var keep = {};
    keep[Number(seatId)] = true;
    var me = playerOf(preview, seatId);
    if (!me) return keep;
    (me.loverIds || []).forEach(function (id) { keep[Number(id)] = true; });
    (me.amorPair || []).forEach(function (id) { keep[Number(id)] = true; });
    if (me.role === 'werwolf') {
      (preview.players || []).forEach(function (p) {
        if (p.role === 'werwolf') keep[Number(p.id)] = true;
      });
    }
    var prompt = preview.prompts && preview.prompts[preview.promptIndex || 0];
    if (prompt && prompt.seenId != null) keep[Number(prompt.seenId)] = 'name';
    return keep;
  }

  function privateState(preview, seatId) {
    var copy = clone(preview);
    stripBag(copy, true);
    delete copy.counts;
    var keep = keepIds(preview, seatId);
    (copy.players || []).forEach(function (p) {
      var flag = keep[Number(p.id)];
      if (flag === 'name') {
        var role = p.role;
        blankSeat(p);
        var prompt = copy.prompts && copy.prompts[copy.promptIndex || 0];
        if (prompt && Number(prompt.seenId) === Number(p.id)) prompt.role = prompt.role || role;
        return;
      }
      if (!flag) blankSeat(p);
    });
    if (copy.screen === 'reveal' && copy.step === 'confirm') {
      (copy.players || []).forEach(blankSeat);
    }
    copy.remoteHold = true;
    copy.error = preview.error || '';
    delete copy.wolfVotes;
    delete copy.wolfPack;
    return copy;
  }

  function openAction(state, seatId) {
    if (state.screen === 'reveal') return { type: 'reveal-pick', id: seatId };
    if (state.screen === 'night') return { type: 'night-pick', id: seatId };
    if (state.screen === 'vote') return { type: 'vote-pick', id: seatId };
    if (state.screen === 'hunter') return { type: 'hunter-pick', id: seatId };
    if (state.screen === 'duel') return { type: 'duel-pick', id: seatId };
    return null;
  }

  function canOpen(state, seatId) {
    var W = root.Werwolf;
    var p = playerOf(state, seatId);
    if (!p || !state) return false;
    if (state.selfTell) return false;
    if (state.screen === 'reveal' && (state.step === 'list' || !state.step)) return true;
    if (state.screen === 'night' && state.step === 'list') {
      if (!p.alive) return false;
      if ((state.nightDone || []).indexOf(p.id) >= 0) return false;
      if (W && W.nightWaitsForAmor && W.nightWaitsForAmor(state) && p.role !== 'amor') return false;
      return true;
    }
    if (state.screen === 'vote' && state.step === 'list') {
      return !!p.alive && (state.voteDone || []).indexOf(p.id) < 0;
    }
    if (state.screen === 'hunter' && (state.step === 'list' || state.step === 'handoff')) {
      return (state.hunters || []).indexOf(p.id) >= 0;
    }
    if (state.screen === 'duel' && state.duel && state.duel.stage === 'who') return !!p.alive;
    return false;
  }

  function seatSettled(auth, preview, seatId) {
    var W = root.Werwolf;
    if (!preview) return false;
    if (preview.screen !== auth.screen) return true;
    if (auth.screen === 'night') return (preview.nightDone || []).indexOf(seatId) >= 0;
    if (auth.screen === 'vote') return (preview.voteDone || []).indexOf(seatId) >= 0;
    if (auth.screen === 'reveal') {
      var person = playerOf(preview, seatId);
      return !!(W && W.revealDone && W.revealDone(preview, person));
    }
    if (auth.screen === 'hunter') return (preview.hunters || []).indexOf(seatId) < 0;
    if (auth.screen === 'duel') return preview.screen !== 'duel';
    return false;
  }

  var CLAIM = { 'reveal-pick': 1, 'night-pick': 1, 'vote-pick': 1, 'hunter-pick': 1, 'duel-pick': 1 };
  var TURN = { go: 1, back: 1, ack: 1, confirm: 1, select: 1, skip: 1, cancel: 1, 'reveal-see': 1, 'oracle-role': 1 };
  var GUEST_GLOBAL = {
    'start-game': 1, ack: 1, 'to-vote': 1, 'to-duel': 1, cancel: 1,
    'add-name': 1, 'add-player': 1, deal: 1,
    'set-count': 1, 'set-nach': 1, 'set-osiris': 1, 'set-oracle': 1, 'set-heals': 1, 'set-wolf-min': 1, 'set-wolf-max': 1,
    'toggle-seer': 1, 'toggle-wolf-action': 1, 'toggle-quick-amor': 1, 'toggle-self-tell': 1, 'toggle-legacy-witch': 1, 'toggle-wolf-call': 1,
    'toggle-pool': 1, suggest: 1
  };

  function createSession(mp, hooks) {
    var role = 'off';
    var selfId = null;
    var roomCode = '';
    var players = [];
    var locks = {};
    var holds = {};
    var deviceSeat = {};
    var requests = [];
    var rooms = [];
    var away = false;
    var awayText = '';
    var lastPub = null;
    var holding = false;
    var qrPayload = '';
    var actionLog = [];
    var reportWait = null;
    var hostPack = { votes: [], picks: [] };
    var packTimer = null;
    var PACK_MS = 150;

    function actionBrief(action) {
      action = action || {};
      var bits = [String(action.type || '?')];
      ['id', 'role', 'value', 'name', 'first', 'last', 'tag', 'pid'].forEach(function (key) {
        if (action[key] != null && action[key] !== '') bits.push(key + '=' + action[key]);
      });
      return bits.join(' ').slice(0, 240);
    }

    function trace(from, action, result) {
      if (!from || from === selfId) return;
      actionLog.push({ t: Date.now(), from: String(from).slice(0, 12), action: actionBrief(action), result: String(result || '') });
      if (actionLog.length > 200) actionLog.splice(0, actionLog.length - 200);
    }

    function auth() { return hooks.getState(); }

    function ping() {
      if (role === 'host') syncWake(auth(), 'host');
      if (hooks.changed) hooks.changed();
    }

    function applied() {
      if (hooks.after) hooks.after();
      publish();
      flushPack();
    }

    function done(opts) {
      publish(opts);
      ping();
    }

    function sendTo(deviceId, data) {
      if (!mp || !deviceId || deviceId === selfId) return;
      return mp.send(data, { to: deviceId });
    }

    function broadcast(data) {
      if (!mp || role !== 'host') return;
      return mp.broadcast(data);
    }

    function previewOf(seatId) {
      var base = clone(auth());
      var open = openAction(base, seatId);
      if (!open) return base;
      hooks.apply(base, open);
      (holds[seatId].actions || []).forEach(function (action) { hooks.apply(base, action); });
      return base;
    }

    function wolfChoosing(preview) {
      if (!preview || preview.step !== 'show' || preview.selfTell) return false;
      var prompt = preview.prompts && preview.prompts[preview.promptIndex || 0];
      if (!prompt || prompt.kind !== 'wolf') return false;
      var actor = playerOf(preview, preview.activeId);
      return !!(actor && actor.role === 'werwolf');
    }

    function collectPack() {
      var game = auth() || {};
      var votes = {};
      var picks = {};
      Object.keys(game.wolfVotes || {}).forEach(function (id) {
        var target = Number(game.wolfVotes[id]);
        if (target) votes[Number(id)] = target;
      });
      Object.keys(holds).forEach(function (key) {
        var seatId = Number(key);
        var preview = previewOf(seatId);
        if (!wolfChoosing(preview)) return;
        if (preview.wolfVotes && preview.wolfVotes[seatId] != null) votes[seatId] = Number(preview.wolfVotes[seatId]);
        var sel = preview.selection && preview.selection.length === 1 ? Number(preview.selection[0]) : 0;
        if (sel && votes[seatId] == null) picks[seatId] = sel;
      });
      return { votes: votes, picks: picks };
    }

    function packRows(raw, seatId) {
      var game = auth() || {};
      function rows(map) {
        return Object.keys(map || {}).filter(function (id) {
          return Number(id) !== Number(seatId);
        }).map(function (id) {
          var wolf = playerOf(game, id);
          return wolf && wolf.name ? { name: wolf.name, targetId: Number(map[id]) } : null;
        }).filter(function (row) { return row && row.targetId; });
      }
      return { votes: rows(raw.votes), picks: rows(raw.picks) };
    }

    function attachPack(copy, seatId, raw) {
      delete copy.wolfVotes;
      delete copy.wolfPack;
      if (!wolfChoosing(copy)) return;
      copy.wolfPack = packRows(raw, seatId);
    }

    function rememberHost(raw) {
      var seat = deviceSeat[selfId];
      if (seat == null) {
        hostPack = { votes: [], picks: [] };
        return;
      }
      var preview = previewOf(seat);
      if (!wolfChoosing(preview)) {
        hostPack = { votes: [], picks: [] };
        return;
      }
      hostPack = packRows(raw, seat);
    }

    function deliverPack() {
      if (role !== 'host') return;
      var raw = collectPack();
      rememberHost(raw);
      Object.keys(holds).forEach(function (key) {
        var seatId = Number(key);
        var deviceId = holds[key].deviceId;
        if (!deviceId || deviceId === selfId) return;
        var preview = previewOf(seatId);
        if (!wolfChoosing(preview)) return;
        sendTo(deviceId, { t: 'pack', pack: packRows(raw, seatId) });
      });
    }

    function flushPack() {
      if (packTimer) {
        clearTimeout(packTimer);
        packTimer = null;
      }
      deliverPack();
      ping();
    }

    function schedulePack() {
      if (packTimer) return;
      packTimer = setTimeout(function () {
        packTimer = null;
        deliverPack();
        ping();
      }, PACK_MS);
    }

    function publish(opts) {
      if (role !== 'host') return;
      opts = opts || {};
      stampGrid(auth());
      var pub = publicState(auth(), locks);
      broadcast({ t: 'pub', state: pub });
      var raw = collectPack();
      Object.keys(holds).forEach(function (key) {
        var seatId = Number(key);
        if (opts.onlySeat != null && seatId !== Number(opts.onlySeat)) return;
        var deviceId = holds[key].deviceId;
        if (deviceId === selfId) return;
        var priv = privateState(previewOf(seatId), seatId);
        attachPack(priv, seatId, raw);
        sendTo(deviceId, { t: 'priv', state: priv });
      });
    }

    function clearDevice(deviceId) {
      var seat = deviceSeat[deviceId];
      if (seat == null) return;
      delete holds[seat];
      delete locks[seat];
      delete deviceSeat[deviceId];
      sendTo(deviceId, { t: 'clear' });
    }

    function releaseDevice(deviceId) {
      clearDevice(deviceId);
    }

    function claim(deviceId, seatId) {
      seatId = Number(seatId);
      if (locks[seatId] && locks[seatId] !== deviceId) {
        sendTo(deviceId, { t: 'busy', message: 'belegt' });
        return { busy: true };
      }
      if (!canOpen(auth(), seatId)) {
        var blocked = playerOf(auth(), seatId);
        var waiting = root.Werwolf && root.Werwolf.nightWaitsForAmor && root.Werwolf.nightWaitsForAmor(auth());
        var message = waiting && blocked && blocked.role !== 'amor' ? 'Noch nicht dran.' : 'belegt';
        sendTo(deviceId, { t: 'busy', message: message });
        return { busy: true };
      }
      if (deviceSeat[deviceId] != null && Number(deviceSeat[deviceId]) !== seatId) clearDevice(deviceId);
      locks[seatId] = deviceId;
      deviceSeat[deviceId] = seatId;
      holds[seatId] = { deviceId: deviceId, actions: [] };
      done();
      return { ok: true };
    }

    function commit(seatId) {
      var hold = holds[seatId];
      if (!hold) return;
      var actions = hold.actions.slice();
      var deviceId = hold.deviceId;
      var state = auth();
      var open = openAction(state, seatId);
      if (open) hooks.apply(state, open);
      actions.forEach(function (action) { hooks.apply(state, action); });
      delete holds[seatId];
      delete locks[seatId];
      delete deviceSeat[deviceId];
      sendTo(deviceId, { t: 'clear' });
    }

    function pushTurn(deviceId, action) {
      var seatId = deviceSeat[deviceId];
      if (seatId == null || !holds[seatId]) return;
      holds[seatId].actions.push(action);
      var preview = previewOf(seatId);
      var backToList = action.type === 'back' && (preview.step === 'list' || preview.screen === 'discuss') && !seatSettled(auth(), preview, seatId);
      if (action.type === 'cancel' && preview.screen !== 'duel') backToList = true;
      if (backToList) {
        clearDevice(deviceId);
        flushPack();
        done();
        return;
      }
      if (seatSettled(auth(), preview, seatId)) {
        commit(seatId);
        applied();
        return;
      }
      var livePick = action.type === 'select' && wolfChoosing(preview) && preview.selection && preview.selection.length === 1;
      if (livePick) {
        done({ onlySeat: seatId });
        schedulePack();
        return;
      }
      done({ onlySeat: seatId });
      flushPack();
    }

    function onLocal(deviceId, action) {
      action = action || {};
      if (role === 'guest') {
        if (CLAIM[action.type]) mp.send({ t: 'claim', seat: Number(action.id) });
        else if (holding && TURN[action.type]) mp.send({ t: 'act', action: action });
        else if (GUEST_GLOBAL[action.type]) mp.send({ t: 'phase', action: action });
        return;
      }
      if (role !== 'host') return;
      if (auth().selfTell && deviceId !== selfId && auth().screen !== 'lobby' && action.type !== 'to-duel') {
        trace(deviceId, action, 'abgelehnt, Erzähler');
        done();
        return;
      }
      if (action.type === 'add-player' && action.create && hooks.createPlayer) {
        hooks.createPlayer(action, function (info, error) {
          var game = auth();
          if (!game) return;
          if (!info) {
            trace(deviceId, action, 'abgelehnt, ' + ((error && error.message) || 'nicht gespeichert'));
            game.error = (error && error.message) || 'Der Name konnte nicht gespeichert werden.';
            done();
            return;
          }
          trace(deviceId, action, 'angewandt');
          hooks.apply(game, {
            type: 'add-player',
            pid: info.pid,
            first: info.first,
            last: info.last,
            tag: info.tag || '',
            name: info.name
          });
          applied();
        });
        return;
      }
      if (auth().selfTell && deviceId === selfId) {
        hooks.apply(auth(), action);
        applied();
        return;
      }
      if (CLAIM[action.type]) {
        trace(deviceId, action, 'Anspruch');
        claim(deviceId, action.id);
        return;
      }
      if (TURN[action.type] && deviceSeat[deviceId] != null) {
        trace(deviceId, action, 'Zug');
        pushTurn(deviceId, action);
        return;
      }
      if (deviceId !== selfId && !GUEST_GLOBAL[action.type]) {
        trace(deviceId, action, 'abgelehnt, nicht erlaubt');
        return;
      }
      trace(deviceId, action, 'angewandt');
      var before = auth().screen;
      hooks.apply(auth(), action);
      if (auth().screen !== before) {
        Object.keys(deviceSeat).slice().forEach(function (id) { clearDevice(id); });
      }
      applied();
    }

    function ingest(message) {
      var data = message && message.data;
      if (!data || !data.t) return;
      if (role === 'host') {
        if (data.t === 'claim') claim(message.from, data.seat);
        else if (data.t === 'act') pushTurn(message.from, data.action || {});
        else if (data.t === 'release') {
          releaseDevice(message.from);
          done();
        } else if (data.t === 'phase') onLocal(message.from, data.action || {});
        else if (data.t === 'hello') done();
        else if (data.t === 'bug') {
          var text = root.Werwolf && root.Werwolf.report
            ? root.Werwolf.report(auth(), data.description || '', actionLog.slice())
            : '';
          sendTo(message.from, { t: 'bug-report', text: text });
        }
        return;
      }
      if (data.t === 'bug-report' && reportWait) {
        clearTimeout(reportWait.timer);
        var doneWait = reportWait.resolve;
        reportWait = null;
        doneWait(String(data.text || ''));
        return;
      }
      if (data.t === 'pub') {
        lastPub = data.state;
        away = false;
        if (data.state && data.state.library && hooks.takeLibrary) hooks.takeLibrary(data.state.library);
        if (data.state) delete data.state.library;
        if (!holding) hooks.setState(data.state);
        ping();
        return;
      }
      if (data.t === 'priv') {
        holding = true;
        hooks.setState(data.state);
        ping();
        return;
      }
      if (data.t === 'pack') {
        if (!holding) return;
        var current = hooks.getState();
        var prompt = current && current.prompts && current.prompts[current.promptIndex || 0];
        if (!current || current.step !== 'show' || !prompt || prompt.kind !== 'wolf') return;
        current.wolfPack = data.pack || { votes: [], picks: [] };
        hooks.setState(current);
        ping();
        return;
      }
      if (data.t === 'clear') {
        holding = false;
        if (lastPub) hooks.setState(lastPub);
        ping();
        return;
      }
      if (data.t === 'busy') {
        holding = false;
        var current = lastPub ? clone(lastPub) : hooks.getState();
        if (current) {
          current.error = data.message || 'belegt';
          hooks.setState(current);
        }
        ping();
      }
    }

    function bind() {
      mp.onMessage(ingest);
      mp.onPlayersChanged(function (roster) {
        players = (roster && roster.players) || [];
        if (roster && roster.selfId) selfId = roster.selfId;
        if (roster && roster.roomCode) roomCode = roster.roomCode;
        if (role === 'host') {
          players.forEach(function (person) {
            if (!person.connected && deviceSeat[person.id] != null) releaseDevice(person.id);
          });
          publish();
        }
        ping();
      });
      mp.onJoinRequest(function (request) {
        if (role !== 'host' || !request) return;
        requests = requests.filter(function (item) { return item.id !== request.id; });
        requests.push(request);
        ping();
      });
      mp.onHostAway(function (info) {
        away = true;
        awayText = (info && info.message) || 'Host ist kurz weg';
        ping();
      });
      mp.onResumed(function (info) { applyResume(info); });
    }

    function applyResume(info) {
      if (!info) return;
      role = info.role === 'host' ? 'host' : 'guest';
      selfId = info.selfId;
      roomCode = info.roomCode || roomCode;
      players = info.players || players;
      holding = false;
      away = info.status === 'hostAway';
      if (away) awayText = 'Host ist kurz weg';
      if (role === 'host') {
        away = false;
        if (holdPublish) { ping(); return; }
        done();
        return;
      }
      if (info.status === 'ready') mp.send({ t: 'hello' });
      ping();
    }

    bind();

    return {
      host: function () {
        if (browserGuest()) return Promise.reject(new Error('Im Browser ist nur die Gast-Ansicht da.'));
        return Promise.resolve(mp.host({
          maxPlayers: MAX_PLAYERS,
          name: 'Werwolf',
          discoverable: true,
          joinApproval: true
        })).then(function (room) {
          role = 'host';
          selfId = room.playerId;
          roomCode = room.roomCode;
          qrPayload = room.qrPayload || '';
          players = room.players || [];
          done();
          return room;
        });
      },
      joinRoom: function (roomId, name) {
        return Promise.resolve(mp.join({ room: roomId, name: name || 'Handy' })).then(function (room) {
          role = 'guest';
          selfId = room.playerId;
          roomCode = room.roomCode;
          players = room.players || [];
          mp.send({ t: 'hello' });
          ping();
          return room;
        });
      },
      joinQr: function (payload, name) {
        var input = payload ? payload : { scan: true, name: name || 'Handy' };
        if (payload && typeof payload === 'object') input = payload;
        if (typeof input === 'object' && !input.name) input.name = name || 'Handy';
        return Promise.resolve(mp.join(input)).then(function (room) {
          role = 'guest';
          selfId = room.playerId;
          roomCode = room.roomCode;
          players = room.players || [];
          mp.send({ t: 'hello' });
          ping();
          return room;
        });
      },
      discover: function () {
        return Promise.resolve(mp.discover({
          onRooms: function (list) {
            rooms = list || [];
            ping();
          }
        }));
      },
      stopDiscovery: function () {
        if (mp.stopDiscovery) return mp.stopDiscovery();
      },
      approve: function (id) {
        requests = requests.filter(function (item) { return item.id !== id; });
        ping();
        return mp.approveJoin(id);
      },
      deny: function (id) {
        requests = requests.filter(function (item) { return item.id !== id; });
        ping();
        return mp.denyJoin(id);
      },
      showQr: function (name) {
        var fn = name || 'showQr';
        if (!mp || typeof mp[fn] !== 'function') return Promise.resolve(null);
        return Promise.resolve(mp[fn]()).then(function (info) {
          if (info) {
            roomCode = info.roomCode || roomCode;
            qrPayload = info.qrPayload || qrPayload;
          }
          ping();
          return info;
        }, function () { return null; });
      },
      leave: function () {
        var was = role;
        role = 'off';
        holding = false;
        if (packTimer) {
          clearTimeout(packTimer);
          packTimer = null;
        }
        locks = {};
        holds = {};
        deviceSeat = {};
        if (was === 'host' && mp.endRoom) return mp.endRoom();
        if (mp.leave) return mp.leave();
      },
      resume: function () {
        return Promise.resolve(mp.resume()).then(function (info) {
          applyResume(info);
          return info;
        });
      },
      local: function (action) { onLocal(selfId, action); },
      guestActions: function () { return actionLog.slice(); },
      requestReport: function (description) {
        return new Promise(function (resolve) {
          if (role !== 'guest' || !mp) { resolve(''); return; }
          if (reportWait) clearTimeout(reportWait.timer);
          reportWait = {
            resolve: resolve,
            timer: setTimeout(function () { reportWait = null; resolve(''); }, 4000)
          };
          mp.send({ t: 'bug', description: String(description || '').slice(0, 2000) });
        });
      },
      actFrom: function (deviceId, action) { onLocal(deviceId, action); },
      display: function () {
        if (role !== 'host') return null;
        var seat = deviceSeat[selfId];
        if (seat == null || !holds[seat]) return null;
        var view = previewOf(seat);
        if (wolfChoosing(view)) view.wolfPack = clone(hostPack);
        return view;
      },
      role: function () { return role; },
      online: function () { return role === 'host' || role === 'guest'; },
      roomInfo: function () {
        if (role !== 'host' && role !== 'guest') return null;
        return {
          role: role,
          roomCode: roomCode,
          selfId: selfId,
          players: players,
          requests: requests.slice(),
          qrPayload: qrPayload,
          away: away,
          awayText: awayText
        };
      },
      rooms: function () { return rooms.slice(); },
      lockOwner: function (seatId) {
        if (role === 'guest') {
          var map = lastPub && lastPub.lockMap;
          return map ? map[seatId] || map[String(seatId)] || null : null;
        }
        return locks[Number(seatId)] || null;
      },
      selfId: function () { return selfId; },
      hostAway: function () { return away ? (awayText || 'Host ist kurz weg') : ''; },
      qrButtons: function () { return qrButtons(mp); },
      flush: function () { if (role === 'host') done(); }
    };
  }

  function bridgeMp() {
    var bridge = bridgeObject();
    var mp = bridge && bridge.multiplayer;
    if (!mp || typeof mp.onMessage !== 'function' || typeof mp.send !== 'function') return null;
    if (typeof mp.host !== 'function' && typeof mp.join !== 'function' && typeof mp.resume !== 'function') return null;
    return mp;
  }

  var live = null;

  function attach(hooks) {
    var mp = hooks.mp || bridgeMp();
    if (!mp) return null;
    live = createSession(mp, hooks);
    return live;
  }

  function createHub() {
    var seq = 1;
    var room = null;
    var devices = [];

    function roster() {
      if (!room) return [];
      return devices.filter(function (dev) { return dev.room && dev.joined; }).map(function (dev) {
        return { id: dev.id, name: dev.name, host: !!dev.host, connected: !!dev.connected };
      });
    }

    function emitPlayers() {
      var list = roster();
      devices.forEach(function (dev) {
        if (!dev.joined || dev.suspended) return;
        dev.handlers.players.forEach(function (cb) {
          cb({ players: list, selfId: dev.id, roomCode: room ? room.roomCode : '' });
        });
      });
    }

    function deliver(fromId, toId, data) {
      devices.forEach(function (dev) {
        if (dev.id !== toId || !dev.connected || dev.suspended) return;
        dev.handlers.message.forEach(function (cb) { cb({ from: fromId, data: data }); });
      });
    }

    function broadcast(fromId, data) {
      devices.forEach(function (dev) {
        if (!dev.joined || !dev.connected || dev.suspended || dev.id === fromId) return;
        dev.handlers.message.forEach(function (cb) { cb({ from: fromId, data: data }); });
      });
    }

    function make(name) {
      var dev = {
        id: 'd' + (seq++),
        name: name || 'Handy',
        host: false,
        connected: false,
        joined: false,
        room: false,
        handlers: { message: [], players: [], join: [], resumed: [], away: [] }
      };
      devices.push(dev);
      var api = {
        host: function (opts) {
          opts = opts || {};
          room = {
            id: 'room-1',
            roomCode: 'K7QP',
            qrPayload: 'openscr-mp://join?v=1&host=192.168.1.20&port=38421&room=K7QP&token=0123456789abcdef&app=WerwolfScrapp',
            hostId: dev.id,
            maxPlayers: opts.maxPlayers || 8,
            hostName: (opts.name || 'Werwolf').slice(0, 24),
            joinApproval: opts.joinApproval !== false
          };
          dev.host = true;
          dev.connected = true;
          dev.joined = true;
          dev.room = true;
          dev.name = room.hostName;
          emitPlayers();
          return Promise.resolve({
            roomCode: room.roomCode,
            qrPayload: room.qrPayload,
            playerId: dev.id,
            players: roster()
          });
        },
        join: function (input) {
          if (!room) return Promise.reject(new Error('kein Raum'));
          var scan = typeof input === 'string' || (input && (input.scan || input.payload || input.qrPayload));
          var requested = (input && input.name) || 'Handy';
          dev.name = String(requested).slice(0, 24);
          dev.host = false;
          dev.room = true;
          if (scan || !room.joinApproval) {
            dev.connected = true;
            dev.joined = true;
            emitPlayers();
            return Promise.resolve({ roomCode: room.roomCode, playerId: dev.id, players: roster() });
          }
          var request = { id: 'req' + (seq++), name: dev.name, roomCode: room.roomCode, hostName: room.hostName };
          return new Promise(function (resolve, reject) {
            request._resolve = function () {
              dev.connected = true;
              dev.joined = true;
              emitPlayers();
              resolve({ roomCode: room.roomCode, playerId: dev.id, players: roster() });
            };
            request._reject = function () {
              dev.room = false;
              reject(new Error('abgelehnt'));
            };
            devices.forEach(function (other) {
              if (!other.host) return;
              other.handlers.join.forEach(function (cb) { cb(request); });
            });
            dev._pending = request;
          });
        },
        send: function (data, opts) {
          if (dev.host) {
            if (!opts || !opts.to) return Promise.reject(new Error('to fehlt'));
            deliver(dev.id, opts.to, data);
          } else deliver(dev.id, room.hostId, data);
          return Promise.resolve({ seq: seq++ });
        },
        broadcast: function (data) {
          if (!dev.host) return Promise.reject(new Error('nur Host'));
          broadcast(dev.id, data);
          return Promise.resolve({ seq: seq++ });
        },
        onMessage: function (cb) { dev.handlers.message.push(cb); return function () {}; },
        onPlayersChanged: function (cb) { dev.handlers.players.push(cb); return function () {}; },
        onJoinRequest: function (cb) { dev.handlers.join.push(cb); return function () {}; },
        onResumed: function (cb) { dev.handlers.resumed.push(cb); return function () {}; },
        onHostAway: function (cb) { dev.handlers.away.push(cb); return function () {}; },
        approveJoin: function (id) {
          if (dev._seen) { /* host stores on request object via closure of guest */ }
          devices.forEach(function (other) {
            if (other._pending && other._pending.id === id && other._pending._resolve) other._pending._resolve();
          });
          return Promise.resolve({ approved: true });
        },
        denyJoin: function (id) {
          devices.forEach(function (other) {
            if (other._pending && other._pending.id === id && other._pending._reject) other._pending._reject();
          });
          return Promise.resolve({ denied: true });
        },
        leave: function () {
          dev.joined = false;
          dev.connected = false;
          dev.room = false;
          emitPlayers();
          return Promise.resolve({ left: true });
        },
        endRoom: function () {
          devices.forEach(function (other) {
            other.joined = false;
            other.connected = false;
            other.room = false;
          });
          room = null;
          return Promise.resolve({ ended: true });
        },
        showQr: function () {
          return Promise.resolve({ roomCode: room.roomCode, qrPayload: room.qrPayload });
        },
        discover: function (opts) {
          var list = [];
          if (room) {
            list.push({
              id: room.id,
              roomCode: room.roomCode,
              hostName: room.hostName,
              players: roster().length,
              maxPlayers: room.maxPlayers
            });
          }
          if (opts && opts.onRooms) opts.onRooms(list);
          return Promise.resolve({ started: true });
        },
        stopDiscovery: function () { return Promise.resolve({ stopped: true }); },
        setDiscoverable: function (on) { return Promise.resolve({ discoverable: !!on }); },
        resume: function () {
          if (!dev.room && !dev.joined && !(room && dev.host)) {
            return Promise.resolve(null);
          }
          var hostDev = null;
          devices.forEach(function (other) { if (other.host) hostDev = other; });
          var status = hostDev && hostDev.connected ? 'ready' : 'hostAway';
          if (dev.host) status = 'ready';
          var info = {
            role: dev.host ? 'host' : 'guest',
            roomCode: room ? room.roomCode : '',
            selfId: dev.id,
            players: roster(),
            status: status
          };
          dev.connected = true;
          if (!dev.joined) dev.joined = true;
          dev.suspended = false;
          dev.handlers.resumed.forEach(function (cb) { cb(info); });
          emitPlayers();
          return Promise.resolve(info);
        }
      };
      api._disconnect = function () {
        dev.connected = false;
        dev.suspended = true;
        if (dev.host) {
          devices.forEach(function (other) {
            if (other.host || !other.joined) return;
            other.handlers.away.forEach(function (cb) {
              cb({ roomCode: room.roomCode, message: 'Host ist kurz weg' });
            });
          });
        }
        emitPlayers();
      };
      api._id = function () { return dev.id; };
      return api;
    }

    return { device: make };
  }

  root.WerwolfNet = {
    GRID_MIN_CARD: GRID_MIN_CARD,
    GRID_REF_WIDTH: GRID_REF_WIDTH,
    GRID_REF_HEIGHT: GRID_REF_HEIGHT,
    MAX_PLAYERS: MAX_PLAYERS,
    gridColumns: gridColumns,
    cardEdge: cardEdge,
    sortPlayers: sortPlayers,
    nameSize: nameSize,
    stampGrid: stampGrid,
    syncWake: syncWake,
    browserGuest: browserGuest,
    hold: function (on) {
      holdPublish = !!on;
      if (!holdPublish && live && live.flush) live.flush();
    },
    publicState: publicState,
    privateState: privateState,
    createSession: createSession,
    createHub: createHub,
    attach: attach,
    available: function () { return !!bridgeMp(); },
    online: function () { return !!(live && live.online()); },
    role: function () { return live ? live.role() : 'off'; },
    display: function () { return live ? live.display() : null; },
    local: function (action) { if (live) live.local(action); },
    guestActions: function () { return live && live.guestActions ? live.guestActions() : []; },
    requestReport: function (description) {
      return live && live.requestReport ? live.requestReport(description) : Promise.resolve('');
    },
    roomInfo: function () { return live ? live.roomInfo() : null; },
    rooms: function () { return live ? live.rooms() : []; },
    lockOwner: function (id) { return live ? live.lockOwner(id) : null; },
    selfId: function () { return live ? live.selfId() : null; },
    hostAway: function () { return live ? live.hostAway() : ''; },
    host: function () { return live ? live.host() : Promise.reject(new Error('keine Bridge')); },
    joinRoom: function (id, name) { return live ? live.joinRoom(id, name) : Promise.reject(new Error('keine Bridge')); },
    joinQr: function (payload, name) { return live ? live.joinQr(payload, name) : Promise.reject(new Error('keine Bridge')); },
    discover: function () { return live ? live.discover() : Promise.reject(new Error('keine Bridge')); },
    stopDiscovery: function () { if (live) return live.stopDiscovery(); },
    approve: function (id) { return live ? live.approve(id) : null; },
    deny: function (id) { return live ? live.deny(id) : null; },
    showQr: function (name) { return live ? live.showQr(name) : null; },
    qrButtons: function (mp) {
      if (mp) return qrButtons(mp);
      return live ? live.qrButtons() : qrButtons(bridgeMp());
    },
    leave: function () { return live ? live.leave() : null; },
    resume: function () { return live ? live.resume() : Promise.resolve(null); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
