const assert = require('assert');
const fs = require('fs');
const path = require('path');

eval(fs.readFileSync(path.join(__dirname, '..', 'players.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'stats.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8'));
const S = globalThis.WerwolfStats;
const W = globalThis.Werwolf;

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('ok', name);
}

function counts(wolves, village) {
  const out = {};
  W.ROLE_ORDER.forEach(function (role) { out[role] = 0; });
  out.werwolf = wolves;
  out.dorfbewohner = village;
  return out;
}

function playNight(state, decide) {
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
    } else if (view.step === 'ready') W.send(state, { type: 'go' });
    else if (view.step === 'handoff') W.send(state, { type: 'ack' });
    else {
      const choice = decide(view, state);
      if (choice) W.send(state, choice);
      else if (view.prompt && ['sleep', 'love', 'notice', 'info', 'seer-result'].indexOf(view.prompt.kind) >= 0) W.send(state, { type: 'ack' });
      else W.send(state, { type: 'skip' });
    }
    if (++guard > 200) throw new Error('night loop ' + JSON.stringify(W.view(state)));
  }
}

function startAndKill(names, roles, votes, mode) {
  const state = W.createGame(names, counts(roles.filter(function (role) { return role === 'werwolf'; }).length, roles.filter(function (role) { return role === 'dorfbewohner'; }).length), {
    rng: function () { return 0; },
    rolePool: false,
    quickAmor: false,
    selfTell: mode === 'tell'
  });
  roles.forEach(function (role, index) {
    const player = state.players[index];
    player.role = role;
    player.pid = 'p' + (index + 1);
    player.first = names[index];
    player.last = 'Haus' + (index + 1);
    state.dealt[player.id] = role;
  });
  state.players.forEach(function (player) {
    W.send(state, { type: 'reveal-pick', id: player.id });
    W.send(state, { type: 'ack' });
  });
  W.send(state, { type: 'start-game' });
  assert.strictEqual(state.screen, 'night');
  playNight(state, function (view) {
    const house = votes[view.playerId];
    if (view.prompt && view.prompt.kind === 'wolf' && house) return { type: 'confirm', id: house };
    return null;
  });
  return state;
}

test('Speichergrenze und Spiellimit sind festgelegt', function () {
  assert.strictEqual(S.LIMITS.valueBytes, 256 * 1024);
  assert.strictEqual(S.LIMITS.safeBytes, 200 * 1024);
  assert.strictEqual(S.LIMITS.maxGames, 60);
});

test('Protokoll aus einer Wolfsnacht zählt den Kill und nicht das eigene Team', function () {
  const state = startAndKill(
    ['Welf', 'Anna', 'Bea', 'Chris'],
    ['werwolf', 'dorfbewohner', 'dorfbewohner', 'dorfbewohner'],
    { 1: 2 }
  );
  assert.strictEqual(W.playerById(state, 2).alive, false);
  const record = S.buildRecord(state, 5000);
  assert.strictEqual(record.t, 5000);
  assert.strictEqual(record.m, 0);
  assert.ok(record.pl.some(function (row) { return row[0] === 'p1' && row[1] === 'werwolf'; }));
  const kill = record.ev.filter(function (ev) { return ev[0] === 'k'; });
  assert.strictEqual(kill.length, 1);
  assert.deepStrictEqual(kill[0], ['k', 1, 'p1', 'werwolf', 'p2', 'dorfbewohner', 0]);
  const death = record.ev.filter(function (ev) { return ev[0] === 'd' && ev[2] === 'p2'; })[0];
  assert.strictEqual(death[1], 1);
  assert.strictEqual(death[3], 'woelfe');
  assert.ok(record.ev.some(function (ev) { return ev[0] === 'n' && ev[3] === 'w' && ev[2] === 'p1' && ev[4] === 'p2'; }));
});

