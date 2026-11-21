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

test('Quick Amor aus ruft Amor in Nacht 1 vor den Wölfen und später nur zum Schein', function () {
  const counts = blankCounts();
  counts.werwolf = 1;
  counts.amor = 1;
  counts.dorfbewohner = 2;
  const state = make(['Wolf', 'Amor', 'Anna', 'Bert'], counts, { selfTell: true, rolePool: false, quickAmor: false });
  setRoles(state, ['werwolf', 'amor', 'dorfbewohner', 'dorfbewohner']);
  state.players[1].amorLinked = false;
  W.beginNight(state);
  const script = W.narratorScript(state);
  assert.strictEqual(script[0].role, 'amor');
  assert.strictEqual(script[0].quiet, false);
  assert.ok(script.findIndex(function (row) { return row.role === 'werwolf'; }) > 0);
  W.send(state, { type: 'ack' });
  assert.strictEqual(W.view(state).prompt.kind, 'amor');
  W.send(state, { type: 'confirm', ids: [3, 4] });
  assert.strictEqual(state.bonds.length, 1);
  assert.strictEqual(state.wolfVotes[1], undefined);
  let guard = 0;
  while (state.screen === 'night' && !(W.view(state).prompt && W.view(state).prompt.kind === 'wolf')) {
    const view = W.view(state);
    if (view.step === 'sheet' || view.step === 'call') W.send(state, { type: 'ack' });
    else if (view.prompt && (view.prompt.kind === 'sleep' || view.prompt.kind === 'love')) W.send(state, { type: 'ack' });
    else W.send(state, { type: 'ack' });
    if (++guard > 20) throw new Error(JSON.stringify(W.view(state)));
  }
  assert.strictEqual(W.view(state).prompt.kind, 'wolf');
  assert.strictEqual(state.bonds.length, 1);
  assert.strictEqual(state.wolfVotes[1], undefined);
  W.beginNight(state);
  assert.strictEqual(state.nightNumber, 2);
  const later = W.narratorScript(state);
  assert.ok(later.some(function (row) { return row.role === 'amor'; }));
  W.send(state, { type: 'ack' });
  assert.notStrictEqual(W.view(state).prompt && W.view(state).prompt.kind, 'amor');
  assert.strictEqual(state.players[1].amorLinked, true);
});

function reachHexe(state, choose) {
  let guard = 0;
  while (state.screen === 'night') {
    const view = W.view(state);
    const call = state.narratorCalls && state.narratorCalls[state.narratorIndex];
    if (view.step === 'show' && call && call.role === 'hexe' && !state.narratorQuiet) return view;
    if (view.step === 'sheet' || view.step === 'call') W.send(state, { type: 'ack' });
    else {
      const choice = choose(view, state);
      if (choice) W.send(state, choice);
      else if (view.prompt && ['sleep', 'love', 'notice', 'info', 'seer-result'].indexOf(view.prompt.kind) >= 0) W.send(state, { type: 'ack' });
      else W.send(state, { type: 'skip' });
    }
    if (++guard > 40) throw new Error('reach hexe ' + JSON.stringify(W.view(state)));
  }
  throw new Error('Nacht vorbei vor Hexe');
}

