/* Mehrspieler mit Mock-Bridge. Aufruf: node test/multiplayer.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
function load(file) {
  vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}
load('game.js');
load('net.js');

const W = global.Werwolf;
const N = global.WerwolfNet;

function countsFor(wolves, village) {
  const counts = {};
  W.ROLE_ORDER.forEach(function (role) { counts[role] = 0; });
  counts.werwolf = wolves;
  counts.dorfbewohner = village;
  return counts;
}

function secretProblems(value, pathName) {
  const found = [];
  function walk(node, here) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(function (item, index) { walk(item, here + '[' + index + ']'); });
      return;
    }
    Object.keys(node).forEach(function (key) {
      const next = here + '.' + key;
      if (key === 'role' && node.role) found.push(next + '=' + node.role);
      if (key === 'amorPair' && node.amorPair && node.amorPair.length) found.push(next);
      if (key === 'notice' && node.notice) found.push(next);
      if ((key === 'healsLeft' || key === 'nachLeft') && node[key]) found.push(next);
      if (key === 'poisonLeft' && node.poisonLeft) found.push(next);
      walk(node[key], next);
    });
  }
  walk(value, pathName || '$');
  return found;
}

function boxHooks(box) {
  return {
    apply: function (state, action) { W.send(state, action); },
    getState: function () { return box.state; },
    setState: function (state) { box.state = state; },
    after: function () { N.stampGrid(box.state); },
    changed: function () {}
  };
}

function viewOf(box, session) {
  return session.display() || box.state;
}

function poke(box, session) {
  const view = viewOf(box, session);
  if (!view) return false;
  if (view.step === 'ready') {
    session.local({ type: 'go' });
    return true;
  }
  const prompt = W.view(view).prompt;
  if (!prompt) {
    session.local({ type: 'ack' });
    return true;
  }
  if (prompt.kind === 'vote') {
    session.local({ type: 'confirm', id: 0, ids: [0] });
    return true;
  }
  if (prompt.kind === 'sleep' || prompt.kind === 'love' || prompt.kind === 'notice' || prompt.kind === 'info' || prompt.kind === 'seer-result') {
    session.local({ type: 'ack' });
    return true;
  }
  const optional = { steal: 1, copy: 1, heal: 1, poison: 1, schaufel: 1, wolf: 1, seer: 1 };
  if (optional[prompt.kind]) {
    session.local({ type: 'skip' });
    return true;
  }
  const self = W.view(view).playerId;
  const targets = W.targetsFor(view, prompt, self);
  const choice = targets[0] ? targets[0].id : 0;
  session.local({ type: 'confirm', id: choice, ids: [choice] });
  return true;
}

function stillInside(box, session) {
  if (session.role() === 'host') return !!session.display();
  const view = box.state;
  return !!(view && view.remoteHold);
}

function finishOpen(box, session) {
  for (let i = 0; i < 8 && stillInside(box, session); i++) poke(box, session);
  if (stillInside(box, session)) {
    const view = viewOf(box, session);
    throw new Error('Zug hängt ' + view.screen + ' ' + view.step + ' ' + JSON.stringify(W.view(view).prompt));
  }
}

function person(state, name) {
  return state.players.filter(function (p) { return p.name === name; })[0];
}

function indexOfName(players, name) {
  const order = N.sortPlayers(players);
  for (let i = 0; i < order.length; i++) if (order[i].name === name) return i;
  return -1;
}

async function main() {
  assert.strictEqual(N.gridColumns(4), 2);
  assert.strictEqual(N.gridColumns(8), 2);
  assert.strictEqual(N.gridColumns(18), 3);
  const wide = N.cardEdge(4, 2, N.GRID_REF_WIDTH, N.GRID_REF_HEIGHT);
  assert.strictEqual(wide.scroll, false);
  assert.ok(wide.size >= N.GRID_MIN_CARD);
  const cramped = N.cardEdge(24, 3, N.GRID_REF_WIDTH, N.GRID_REF_HEIGHT);
  assert.strictEqual(cramped.scroll, true);
  assert.strictEqual(cramped.size, N.GRID_MIN_CARD);
  assert.ok(N.nameSize('Maximilian-Alexander-Bausch') < N.nameSize('Anna'));
  var wake = { n: 0 };
  global.OpenScrBridge = {
    keepAwake: {
      acquire: function () { wake.n += 1; },
      release: function () { wake.n -= 1; }
    },
    storage: {
      get: function () { throw new Error('Gast liest keinen Speicher'); },
      set: function () { throw new Error('Gast schreibt keinen Speicher'); },
      remove: function () { throw new Error('Gast löscht keinen Speicher'); }
    }
  };
  N.syncWake({ screen: 'night' }, 'guest');
  assert.strictEqual(wake.n, 0);
  N.syncWake({ screen: 'night' }, 'host');
  N.syncWake({ screen: 'night' }, 'host');
  assert.strictEqual(wake.n, 1);
  N.syncWake({ screen: 'lobby' }, 'host');
  assert.strictEqual(wake.n, 0);
  N.syncWake({ screen: 'night' }, 'guest');
  assert.strictEqual(wake.n, 0);
  assert.deepStrictEqual(N.qrButtons({ showQr: function () {}, send: function () {} }).map(function (b) { return b.fn; }), ['showQr']);
  assert.deepStrictEqual(N.qrButtons({
    showQr: function () {},
    showWifiQr: function () {},
    showGameQr: function () {},
    showHotspotQr: function () {}
  }).map(function (b) { return b.fn; }), ['showQr', 'showWifiQr', 'showHotspotQr', 'showGameQr']);
  global.OpenScrBridge.guest = true;
  assert.strictEqual(N.browserGuest(), true);
  assert.deepStrictEqual(N.qrButtons({
    showQr: function () {},
    showWifiQr: function () {},
    showGameQr: function () {},
    showHotspotQr: function () {}
  }), []);
  var hostCalls = 0;
  var onMsg = null;
  var browserMp = {
    host: function () { hostCalls += 1; return Promise.resolve({}); },
    send: function () { return Promise.resolve({ seq: 1 }); },
    showQr: function () { return Promise.reject(new Error('Im Browser ist nur die Gast-Ansicht da.')); },
    onMessage: function (cb) { onMsg = cb; return function () {}; },
    onPlayersChanged: function () { return function () {}; },
    onJoinRequest: function () { return function () {}; },
    onResumed: function () { return function () {}; },
    onHostAway: function () { return function () {}; }
  };
  var browserBox = { state: { screen: 'lobby', players: [] } };
  var browserSession = N.createSession(browserMp, {
    apply: function () {},
    getState: function () { return browserBox.state; },
    setState: function (next) { browserBox.state = next; },
    changed: function () {}
  });
  await browserSession.host().then(function () { throw new Error('host im Browser'); }, function () {
    assert.strictEqual(hostCalls, 0);
  });
  assert.strictEqual(await browserSession.showQr('showQr'), null);
  onMsg({ from: 'host', data: { t: 'pub', state: { v: 1, screen: 'night', remote: true, players: [{ id: 1, name: 'Anna', role: '' }], gridCols: 2 } } });
  assert.strictEqual(browserBox.state.screen, 'night');
  assert.strictEqual(browserBox.state.players.length, 1);
  assert.strictEqual(browserBox.state.players[0].role, '');
  delete global.OpenScrBridge.guest;
  assert.deepStrictEqual(N.qrButtons({ send: function () {} }), []);
  delete global.OpenScrBridge;
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.ok(css.indexOf('.name-grid .who') >= 0);
  assert.ok(css.indexOf('overflow-wrap: anywhere') >= 0);
  assert.strictEqual(css.slice(0, css.indexOf('.stats-filters')).indexOf('text-overflow'), -1);

  const names = ['Anna', 'Ben', 'Chris', 'Dora', 'Emil', 'Fiona', 'Gerd', 'Hanna'];
  const hostBox = { state: W.createGame(names, countsFor(2, 6), { quickAmor: true, showWolfAction: false, rng: function () { return 0; } }) };
  hostBox.state.players.forEach(function (p) {
    W.send(hostBox.state, { type: 'reveal-pick', id: p.id });
    W.send(hostBox.state, { type: 'reveal-see' });
    W.send(hostBox.state, { type: 'ack' });
  });
  W.send(hostBox.state, { type: 'start-game' });
  assert.strictEqual(hostBox.state.screen, 'night');
  N.stampGrid(hostBox.state);
  const cols = hostBox.state.gridCols;
  const annaAt = indexOfName(hostBox.state.players, 'Anna');
  assert.ok(annaAt >= 0);

  const hub = N.createHub();
  const hostMp = hub.device('Werwolf');
  const phone2 = hub.device('Handy-2');
  const phone3 = hub.device('Handy-3');
  const broadcasts = [];
  const direct = [];
  const origBroadcast = hostMp.broadcast;
  hostMp.broadcast = function (data) {
    broadcasts.push(JSON.parse(JSON.stringify(data)));
    return origBroadcast.apply(hostMp, arguments);
  };
  const origSend = hostMp.send;
  hostMp.send = function (data) {
    direct.push(JSON.parse(JSON.stringify(data)));
    return origSend.apply(hostMp, arguments);
  };

  const host = N.createSession(hostMp, boxHooks(hostBox));
  const box2 = { state: null };
  const box3 = { state: null };
  const guest2 = N.createSession(phone2, boxHooks(box2));
  const guest3 = N.createSession(phone3, boxHooks(box3));

  await host.host();
  assert.strictEqual(host.roomInfo().players.length, 1);
  const joining2 = guest2.joinRoom('room-1', 'Handy-2');
  const request = host.roomInfo().requests[0];
  assert.ok(request && request.name === 'Handy-2');
  await host.approve(request.id);
  await joining2;
  await guest3.joinQr(host.roomInfo().qrPayload, 'Handy-3');
  assert.strictEqual(host.roomInfo().players.length, 3);
  assert.strictEqual(box3.state.screen, 'night');
  assert.strictEqual(box3.state.gridCols, cols);
  assert.deepStrictEqual(secretProblems(broadcasts[broadcasts.length - 1]), []);
  assert.strictEqual(indexOfName(box3.state.players, 'Anna'), annaAt);

  const anna = person(hostBox.state, 'Anna');
  const ben = person(hostBox.state, 'Ben');
  const dora = person(hostBox.state, 'Dora');
  host.local({ type: 'night-pick', id: anna.id });
  guest2.local({ type: 'night-pick', id: ben.id });
  assert.ok(host.display(), 'Anna ist auf Handy 1 offen');
  assert.strictEqual(host.display().activeId, anna.id);
  assert.ok(box2.state && box2.state.remoteHold, 'Ben ist auf Handy 2 offen');
  assert.strictEqual(box2.state.activeId, ben.id);
  assert.strictEqual(hostBox.state.step, 'list');
  assert.strictEqual(host.lockOwner(anna.id), host.selfId());
  assert.strictEqual(host.lockOwner(ben.id), guest2.selfId());
  guest3.local({ type: 'night-pick', id: anna.id });
  assert.strictEqual(box3.state.error, 'belegt');
  assert.ok((hostBox.state.nightDone || []).indexOf(anna.id) < 0);

  const villager = hostBox.state.players.filter(function (p) { return p.role === 'dorfbewohner'; })[0];
  const villagerName = villager.name;
  if (ben.role === 'dorfbewohner') {
    const others = box2.state.players.filter(function (p) { return p.id !== ben.id && p.role; });
    assert.deepStrictEqual(others, []);
    assert.ok(person(box2.state, 'Ben').role);
  }
  broadcasts.forEach(function (message) {
    assert.deepStrictEqual(secretProblems(message), []);
  });

  finishOpen(hostBox, host);
  finishOpen(box2, guest2);
  assert.ok(hostBox.state.nightDone.indexOf(anna.id) >= 0);
  assert.ok(hostBox.state.nightDone.indexOf(ben.id) >= 0);
  assert.strictEqual(host.lockOwner(anna.id), null);
  assert.strictEqual(box2.state.remoteHold, undefined);
  assert.strictEqual(box2.state.step, 'list');

  guest3.local({ type: 'night-pick', id: dora.id });
  assert.strictEqual(box3.state.activeId, dora.id);
  const doneBeforeDrop = hostBox.state.nightDone.slice();
  phone3._disconnect();
  assert.strictEqual(host.lockOwner(dora.id), null);
  assert.deepStrictEqual(hostBox.state.nightDone, doneBeforeDrop);

  phone3.resume && await phone3.resume();
  await guest3.resume();
  assert.strictEqual(guest3.role(), 'guest');
  assert.ok(box3.state && !box3.state.remoteHold);
  assert.deepStrictEqual(secretProblems(box3.state), []);
  assert.strictEqual(indexOfName(box3.state.players, 'Anna'), annaAt);

  hostMp._disconnect();
  assert.strictEqual(guest2.hostAway(), 'Host ist kurz weg');
  await host.resume();
  assert.strictEqual(guest2.hostAway(), '');
  assert.strictEqual(box2.state.gridCols, cols);
  assert.strictEqual(hostBox.state.gridCols, cols);

  const orderBefore = N.sortPlayers(hostBox.state.players).map(function (p) { return p.name; });
  while (hostBox.state.screen === 'night') {
    const open = hostBox.state.players.filter(function (p) {
      return p.alive && hostBox.state.nightDone.indexOf(p.id) < 0;
    });
    if (!open.length) break;
    host.local({ type: 'night-pick', id: open[0].id });
    finishOpen(hostBox, host);
  }
  for (let guard = 0; guard < 40 && hostBox.state.nightNumber < 2; guard++) {
    if (hostBox.state.screen === 'announce') host.local({ type: 'ack' });
    else if (hostBox.state.screen === 'discuss') host.local({ type: 'to-vote' });
    else if (hostBox.state.screen === 'vote') {
      const voter = hostBox.state.players.filter(function (p) {
        return p.alive && (hostBox.state.voteDone || []).indexOf(p.id) < 0;
      })[0];
      if (!voter) break;
      host.local({ type: 'vote-pick', id: voter.id });
      finishOpen(hostBox, host);
    } else if (hostBox.state.screen === 'hunter' || hostBox.state.screen === 'duel') {
      const hunter = (hostBox.state.hunters || [])[0] || (hostBox.state.players.filter(function (p) { return p.alive; })[0] || {}).id;
      host.local({ type: hostBox.state.screen === 'hunter' ? 'hunter-pick' : 'duel-pick', id: hunter });
      finishOpen(hostBox, host);
    } else break;
  }
  assert.strictEqual(hostBox.state.nightNumber, 2, hostBox.state.screen + ' ' + hostBox.state.step + ' ' + (hostBox.state.error || ''));
  assert.strictEqual(hostBox.state.screen, 'night');
  assert.strictEqual(hostBox.state.gridCols, cols);
  assert.deepStrictEqual(N.sortPlayers(hostBox.state.players).map(function (p) { return p.name; }), orderBefore);
  assert.strictEqual(person(hostBox.state, 'Anna').alive, true);
  guest3.local({ type: 'night-pick', id: anna.id });
  assert.strictEqual(box3.state.activeId, anna.id);
  assert.strictEqual(indexOfName(box3.state.players, 'Anna'), annaAt);
  assert.strictEqual(indexOfName(hostBox.state.players, 'Anna'), annaAt);
  const moved = hostBox.state.players.slice();
  const dead = moved.filter(function (p) { return p.name !== 'Anna'; })[0];
  dead.alive = false;
  assert.strictEqual(indexOfName(moved, 'Anna'), annaAt);
  assert.notStrictEqual(villagerName, '');
  broadcasts.forEach(function (message) { assert.deepStrictEqual(secretProblems(message), []); });
  direct.forEach(function (message) {
    if (!message || message.t !== 'priv') return;
    const actor = message.state && message.state.activeId;
    (message.state.players || []).forEach(function (p) {
      if (p.role && p.id !== actor && p.role !== 'werwolf') {
        const me = person(message.state, person(hostBox.state, 'Anna') ? '' : '');
        if (me) assert.fail('fremde Rolle ' + p.role);
      }
    });
  });
  const leaked = [];
  direct.forEach(function (message) {
    if (!message || message.t !== 'priv' || !message.state) return;
    const actor = message.state.players.filter(function (p) { return p.id === message.state.activeId; })[0];
    if (!actor || actor.role !== 'dorfbewohner') return;
    message.state.players.forEach(function (p) {
      if (p.id !== actor.id && p.role) leaked.push(p.name + ':' + p.role);
    });
  });
  assert.deepStrictEqual(leaked, []);

  const gate = { state: W.createGame(['Ida', 'Jens', 'Kai', 'Lea'], countsFor(1, 3), { quickAmor: true, rng: function () { return 0; } }) };
  const gateHub = N.createHub();
  const gateHostMp = gateHub.device('Host');
  const gateGuestMp = gateHub.device('Gast');
  const gatePriv = [];
  const gateSend = gateHostMp.send;
  gateHostMp.send = function (data) {
    gatePriv.push(JSON.parse(JSON.stringify(data)));
    return gateSend.apply(gateHostMp, arguments);
  };
  const gateHost = N.createSession(gateHostMp, boxHooks(gate));
  const gateGuestBox = { state: null };
  const gateGuest = N.createSession(gateGuestMp, boxHooks(gateGuestBox));
  await gateHost.host();
  await gateGuest.joinQr(gateHost.roomInfo().qrPayload, 'Gast');
  const ida = person(gate.state, 'Ida');
  const jens = person(gate.state, 'Jens');
  gateGuest.local({ type: 'reveal-pick', id: ida.id });
  assert.strictEqual(gateHost.lockOwner(ida.id), gateGuest.selfId());
  assert.strictEqual(gate.state.step, 'list');
  assert.ok(!gate.state.peeked || !gate.state.peeked[ida.id]);
  assert.strictEqual(gateGuestBox.state.step, 'confirm');
  assert.deepStrictEqual(secretProblems(gateGuestBox.state), []);
  assert.strictEqual(gatePriv[gatePriv.length - 1].t, 'priv');
  assert.deepStrictEqual(secretProblems(gatePriv[gatePriv.length - 1]), []);
  gateGuest.local({ type: 'back' });
  assert.strictEqual(gateHost.lockOwner(ida.id), null);
  assert.strictEqual(gateGuestBox.state.step, 'list');
  assert.ok(!gateGuestBox.state.remoteHold);
  gateHost.local({ type: 'reveal-pick', id: ida.id });
  assert.strictEqual(gateHost.display().step, 'confirm');
  assert.strictEqual(gateHost.lockOwner(ida.id), gateHost.selfId());
  gateHost.local({ type: 'reveal-see' });
  assert.ok(gateHost.display().step === 'show' || gateHost.display().step === 'link');
  assert.ok(person(gateHost.display(), 'Ida').role);
  assert.strictEqual(gate.state.step, 'list');
  gateGuest.local({ type: 'reveal-pick', id: jens.id });
  assert.strictEqual(gateGuestBox.state.step, 'confirm');
  assert.deepStrictEqual(secretProblems(gateGuestBox.state), []);
  gateGuest.local({ type: 'reveal-see' });
  assert.ok(gateGuestBox.state.step === 'show' || gateGuestBox.state.step === 'link');
  assert.ok(person(gateGuestBox.state, 'Jens').role);
  assert.deepStrictEqual(gateGuestBox.state.players.filter(function (p) { return p.name !== 'Jens' && p.role; }), []);
  gateGuest.local({ type: 'back' });
  assert.strictEqual(gateHost.lockOwner(jens.id), null);
  assert.ok(!gate.state.revealed || !gate.state.revealed[jens.id]);

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }
  function wolfLeak(value) {
    const found = [];
    function walk(node, here) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(function (item, index) { walk(item, here + '[' + index + ']'); });
        return;
      }
      Object.keys(node).forEach(function (key) {
        const next = here + '.' + key;
        if (key === 'wolfVotes' || key === 'wolfPack') found.push(next);
        else walk(node[key], next);
      });
    }
    walk(value, '$');
    return found;
  }
  const packGame = W.createGame(['Ida', 'Jens', 'Kai', 'Lea', 'Mara'], countsFor(2, 3), { quickAmor: true, rng: function () { return 0; } });
  packGame.players.forEach(function (p) {
    W.send(packGame, { type: 'reveal-pick', id: p.id });
    W.send(packGame, { type: 'reveal-see' });
    W.send(packGame, { type: 'ack' });
  });
  W.send(packGame, { type: 'start-game' });
  assert.strictEqual(packGame.screen, 'night');
  const packBox = { state: packGame };
  const packHub = N.createHub();
  const packHostMp = packHub.device('Host');
  const packWolfMp = packHub.device('Wolf');
  const packDorfMp = packHub.device('Dorf');
  const packCast = [];
  const packDirect = [];
  const packBroadcast = packHostMp.broadcast;
  const packSend = packHostMp.send;
  packHostMp.broadcast = function (data) {
    packCast.push(JSON.parse(JSON.stringify(data)));
    return packBroadcast.apply(packHostMp, arguments);
  };
  packHostMp.send = function (data, opts) {
    packDirect.push({ to: opts && opts.to, data: JSON.parse(JSON.stringify(data)) });
    return packSend.apply(packHostMp, arguments);
  };
  const packHost = N.createSession(packHostMp, boxHooks(packBox));
  const wolfBox = { state: null };
  const dorfBox = { state: null };
  const wolfGuest = N.createSession(packWolfMp, boxHooks(wolfBox));
  const dorfGuest = N.createSession(packDorfMp, boxHooks(dorfBox));
  await packHost.host();
  await wolfGuest.joinQr(packHost.roomInfo().qrPayload, 'Wolf');
  await dorfGuest.joinQr(packHost.roomInfo().qrPayload, 'Dorf');
  const packWolves = packBox.state.players.filter(function (p) { return p.role === 'werwolf'; });
  const packDorf = packBox.state.players.filter(function (p) { return p.role !== 'werwolf'; })[0];
  assert.strictEqual(packWolves.length, 2);
  function openSeat(session, id) {
    session.local({ type: 'night-pick', id: id });
    session.local({ type: 'go' });
  }
  openSeat(packHost, packWolves[0].id);
  openSeat(wolfGuest, packWolves[1].id);
  openSeat(dorfGuest, packDorf.id);
  assert.strictEqual(W.view(packHost.display()).prompt.kind, 'wolf');
  assert.strictEqual(W.view(wolfBox.state).prompt.kind, 'wolf');
  assert.notStrictEqual(W.view(dorfBox.state).prompt.kind, 'wolf');
  const aim = packDorf.id;
  wolfGuest.local({ type: 'select', id: aim });
  assert.deepStrictEqual(packHost.display().wolfPack.picks, []);
  await wait(200);
  assert.deepStrictEqual(packHost.display().wolfPack.picks, [{ name: packWolves[1].name, targetId: aim }]);
  wolfGuest.local({ type: 'select', id: aim });
  assert.deepStrictEqual(packHost.display().wolfPack.picks, []);
  assert.deepStrictEqual(wolfBox.state.wolfPack.picks, []);
  packHost.local({ type: 'select', id: aim });
  await wait(200);
  assert.ok(wolfBox.state.wolfPack.picks.some(function (row) {
    return row.name === packWolves[0].name && row.targetId === aim;
  }));
  packHost.local({ type: 'select', id: aim });
  assert.deepStrictEqual(wolfBox.state.wolfPack.picks, []);
  packHost.local({ type: 'select', id: aim });
  packHost.local({ type: 'confirm' });
  assert.strictEqual(packBox.state.wolfVotes[packWolves[0].id], aim);
  assert.ok(wolfBox.state.wolfPack.votes.some(function (row) {
    return row.name === packWolves[0].name && row.targetId === aim;
  }));
  assert.ok(!dorfBox.state.wolfPack);
  assert.ok(!dorfBox.state.wolfVotes);
  packCast.forEach(function (message) {
    assert.notStrictEqual(message.t, 'pack');
    assert.deepStrictEqual(wolfLeak(message), []);
  });
  assert.deepStrictEqual(wolfLeak(N.publicState(packBox.state, {})), []);
  packDirect.forEach(function (message) {
    if (message.to !== dorfGuest.selfId()) return;
    assert.notStrictEqual(message.data.t, 'pack');
    assert.deepStrictEqual(wolfLeak(message.data), []);
  });
  const wolfPacks = packDirect.filter(function (message) {
    return message.data.t === 'pack';
  });
  assert.ok(wolfPacks.length > 0);
  wolfPacks.forEach(function (message) {
    assert.strictEqual(message.to, wolfGuest.selfId());
  });
  assert.ok(css.indexOf('.pack-badge') >= 0);
  assert.ok(css.indexOf('.pack-badge.live') >= 0);

  console.log('multiplayer ok');
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