test('Ein Heiltrank landet als Rettung im Protokoll und verhindert den Kill', function () {
  const names = ['Welf', 'Hilde', 'Anna', 'Bea'];
  const roles = ['werwolf', 'hexe', 'dorfbewohner', 'dorfbewohner'];
  const state = W.createGame(names, (function () {
    const out = {};
    W.ROLE_ORDER.forEach(function (role) { out[role] = 0; });
    out.werwolf = 1;
    out.hexe = 1;
    out.dorfbewohner = 2;
    return out;
  })(), { rng: function () { return 0; }, rolePool: false, quickAmor: false });
  roles.forEach(function (role, index) {
    state.players[index].role = role;
    state.players[index].healsLeft = role === 'hexe' ? 2 : 0;
    state.players[index].poisonLeft = role === 'hexe';
    state.players[index].pid = 'p' + (index + 1);
    state.dealt[state.players[index].id] = role;
  });
  state.players.forEach(function (player) {
    W.send(state, { type: 'reveal-pick', id: player.id });
    W.send(state, { type: 'ack' });
  });
  W.send(state, { type: 'start-game' });
  playNight(state, function (view) {
    if (view.prompt && view.prompt.kind === 'wolf') return { type: 'confirm', id: 3 };
    if (view.prompt && view.prompt.kind === 'heal' && view.prompt.healsLeft > 1) return { type: 'confirm', id: 3 };
    return null;
  });
  assert.strictEqual(W.playerById(state, 3).alive, true);
  const record = S.buildRecord(state, 8000);
  assert.ok(record.ev.some(function (ev) { return ev[0] === 'h' && ev[2] === 'p3' && ev[3] === 'dorfbewohner'; }));
  assert.ok(!record.ev.some(function (ev) { return ev[0] === 'k'; }));
  const stats = S.playerStats(S.appendGame(S.emptyHistory(), record), 'p3');
  assert.strictEqual(stats.roles.dorfbewohner.healed, 1);
  assert.strictEqual(stats.deaths, 0);
});

test('Team-Kill, Heilung, Sieg und Quote kommen aus dem Protokoll', function () {
  const state = startAndKill(
    ['Welf', 'Wolf', 'Anna', 'Bea', 'Chris'],
    ['werwolf', 'werwolf', 'dorfbewohner', 'dorfbewohner', 'dorfbewohner'],
    { 1: 2, 2: 2 }
  );
  assert.strictEqual(W.playerById(state, 2).alive, false);
  state.winner = 'dorf';
  state.scoredNames = ['Anna', 'Bea'];
  state.selfTell = true;
  const record = S.buildRecord(state, 6000);
  assert.strictEqual(record.m, 1);
  assert.strictEqual(record.w, 'dorf');
  assert.deepStrictEqual(record.wp.slice().sort(), ['p3', 'p4']);
  const kills = record.ev.filter(function (ev) { return ev[0] === 'k' && ev[5] === 'werwolf'; });
  assert.ok(kills.length >= 1);
  kills.forEach(function (ev) { assert.strictEqual(ev[6], 1); });
  const healed = {
    t: 7000,
    m: 0,
    w: 'dorf',
    wp: ['p3'],
    pl: [['p1', 'werwolf', 'werwolf'], ['p3', 'hexe', 'hexe']],
    ev: [
      ['h', 2, 'p3', 'hexe'],
      ['d', 3, 'p1', 'abstimmung', 'werwolf'],
      ['v', 3, 'p3', 'p1', 'hexe']
    ]
  };
  const history = S.appendGame(S.appendGame(S.emptyHistory(), record), healed);
  const wolf = S.playerStats(history, 'p1');
  assert.strictEqual(wolf.games, 2);
  assert.strictEqual(wolf.wins, 0);
  assert.strictEqual(wolf.roles.werwolf.teamKills, 1);
  assert.strictEqual(wolf.roles.werwolf.deaths, 1);
  assert.strictEqual(wolf.roles.werwolf.deathRoundSum, 3);
  assert.strictEqual(wolf.deaths, 1);
  const witch = S.playerStats(history, 'p3');
  assert.strictEqual(witch.games, 2);
  assert.strictEqual(witch.wins, 2);
  assert.strictEqual(witch.roles.dorfbewohner.won, 1);
  assert.strictEqual(witch.roles.hexe.got, 1);
  assert.strictEqual(witch.roles.hexe.won, 1);
  assert.strictEqual(witch.roles.hexe.healed, 1);
  const secondWolf = S.playerStats(history, 'p2');
  assert.strictEqual(secondWolf.roles.werwolf.teamKills, 1);
  assert.strictEqual(secondWolf.roles.werwolf.deaths, 1);
});