test('Erzählermodus: Hexe sieht das Wolfsopfer, Heilung rettet und verbraucht einen Trank', function () {
  const counts = blankCounts();
  counts.werwolf = 1;
  counts.nutte = 1;
  counts.dorfbewohner = 1;
  counts.hexe = 1;
  const state = make(['Gast', 'Wirt', 'Wolf', 'Hexe'], counts, { selfTell: true, rolePool: false, healPotions: 2 });
  setRoles(state, ['nutte', 'dorfbewohner', 'werwolf', 'hexe']);
  W.beginNight(state);
  const view = reachHexe(state, function (current) {
    if (current.prompt && current.prompt.kind === 'nutte') return { type: 'confirm', id: 2 };
    if (current.prompt && current.prompt.kind === 'wolf') return { type: 'confirm', id: 2 };
    return null;
  });
  assert.strictEqual(view.prompt.kind, 'heal');
  assert.strictEqual(view.prompt.reactive, true);
  assert.deepStrictEqual(view.prompt.victims.map(Number), [1, 2]);
  assert.deepStrictEqual(W.targetsFor(state, view.prompt, 4).map(function (p) { return p.id; }), [1, 2]);
  assert.ok(!view.prompt.attacks);
  W.send(state, { type: 'select', id: 1 });
  W.send(state, { type: 'back' });
  assert.deepStrictEqual(state.selection, []);
  assert.deepStrictEqual(state.heals, []);
  assert.strictEqual(W.playerById(state, 4).healsLeft, 2);
  assert.strictEqual(W.view(state).prompt.kind, 'heal');
  W.send(state, { type: 'confirm', id: 1 });
  assert.deepStrictEqual(state.heals.map(Number), [2]);
  assert.strictEqual(W.playerById(state, 4).healsLeft, 1);
  assert.notStrictEqual(W.view(state).prompt.kind, 'heal');
  W.send(state, { type: 'skip' });
  let guard = 0;
  while (state.screen === 'night') {
    const step = W.view(state);
    if (step.step === 'call' || step.step === 'sheet') W.send(state, { type: 'ack' });
    else if (step.prompt && ['sleep', 'love', 'notice', 'info', 'seer-result'].indexOf(step.prompt.kind) >= 0) W.send(state, { type: 'ack' });
    else W.send(state, { type: 'skip' });
    if (++guard > 30) throw new Error(JSON.stringify(W.view(state)));
  }
  assert.strictEqual(W.playerById(state, 1).alive, true);
  assert.strictEqual(W.playerById(state, 2).alive, true);
  assert.strictEqual(W.playerById(state, 4).healsLeft, 1);
});

test('Erzählermodus: mehrere Wolfsopfer, jeder Trank ein Haus', function () {
  const counts = blankCounts();
  counts.nachahmerin = 1;
  counts.werwolf = 1;
  counts.dorfbewohner = 1;
  counts.hexe = 1;
  const state = make(['Nach', 'Wolf', 'Anna', 'Hexe'], counts, { selfTell: true, rolePool: false, healPotions: 2 });
  setRoles(state, ['nachahmerin', 'werwolf', 'dorfbewohner', 'hexe']);
  W.beginNight(state);
  const view = reachHexe(state, function (current) {
    if (current.prompt && current.prompt.kind === 'copy') return { type: 'confirm', id: 2 };
    if (current.prompt && current.prompt.kind === 'kill') return { type: 'confirm', id: 3 };
    if (current.prompt && current.prompt.kind === 'wolf') return { type: 'confirm', id: 1 };
    return null;
  });
  assert.strictEqual(view.prompt.reactive, true);
  assert.deepStrictEqual(view.prompt.victims.map(Number), [1, 3]);
  W.send(state, { type: 'confirm', id: 3 });
  assert.deepStrictEqual(state.heals.map(Number), [3]);
  assert.strictEqual(W.playerById(state, 4).healsLeft, 1);
  assert.strictEqual(W.view(state).prompt.kind, 'heal');
  assert.deepStrictEqual(W.view(state).prompt.victims.map(Number), [1]);
  W.send(state, { type: 'confirm', id: 1 });
  assert.deepStrictEqual(state.heals.map(Number).sort(), [1, 3]);
  assert.strictEqual(W.playerById(state, 4).healsLeft, 0);
  assert.strictEqual(W.view(state).prompt.kind, 'poison');
  W.send(state, { type: 'skip' });
  playNarrator(state, function () { return null; });
  assert.strictEqual(W.playerById(state, 1).alive, true);
  assert.strictEqual(W.playerById(state, 3).alive, true);
});

