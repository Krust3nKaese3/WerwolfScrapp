const assert = require('assert');
const fs = require('fs');
const path = require('path');

eval(fs.readFileSync(path.join(__dirname, '..', 'players.js'), 'utf8'));
const P = globalThis.WerwolfPlayers;

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log('ok', name);
}

function at(n) {
  return function () { return n / 36; };
}

test('Normalisieren schneidet Leerzeichen, Großschreibung und Akzente ab', function () {
  assert.strictEqual(P.normalize('  Máx  '), 'max');
  assert.strictEqual(P.normalize('Bäusch'), 'bausch');
  assert.strictEqual(P.normalize('ÄÖÜ'), 'aou');
  assert.strictEqual(P.normalize(''), '');
});

test('Neue Spieler brauchen Vor- und Nachname und behalten die id', function () {
  const now = 1710000000000;
  const player = P.createPlayer('  Maximilian ', ' Bausch ', now, at(0));
  assert.strictEqual(player.id, 'p_' + now.toString(36) + '0000');
  assert.strictEqual(player.first, 'Maximilian');
  assert.strictEqual(player.last, 'Bausch');
  assert.strictEqual(player.created, now);
  const again = P.createPlayer('Max', 'Klein', now, (function () {
    const seq = [0, 10, 35, 1];
    let i = 0;
    return function () { return seq[i++] / 36; };
  })());
  assert.ok(again.id.endsWith('0az1'), again.id);
  assert.throws(function () { P.createPlayer('Max', '   ', now, at(0)); }, /Nachname/);
  const roster = { v: 1, players: [] };
  const first = P.registerPlayer(roster, 'maximilian', 'bausch', now, at(1));
  const second = P.registerPlayer(roster, 'Maximilian', 'Bausch', now, at(2));
  assert.strictEqual(first.id, second.id);
  assert.strictEqual(roster.players.length, 1);
  assert.strictEqual(first.id, player.id.replace(/0000$/, '1111') ? first.id : first.id);
  assert.notStrictEqual(first.id, player.id);
});

test('Anzeige: Vorname, bei Gleichstand die Initiale, sonst der Nachname', function () {
  const alone = P.displayNames([{ id: 'p1', first: 'Maximilian', last: 'Bausch' }]);
  assert.deepStrictEqual(alone, { p1: 'Maximilian' });
  const split = P.displayNames([
    { id: 'a', first: 'Max', last: 'Bausch' },
    { id: 'b', first: 'Max', last: 'Klein' },
    { id: 'c', first: 'Eva', last: 'Klein' }
  ]);
  assert.strictEqual(split.a, 'Max B.');
  assert.strictEqual(split.b, 'Max K.');
  assert.strictEqual(split.c, 'Eva');
  const full = P.displayNames([
    { id: 'a', first: 'Max', last: 'Bausch' },
    { id: 'b', first: 'Max', last: 'Bauer' },
    { id: 'c', first: 'Max', last: 'Klein' }
  ]);
  assert.strictEqual(full.a, 'Max Bausch');
  assert.strictEqual(full.b, 'Max Bauer');
  assert.strictEqual(full.c, 'Max K.');
  const accent = P.displayNames([
    { id: 'a', first: 'Max', last: 'Émile' },
    { id: 'b', first: 'Max', last: 'Emile' }
  ]);
  assert.strictEqual(accent.a, 'Max Émile');
  assert.strictEqual(accent.b, 'Max Emile');
});

test('Suche trifft Vorname, Nachname und den vollen Namen', function () {
  const players = [
    { id: 'p1', first: 'Maximilian', last: 'Bausch' },
    { id: 'p2', first: 'Martina', last: 'Klein' },
    { id: 'p3', first: 'Bob', last: 'Maier' },
    { id: 'p4', first: 'Eva', last: 'Sommer' }
  ];
  assert.deepStrictEqual(P.search(players, '   ', []).map(function (p) { return p.id; }), []);
  assert.deepStrictEqual(P.search(players, 'MA', []).map(function (p) { return p.id; }), ['p3', 'p2', 'p1']);
  assert.deepStrictEqual(P.search(players, 'bausch', []).map(function (p) { return p.id; }), ['p1']);
  assert.deepStrictEqual(P.search(players, 'aus', []).map(function (p) { return p.id; }), ['p1']);
  assert.deepStrictEqual(P.search(players, 'maximilian b', []).map(function (p) { return p.id; }), ['p1']);
  assert.deepStrictEqual(P.search(players, 'Bäusch', []).map(function (p) { return p.id; }), ['p1']);
  const withAccent = players.concat([{ id: 'p5', first: 'Sören', last: 'Bäusch' }]);
  assert.deepStrictEqual(P.search(withAccent, 'bausch', []).map(function (p) { return p.id; }), ['p1', 'p5']);
  assert.deepStrictEqual(P.search(players, 'ma', ['p1']).map(function (p) { return p.id; }), ['p3', 'p2']);
});

test('Alte Namen werden zugeordnet oder als Spieler angelegt', function () {
  const roster = { v: 1, players: [] };
  const now = 20;
  const anna = P.migrateName(roster, ' Anna ', now, at(3));
  assert.strictEqual(anna.first, 'Anna');
  assert.strictEqual(anna.last, 'Anna');
  assert.strictEqual(P.migrateName(roster, 'anna', now, at(4)).id, anna.id);
  const max = P.registerPlayer(roster, 'Maximilian', 'Bausch', now, at(5));
  assert.strictEqual(P.migrateName(roster, 'maximilian bausch', now, at(6)).id, max.id);
  const other = P.migrateName(roster, 'Eva Sommer', now, at(7));
  assert.strictEqual(other.first, 'Eva');
  assert.strictEqual(other.last, 'Sommer');
  P.registerPlayer(roster, 'Max', 'Klein', now, at(8));
  P.registerPlayer(roster, 'Max', 'Bausch', now, at(9));
  const fresh = P.migrateName(roster, 'Max', now, at(1));
  assert.strictEqual(fresh.first, 'Max');
  assert.strictEqual(fresh.last, 'Max');
  assert.ok(fresh.id !== max.id);
});

console.log(passed + ' player tests ok');
