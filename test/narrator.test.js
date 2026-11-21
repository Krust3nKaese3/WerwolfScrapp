/* Erzählermodus. Aufruf: node test/narrator.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

eval(fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8'));
const W = globalThis.Werwolf;

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('ok', name);
}

function rngZero() { return 0; }

function blankCounts() {
  const counts = {};
  W.ROLE_ORDER.forEach(function (role) { counts[role] = 0; });
  return counts;
}

function setRoles(state, roles) {
  roles.forEach(function (role, i) {
    const p = state.players[i];
    p.role = role;
    p.healsLeft = role === 'hexe' ? (state.healPotions || 2) : 0;
    p.poisonLeft = role === 'hexe';
    p.nachLeft = role === 'nachahmerin' ? (state.nachUses || 1) : 0;
    p.stealUsed = false;
    p.schaufelUsed = false;
    p.russeUsed = false;
    p.hunterShot = false;
    p.loverIds = [];
    p.alive = true;
    p.notice = null;
    p.amorLinked = role === 'amor';
  });
}

function make(names, counts, opts) {
  const state = W.createGame(names, counts, Object.assign({
    rng: rngZero,
    nachUses: 1,
    healPotions: 2,
    selfTell: false
  }, opts || {}));
  state._rng = rngZero;
  return state;
}

function playClassic(state, decide) {
  let guard = 0;
  while (state.screen === 'night' || state.screen === 'hunter') {
    const view = W.view(state);
    if (state.screen === 'hunter') {
      if (view.step === 'list' || view.step === 'handoff') W.send(state, { type: 'hunter-pick', id: state.hunters[0] });
      else if (view.step === 'ready') W.send(state, { type: 'go' });
      else W.send(state, { type: 'confirm', id: W.living(state)[0].id });
    } else if (view.step === 'list') {
      const next = W.living(state).filter(function (p) { return state.nightDone.indexOf(p.id) < 0; })[0];
      W.send(state, { type: 'night-pick', id: next.id });
    } else if (view.step === 'ready' || view.step === 'handoff') {
      W.send(state, { type: 'ack' });
    } else {
      const choice = decide(view, state);
      if (choice) W.send(state, choice);
      else if (view.prompt && ['sleep', 'love', 'notice', 'info', 'seer-result'].indexOf(view.prompt.kind) >= 0) W.send(state, { type: 'ack' });
      else W.send(state, { type: 'skip' });
    }
    if (++guard > 200) throw new Error('classic loop ' + JSON.stringify(W.view(state)));
  }
}

function playNarrator(state, decide) {
  let guard = 0;
  while (state.screen === 'night' || state.screen === 'hunter') {
    const view = W.view(state);
    if (state.screen === 'hunter') {
      if (view.step === 'list' || view.step === 'handoff') W.send(state, { type: 'hunter-pick', id: state.hunters[0] });
      else if (view.step === 'ready') W.send(state, { type: 'go' });
      else W.send(state, { type: 'confirm', id: W.living(state)[0].id });
    } else if (view.step === 'sheet' || view.step === 'call') {
      W.send(state, { type: 'ack' });
    } else {
      const choice = decide(view, state);
      if (choice) W.send(state, choice);
      else if (view.prompt && ['sleep', 'love', 'notice', 'info', 'seer-result'].indexOf(view.prompt.kind) >= 0) W.send(state, { type: 'ack' });
      else W.send(state, { type: 'skip' });
    }
    if (++guard > 250) throw new Error('narrator loop ' + JSON.stringify(W.view(state)));
  }
}

test('Aufrufreihenfolge ist fest und dokumentiert', function () {
  assert.deepStrictEqual(W.NARRATOR_CALL_ORDER, [
    'amor', 'waschbaer', 'nachahmerin', 'nutte', 'seherin', 'werwolf',
    'hexe', 'schaufel', 'jaeger', 'russe', 'politiker', 'dorfbewohner'
  ]);
  assert.strictEqual(W.narratorWakeText('seherin'), 'Seherin, wach auf.');
  assert.strictEqual(W.narratorWakeText('nutte'), 'Gastgeberin, wach auf.');
  assert.strictEqual(W.narratorWakeText('werwolf'), 'Werwolf, wach auf.');
});

test('Aus bleibt die Namensliste, ohne Erzähler-Aufrufe', function () {
  const counts = blankCounts();
  counts.werwolf = 1;
  counts.dorfbewohner = 3;
  const state = make(['Anna', 'Bea', 'Chris', 'Dora'], counts, { selfTell: false, rolePool: false });
  setRoles(state, ['werwolf', 'dorfbewohner', 'dorfbewohner', 'dorfbewohner']);
  assert.strictEqual(state.players.length, 4);
  assert.ok(!state.players.some(function (p) { return p.name === 'Erzähler'; }));
  W.beginNight(state);
  assert.strictEqual(state.screen, 'night');
  assert.strictEqual(state.step, 'list');
  assert.strictEqual(state.narratorCalls, null);
  assert.strictEqual(W.view(state).wake, '');
  W.send(state, { type: 'night-pick', id: 2 });
  assert.strictEqual(state.step, 'ready');
  W.send(state, { type: 'back' });
  assert.strictEqual(state.step, 'list');
  assert.strictEqual(state.nightDone.length, 0);
  playClassic(state, function (view) {
    if (view.prompt && view.prompt.kind === 'wolf') return { type: 'confirm', id: 4 };
    return null;
  });
  assert.strictEqual(W.playerById(state, 4).alive, false);
  assert.strictEqual(W.playerById(state, 1).alive, true);
});

test('Alle möglichen Karten werden gerufen, auch aussortierte und tote', function () {
  const counts = blankCounts();
  counts.seherin = 2;
  counts.hexe = 1;
  counts.dorfbewohner = 2;
  const dealt = blankCounts();
  dealt.werwolf = 1;
  dealt.dorfbewohner = 3;
  const state = make(['Anna', 'Bea', 'Chris', 'Dora'], dealt, { selfTell: true, rolePool: false });
  state.counts = counts;
  state.rolePool = true;
  state.wolfMin = 1;
  state.wolfMax = 2;
  state.config.rolePool = true;
  state.config.wolfMin = 1;
  state.config.wolfMax = 2;
  setRoles(state, ['seherin', 'hexe', 'werwolf', 'dorfbewohner']);
  W.playerById(state, 2).alive = false;
  W.beginNight(state);
  assert.strictEqual(state.step, 'sheet');
  assert.strictEqual(state.players.length, 4);
  const script = W.narratorScript(state);
  const roles = script.map(function (row) { return row.role; });
  assert.deepStrictEqual(roles, [
    'seherin', 'seherin', 'werwolf', 'werwolf', 'hexe', 'dorfbewohner', 'dorfbewohner'
  ]);
  const byKey = {};
  script.forEach(function (row) { byKey[row.role + ':' + row.slot] = row; });
  assert.strictEqual(byKey['seherin:0'].quiet, false);
  assert.strictEqual(byKey['seherin:0'].playerId, 1);
  assert.strictEqual(byKey['seherin:1'].quiet, true);
  assert.strictEqual(byKey['seherin:1'].reason, 'discarded');
  assert.strictEqual(byKey['seherin:1'].playerId, null);
  assert.strictEqual(byKey['werwolf:0'].quiet, false);
  assert.strictEqual(byKey['werwolf:0'].playerId, 3);
  assert.strictEqual(byKey['werwolf:1'].quiet, true);
  assert.strictEqual(byKey['werwolf:1'].reason, 'discarded');
  assert.strictEqual(byKey['hexe:0'].quiet, true);
  assert.strictEqual(byKey['hexe:0'].reason, 'dead');
  assert.strictEqual(byKey['hexe:0'].playerId, 2);
  assert.strictEqual(byKey['dorfbewohner:0'].quiet, false);
  assert.strictEqual(byKey['dorfbewohner:1'].reason, 'discarded');
  script.forEach(function (row) { assert.strictEqual(row.wake, W.roleName(row.role) + ', wach auf.'); });

  W.send(state, { type: 'narrator-begin' });
  assert.strictEqual(state.step, 'show');
  assert.strictEqual(W.view(state).wake, 'Seherin, wach auf.');
  assert.strictEqual(W.view(state).playerId, 1);
  W.send(state, { type: 'select', id: 3 });
  W.send(state, { type: 'back' });
  assert.deepStrictEqual(state.selection, []);
  assert.strictEqual(state.nightDone.indexOf(1), -1);
  assert.strictEqual(state.step, 'show');
  assert.strictEqual(W.view(state).prompt.kind, 'seer');
  W.send(state, { type: 'confirm', id: 3 });
  assert.strictEqual(W.view(state).prompt.kind, 'seer-result');
  assert.strictEqual(W.view(state).prompt.label, 'Böse');
  W.send(state, { type: 'ack' });
  assert.strictEqual(state.step, 'call');
  assert.strictEqual(state.narratorQuiet, true);
  assert.strictEqual(W.view(state).wake, 'Seherin, wach auf.');
  assert.strictEqual(Object.keys(state.wolfVotes).length, 0);
  W.send(state, { type: 'ack' });
  assert.strictEqual(W.view(state).wake, 'Werwolf, wach auf.');
  W.send(state, { type: 'confirm', id: 4 });
  assert.strictEqual(state.wolfVotes[3], 4);
  assert.strictEqual(state.step, 'call');
  W.send(state, { type: 'ack' });
  assert.strictEqual(W.view(state).narratorRole, 'hexe');
  assert.strictEqual(state.narratorQuiet, true);
  assert.strictEqual(state.heals.length, 0);
  assert.strictEqual(state.poisons.length, 0);
  W.send(state, { type: 'ack' });
  assert.strictEqual(W.view(state).prompt.kind, 'sleep');
  W.send(state, { type: 'ack' });
  assert.strictEqual(state.step, 'call');
  W.send(state, { type: 'ack' });
  assert.strictEqual(state.screen, 'announce');
  assert.strictEqual(W.playerById(state, 4).alive, false);
  assert.strictEqual(W.playerById(state, 1).alive, true);
  assert.strictEqual(W.playerById(state, 3).alive, true);
});

test('Dieselbe Nachtauflösung wie ohne Erzähler', function () {
  function prepare(selfTell) {
    const counts = blankCounts();
    counts.werwolf = 1;
    counts.nutte = 1;
    counts.hexe = 1;
    counts.dorfbewohner = 1;
    const state = make(['Ada', 'Bea', 'Cem', 'Dora'], counts, { selfTell: selfTell, rolePool: false });
    setRoles(state, ['werwolf', 'nutte', 'hexe', 'dorfbewohner']);
    W.beginNight(state);
    return state;
  }
  const classic = prepare(false);
  function nightChoice(view, current) {
    if (view.prompt && view.prompt.kind === 'nutte') return { type: 'confirm', id: 4 };
    if (view.prompt && view.prompt.kind === 'wolf') return { type: 'confirm', id: 4 };
    if (view.prompt && view.prompt.kind === 'heal') {
      if ((current.heals || []).length) return { type: 'skip' };
      return { type: 'confirm', id: 4 };
    }
    if (view.prompt && view.prompt.kind === 'poison') return { type: 'skip' };
    return null;
  }
  playClassic(classic, nightChoice);
  const told = prepare(true);
  playNarrator(told, nightChoice);
  [1, 2, 3, 4].forEach(function (id) {
    assert.strictEqual(W.playerById(told, id).alive, W.playerById(classic, id).alive, 'id ' + id);
  });
  assert.strictEqual(W.playerById(told, 4).alive, true);
  assert.strictEqual(W.playerById(told, 2).alive, true);
  assert.strictEqual(W.playerById(told, 3).healsLeft, 1);
  assert.strictEqual(told.screen, classic.screen);
});

test('Waschbär stiehlt vor dem Opfer und die Seherin wird danach nur still gerufen', function () {
  const counts = blankCounts();
  counts.waschbaer = 1;
  counts.seherin = 1;
  counts.werwolf = 1;
  counts.dorfbewohner = 1;
  const state = make(['Ra', 'Seer', 'Wolf', 'Dorf'], counts, { selfTell: true, rolePool: false });
  setRoles(state, ['waschbaer', 'seherin', 'werwolf', 'dorfbewohner']);
  W.beginNight(state);
  W.send(state, { type: 'ack' });
  assert.strictEqual(W.view(state).prompt.kind, 'steal');
  W.send(state, { type: 'confirm', id: 2 });
  assert.strictEqual(W.playerById(state, 1).role, 'seherin');
  assert.strictEqual(W.playerById(state, 2).role, 'dorfbewohner');
  assert.strictEqual(W.view(state).prompt.kind, 'seer');
  W.send(state, { type: 'confirm', id: 3 });
  assert.strictEqual(W.view(state).prompt.kind, 'seer-result');
  W.send(state, { type: 'ack' });
  assert.strictEqual(state.step, 'call');
  assert.strictEqual(state.narratorQuiet, true);
  assert.strictEqual(W.view(state).wake, 'Seherin, wach auf.');
});

test('Tag: Erzähler trägt die Abstimmung ein, Politiker gewinnt nach der alten Regel', function () {
  const counts = blankCounts();
  counts.werwolf = 1;
  counts.dorfbewohner = 2;
  counts.politiker = 1;
  const state = make(['Wolf', 'Dorf', 'Berta', 'Pol'], counts, { selfTell: true, rolePool: false });
  setRoles(state, ['werwolf', 'dorfbewohner', 'dorfbewohner', 'politiker']);
  W.addLink(state, 3, 4);
  W.beginNight(state);
  playNarrator(state, function () { return null; });
  if (state.screen === 'announce') W.send(state, { type: 'ack' });
  assert.strictEqual(state.screen, 'discuss');
  assert.strictEqual(state.mayorId, 1);
  W.send(state, { type: 'to-vote' });
  const order = [];
  while (state.screen === 'vote') {
    if (state.step === 'list') {
      const next = W.living(state).filter(function (p) { return (state.voteDone || []).indexOf(p.id) < 0; })[0];
      order.push(next.id);
      W.send(state, { type: 'vote-pick', id: next.id });
      assert.strictEqual(state.step, 'show');
      W.send(state, { type: 'select', id: 4 });
      W.send(state, { type: 'back' });
      assert.strictEqual(state.step, 'list');
      assert.strictEqual(state.votes[next.id], undefined);
      W.send(state, { type: 'vote-pick', id: next.id });
    } else {
      W.send(state, { type: 'confirm', id: 4 });
    }
  }
  assert.ok(order.length >= 4);
  if (state.screen === 'announce') W.send(state, { type: 'ack' });
  assert.strictEqual(state.winner, 'politiker');
  assert.strictEqual(W.playerById(state, 3).alive, true);
  assert.strictEqual(W.playerById(state, 4).alive, false);
});

test('Erzähler-Ansage verschweigt die Ursache, wenn die Werwolf-Aktion aus ist', function () {
  const counts = blankCounts();
  counts.werwolf = 1;
  counts.dorfbewohner = 3;
  const state = make(['Wolf', 'Anna', 'Bert', 'Cem'], counts, { selfTell: true, rolePool: false });
  setRoles(state, ['werwolf', 'dorfbewohner', 'dorfbewohner', 'dorfbewohner']);
  delete state.showWolfAction;
  W.beginNight(state);
  playNarrator(state, function (view) {
    if (view.prompt && view.prompt.kind === 'wolf') return { type: 'confirm', id: 2 };
    return null;
  });
  const text = state.announce.lines.join(' ');
  assert.ok(text.indexOf('Anna ist gestorben.') >= 0, text);
  assert.strictEqual(text.indexOf('Werwöl'), -1, text);
  const shown = make(['Wolf', 'Anna', 'Bert', 'Cem'], counts, { selfTell: true, rolePool: false, showWolfAction: true });
  setRoles(shown, ['werwolf', 'dorfbewohner', 'dorfbewohner', 'dorfbewohner']);
  W.beginNight(shown);
  playNarrator(shown, function (view) {
    if (view.prompt && view.prompt.kind === 'wolf') return { type: 'confirm', id: 2 };
    return null;
  });
  assert.ok(shown.announce.lines.join(' ').indexOf('von den Werwölfen') >= 0, shown.announce.lines.join(' '));
});

test('Mitten in der Nacht wechseln, ohne Stand zu verlieren oder doppelt zu handeln', function () {
  const counts = blankCounts();
  counts.werwolf = 1;
  counts.seherin = 2;
  counts.dorfbewohner = 2;
  const dealt = blankCounts();
  dealt.werwolf = 1;
  dealt.dorfbewohner = 3;
  const state = make(['Wolf', 'Anna', 'Bert', 'Cem'], dealt, { selfTell: false, rolePool: false });
  state.counts = counts;
  state.rolePool = true;
  state.wolfMin = 1;
  state.wolfMax = 1;
  setRoles(state, ['werwolf', 'seherin', 'dorfbewohner', 'dorfbewohner']);
  W.beginNight(state);
  W.send(state, { type: 'night-pick', id: 1 });
  W.send(state, { type: 'go' });
  W.send(state, { type: 'select', id: 2 });
  W.send(state, { type: 'toggle-self-tell' });
  W.send(state, { type: 'toggle-self-tell' });
  assert.strictEqual(state.step, 'list');
  assert.strictEqual(state.nightDone.indexOf(1), -1);
  assert.strictEqual(state.wolfVotes[1], undefined);
  W.send(state, { type: 'night-pick', id: 1 });
  W.send(state, { type: 'go' });
  W.send(state, { type: 'confirm', id: 2 });
  assert.strictEqual(state.wolfVotes[1], 2);
  const votes = JSON.stringify(state.wolfVotes);
  const done = state.nightDone.slice();
  W.send(state, { type: 'toggle-wolf-action' });
  assert.strictEqual(JSON.stringify(state.wolfVotes), votes);
  assert.deepStrictEqual(state.nightDone, done);
  W.send(state, { type: 'toggle-self-tell' });
  assert.strictEqual(state.step, 'sheet');
  const script = W.narratorScript(state);
  assert.deepStrictEqual(script.map(function (row) { return row.role; }), [
    'seherin', 'seherin', 'werwolf', 'dorfbewohner', 'dorfbewohner'
  ]);
  const wolfCall = script.filter(function (row) { return row.role === 'werwolf'; })[0];
  assert.strictEqual(wolfCall.quiet, true);
  assert.strictEqual(wolfCall.reason, 'done');
  assert.strictEqual(script.filter(function (row) { return row.reason === 'discarded'; }).length, 1);
  W.send(state, { type: 'ack' });
  let guard = 0;
  while (state.screen === 'night' && state.narratorCalls[state.narratorIndex].role !== 'dorfbewohner') {
    const view = W.view(state);
    if (view.step === 'call' || view.step === 'sheet') W.send(state, { type: 'ack' });
    else if (view.prompt && view.prompt.kind === 'seer') W.send(state, { type: 'skip' });
    else W.send(state, { type: 'ack' });
    if (++guard > 30) throw new Error(JSON.stringify(W.view(state)));
  }
  assert.strictEqual(JSON.stringify(state.wolfVotes), votes);
  W.send(state, { type: 'toggle-self-tell' });
  assert.strictEqual(state.selfTell, false);
  assert.strictEqual(state.step, 'list');
  W.send(state, { type: 'night-pick', id: 1 });
  assert.ok(state.error);
  assert.strictEqual(state.step, 'list');
  assert.strictEqual(JSON.stringify(state.wolfVotes), votes);
  guard = 0;
  while (state.screen === 'night') {
    if (state.step === 'list') {
      const next = W.living(state).filter(function (p) { return state.nightDone.indexOf(p.id) < 0; })[0];
      assert.ok(next && next.id !== 1);
      W.send(state, { type: 'night-pick', id: next.id });
    } else if (state.step === 'ready') W.send(state, { type: 'go' });
    else {
      const view = W.view(state);
      if (view.prompt && view.prompt.kind === 'seer') W.send(state, { type: 'skip' });
      else W.send(state, { type: 'ack' });
    }
    if (++guard > 40) throw new Error(JSON.stringify(W.view(state)));
  }
  assert.strictEqual(JSON.stringify(state.wolfVotes), votes);
  assert.strictEqual(W.playerById(state, 2).alive, false);
  assert.ok(state.announce.lines.join(' ').indexOf('von den Werwölfen') >= 0);
});

test('Angefangener Hexenzug bleibt beim Wechsel erhalten', function () {
  const counts = blankCounts();
  counts.werwolf = 1;
  counts.hexe = 1;
  counts.dorfbewohner = 2;
  const state = make(['Wolf', 'Hexe', 'Anna', 'Bert'], counts, { selfTell: false, rolePool: false, healPotions: 1 });
  setRoles(state, ['werwolf', 'hexe', 'dorfbewohner', 'dorfbewohner']);
  W.beginNight(state);
  W.send(state, { type: 'night-pick', id: 1 });
  W.send(state, { type: 'go' });
  W.send(state, { type: 'skip' });
  W.send(state, { type: 'night-pick', id: 2 });
  W.send(state, { type: 'go' });
  W.send(state, { type: 'confirm', id: 3 });
  assert.strictEqual(state.heals.length, 1);
  assert.strictEqual(W.view(state).prompt.kind, 'poison');
  W.send(state, { type: 'toggle-self-tell' });
  assert.strictEqual(state.heals.length, 1);
  assert.strictEqual(state.step, 'sheet');
  let guard = 0;
  while (state.screen === 'night' && !(W.view(state).prompt && W.view(state).prompt.kind === 'poison')) {
    const view = W.view(state);
    if (view.step === 'sheet' || view.step === 'call') W.send(state, { type: 'ack' });
    else if (view.prompt && (view.prompt.kind === 'sleep' || view.prompt.kind === 'wolf')) W.send(state, { type: 'skip' });
    else W.send(state, { type: 'ack' });
    if (++guard > 30) throw new Error(JSON.stringify(W.view(state)));
  }
  assert.strictEqual(W.view(state).prompt.kind, 'poison');
  assert.strictEqual(state.promptIndex, 1);
  assert.deepStrictEqual(state.heals.map(Number), [3]);
  W.send(state, { type: 'skip' });
  assert.deepStrictEqual(state.heals.map(Number), [3]);
  assert.strictEqual(state.poisons.length, 0);
});

test('Schalter merkt sich nur ein zusätzliches Feld, alte Schlüssel bleiben', function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(src.indexOf("var LOBBY_KEY = 'werwolf.lobby.v1'") >= 0);
  assert.ok(src.indexOf("var GAME_KEY = 'werwolf.game.v1'") >= 0);
  assert.ok(src.indexOf("var SCORE_KEY = 'werwolf.scores.v1'") >= 0);
  assert.ok(src.indexOf("var SETUP_KEY = 'werwolf.setup.v1'") >= 0);
  assert.ok(src.indexOf('selfTell') >= 0);
  assert.ok(src.indexOf('Wir erzählen selber') >= 0);
});

console.log(passed + ' narrator tests ok');