test('Andere Rollen stehen getrennt vom eigenen Team', function () {
  const game = {
    t: 1,
    m: 0,
    w: 'woelfe',
    wp: ['p1'],
    pl: [['p1', 'werwolf', 'werwolf'], ['p2', 'dorfbewohner', 'dorfbewohner'], ['p3', 'politiker', 'politiker']],
    ev: [
      ['k', 1, 'p1', 'werwolf', 'p2', 'dorfbewohner', 0],
      ['k', 2, 'p1', 'werwolf', 'p3', 'politiker', 0],
      ['k', 2, 'p1', 'werwolf', 'p9', 'werwolf', 1],
      ['d', 2, 'p2', 'woelfe', 'dorfbewohner'],
      ['d', 4, 'p2', 'gift', 'dorfbewohner']
    ]
  };
  const stats = S.playerStats({ v: 1, games: [game], sum: {} }, 'p1');
  assert.strictEqual(stats.roles.werwolf.teamKills, 1);
  assert.strictEqual(stats.roles.werwolf.otherKills.dorfbewohner, 1);
  assert.strictEqual(stats.roles.werwolf.otherKills.politiker, 1);
  assert.strictEqual(stats.wins, 1);
  assert.strictEqual(stats.roles.werwolf.got, 1);
  const victim = S.playerStats({ v: 1, games: [game], sum: {} }, 'p2');
  assert.strictEqual(victim.deaths, 2);
  assert.strictEqual(victim.deathRoundSum, 6);
  assert.strictEqual(victim.roles.dorfbewohner.deaths, 2);
});

test('Alte Spiele werden zu Summen, die Statistik bleibt gleich', function () {
  const games = [];
  for (let i = 0; i < 5; i++) {
    games.push({
      t: 1000 + i,
      m: i % 2,
      w: i % 2 ? 'dorf' : 'woelfe',
      wp: i % 2 ? ['p2'] : ['p1'],
      pl: [['p1', 'werwolf', 'werwolf'], ['p2', 'dorfbewohner', 'dorfbewohner']],
      ev: [
        ['k', i + 1, 'p1', 'werwolf', 'p2', 'dorfbewohner', 0],
        ['d', i + 1, 'p2', 'woelfe', 'dorfbewohner'],
        ['h', i + 1, 'p1', 'werwolf'],
        ['n', i + 1, 'p1', 'w', 'p2', 'werwolf'],
        ['v', i + 1, 'p2', 0, 'dorfbewohner']
      ]
    });
  }
  let full = S.emptyHistory();
  games.forEach(function (game) { full = S.appendGame(full, game, { maxGames: 20, maxBytes: S.LIMITS.safeBytes }); });
  let folded = S.emptyHistory();
  games.forEach(function (game) { folded = S.appendGame(folded, game, { maxGames: 2, maxBytes: S.LIMITS.safeBytes }); });
  assert.strictEqual(folded.games.length, 2);
  assert.ok(Object.keys(folded.sum).length > 0);
  assert.deepStrictEqual(S.playerStats(folded, 'p1'), S.playerStats(full, 'p1'));
  assert.deepStrictEqual(S.playerStats(folded, 'p2'), S.playerStats(full, 'p2'));
  assert.strictEqual(S.playerStats(folded, 'p1').roles.werwolf.otherKills.dorfbewohner, 5);
  assert.strictEqual(S.playerStats(folded, 'p1').roles.werwolf.healed, 5);
  assert.strictEqual(S.playerStats(folded, 'p1').wins, 3);
  let tiny = S.emptyHistory();
  games.forEach(function (game) { tiny = S.appendGame(tiny, game, { maxGames: 20, maxBytes: 1 }); });
  assert.strictEqual(tiny.games.length, 0);
  assert.deepStrictEqual(S.playerStats(tiny, 'p1'), S.playerStats(full, 'p1'));
  const sample = S.utf8Bytes(JSON.stringify(games[0]));
  assert.ok(sample < 3000, String(sample));
  assert.ok(sample * S.LIMITS.maxGames < S.LIMITS.safeBytes);
});

console.log(passed + ' stats tests ok');