test('Erzählermodus: ohne Wolfsopfer kein Heiltrank, tote Hexe verrät nichts', function () {
  const counts = blankCounts();
  counts.werwolf = 1;
  counts.dorfbewohner = 2;
  counts.hexe = 1;
  const state = make(['Wolf', 'Anna', 'Bert', 'Hexe'], counts, { selfTell: true, rolePool: false, healPotions: 2 });
  setRoles(state, ['werwolf', 'dorfbewohner', 'dorfbewohner', 'hexe']);
  W.beginNight(state);
  let guard = 0;
  while (state.screen === 'night' && !(W.view(state).prompt && W.view(state).prompt.victimReveal)) {
    const view = W.view(state);
    if (view.step === 'sheet' || view.step === 'call') W.send(state, { type: 'ack' });
    else if (view.prompt && view.prompt.kind === 'wolf') W.send(state, { type: 'skip' });
    else if (view.prompt && ['sleep', 'love', 'notice', 'info', 'seer-result'].indexOf(view.prompt.kind) >= 0) W.send(state, { type: 'ack' });
    else W.send(state, { type: 'skip' });
    if (++guard > 30) throw new Error(JSON.stringify(W.view(state)));
  }
  const shown = W.view(state).prompt;
  assert.strictEqual(shown.victimReveal, true);
  assert.deepStrictEqual(shown.victims, []);
  assert.strictEqual(shown.text, 'Heute Nacht kein Opfer der Wölfe');
  assert.strictEqual(W.playerById(state, 4).healsLeft, 2);
  W.send(state, { type: 'ack' });
  assert.strictEqual(W.view(state).prompt.kind, 'poison');
  assert.strictEqual(W.playerById(state, 4).healsLeft, 2);

  const dead = make(['Wolf', 'Anna', 'Bert', 'Hexe'], counts, { selfTell: true, rolePool: false });
  setRoles(dead, ['werwolf', 'dorfbewohner', 'dorfbewohner', 'hexe']);
  W.playerById(dead, 4).alive = false;
  W.beginNight(dead);
  guard = 0;
  while (dead.screen === 'night' && !(dead.narratorCalls[dead.narratorIndex] && dead.narratorCalls[dead.narratorIndex].role === 'hexe' && dead.step === 'call')) {
    const view = W.view(dead);
    if (view.step === 'sheet' || view.step === 'call') W.send(dead, { type: 'ack' });
    else if (view.prompt && view.prompt.kind === 'wolf') W.send(dead, { type: 'confirm', id: 2 });
    else if (view.prompt && ['sleep', 'love', 'notice', 'info', 'seer-result'].indexOf(view.prompt.kind) >= 0) W.send(dead, { type: 'ack' });
    else W.send(dead, { type: 'skip' });
    if (++guard > 30) throw new Error(JSON.stringify(W.view(dead)));
  }
  assert.strictEqual(dead.narratorQuiet, true);
  assert.strictEqual(W.view(dead).prompt, null);
  assert.strictEqual(dead.step, 'call');
  assert.ok(!JSON.stringify(W.view(dead)).includes('Opfer'));
});

test('Ohne Erzählermodus bleibt die Hexe blind, auch wenn mitten in der Nacht umgeschaltet wird', function () {
  const counts = blankCounts();
  counts.werwolf = 1;
  counts.dorfbewohner = 2;
  counts.hexe = 1;
  const blind = make(['Wolf', 'Anna', 'Bert', 'Hexe'], counts, { selfTell: false, rolePool: false, healPotions: 2 });
  setRoles(blind, ['werwolf', 'dorfbewohner', 'dorfbewohner', 'hexe']);
  W.beginNight(blind);
  W.send(blind, { type: 'night-pick', id: 1 });
  W.send(blind, { type: 'go' });
  W.send(blind, { type: 'confirm', id: 2 });
  W.send(blind, { type: 'night-pick', id: 4 });
  W.send(blind, { type: 'go' });
  const classic = W.view(blind).prompt;
  assert.strictEqual(classic.kind, 'heal');
  assert.ok(!classic.reactive);
  assert.ok(!classic.victims);
  assert.ok(!classic.attacks);
  const houses = W.targetsFor(blind, classic, 4).map(function (p) { return p.id; });
  assert.deepStrictEqual(houses, [1, 2, 3, 4]);
  W.send(blind, { type: 'confirm', id: 3 });
  assert.deepStrictEqual(blind.heals.map(Number), [3]);
  assert.strictEqual(W.playerById(blind, 4).healsLeft, 1);
  assert.strictEqual(W.view(blind).prompt.kind, 'heal');
  assert.ok(W.targetsFor(blind, W.view(blind).prompt, 4).some(function (p) { return p.id === 2; }));
  W.send(blind, { type: 'skip' });
  assert.strictEqual(W.view(blind).prompt.kind, 'poison');
  W.send(blind, { type: 'skip' });
  playClassic(blind, function () { return null; });
  assert.strictEqual(W.playerById(blind, 2).alive, false);
  assert.strictEqual(W.playerById(blind, 3).alive, true);

  const switched = make(['Wolf', 'Anna', 'Bert', 'Hexe'], counts, { selfTell: true, rolePool: false, healPotions: 2 });
  setRoles(switched, ['werwolf', 'dorfbewohner', 'dorfbewohner', 'hexe']);
  const pool = blankCounts();
  pool.werwolf = 2;
  pool.dorfbewohner = 2;
  pool.hexe = 1;
  switched.counts = pool;
  switched.rolePool = true;
  switched.wolfMin = 1;
  switched.wolfMax = 2;
  W.beginNight(switched);
  let guard = 0;
  while (switched.screen === 'night' && !(switched.step === 'call' && switched.narratorCalls[switched.narratorIndex].role === 'werwolf' && switched.narratorQuiet)) {
    const view = W.view(switched);
    if (view.step === 'sheet' || view.step === 'call') W.send(switched, { type: 'ack' });
    else if (view.prompt && view.prompt.kind === 'wolf') W.send(switched, { type: 'confirm', id: 2 });
    else if (view.prompt && ['sleep', 'love', 'notice', 'info', 'seer-result'].indexOf(view.prompt.kind) >= 0) W.send(switched, { type: 'ack' });
    else W.send(switched, { type: 'skip' });
    if (++guard > 30) throw new Error(JSON.stringify(W.view(switched)));
  }
  assert.strictEqual(switched.wolfVotes[1], 2);
  W.send(switched, { type: 'toggle-self-tell' });
  assert.strictEqual(switched.selfTell, false);
  assert.strictEqual(switched.step, 'list');
  W.send(switched, { type: 'night-pick', id: 4 });
  W.send(switched, { type: 'go' });
  const later = W.view(switched).prompt;
  assert.strictEqual(later.kind, 'heal');
  assert.ok(!later.reactive);
  assert.deepStrictEqual(W.targetsFor(switched, later, 4).map(function (p) { return p.id; }), [1, 2, 3, 4]);

  const told = make(['Wolf', 'Anna', 'Bert', 'Hexe'], counts, { selfTell: false, rolePool: false, healPotions: 1 });
  setRoles(told, ['werwolf', 'dorfbewohner', 'dorfbewohner', 'hexe']);
  W.beginNight(told);
  W.send(told, { type: 'night-pick', id: 1 });
  W.send(told, { type: 'go' });
  W.send(told, { type: 'confirm', id: 2 });
  W.send(told, { type: 'toggle-self-tell' });
  assert.strictEqual(told.step, 'sheet');
  guard = 0;
  while (told.screen === 'night' && !(W.view(told).prompt && W.view(told).prompt.reactive)) {
    const view = W.view(told);
    if (view.step === 'sheet' || view.step === 'call') W.send(told, { type: 'ack' });
    else if (view.prompt && view.prompt.kind === 'wolf') W.send(told, { type: 'skip' });
    else if (view.prompt && ['sleep', 'love', 'notice', 'info', 'seer-result'].indexOf(view.prompt.kind) >= 0) W.send(told, { type: 'ack' });
    else W.send(told, { type: 'skip' });
    if (++guard > 30) throw new Error(JSON.stringify(W.view(told)));
  }
  assert.deepStrictEqual(W.view(told).prompt.victims.map(Number), [2]);
  assert.deepStrictEqual(W.targetsFor(told, W.view(told).prompt, 4).map(function (p) { return p.id; }), [2]);
  W.send(told, { type: 'confirm', id: 2 });
  assert.strictEqual(W.playerById(told, 4).healsLeft, 0);
  assert.deepStrictEqual(told.heals.map(Number), [2]);
  assert.strictEqual(W.view(told).prompt.kind, 'poison');
});

test('Schalter merkt sich nur ein zusätzliches Feld, alte Schlüssel bleiben', function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(src.indexOf("var LOBBY_KEY = 'werwolf.lobby.v1'") >= 0);
  assert.ok(src.indexOf("var GAME_KEY = 'werwolf.game.v1'") >= 0);
  assert.ok(src.indexOf("var SCORE_KEY = 'werwolf.scores.v1'") >= 0);
  assert.ok(src.indexOf("var SETUP_KEY = 'werwolf.setup.v1'") >= 0);
  assert.ok(src.indexOf('selfTell') >= 0);
  assert.ok(src.indexOf('Wir erzählen selber') >= 0);
  assert.ok(src.indexOf('quickAmor') >= 0);
  assert.ok(src.indexOf("var SETUP_KEY = 'werwolf.setup.v1'") >= 0);
});

console.log(passed + ' narrator tests ok');
