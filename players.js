/* Gemeinsames Spielermodul für Werwolf und Song raten.
   Keine Abhängigkeiten, damit die Datei 1:1 zwischen beiden Apps liegen kann.
   Die App speichert das Verzeichnis selbst. Bei Werwolf ist der Schlüssel werwolf.players.v1:
   {"v":1,"players":[{"id":"p_<Date.now() in base36><4 base36-Zeichen>","first":"Maximilian","last":"Bausch","created":<ms>}]}
   Die id bleibt stabil und wird nie neu vergeben. */
(function (root) {
  function normalize(value) {
    return String(value == null ? '' : value)
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}+/gu, '');
  }

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function randChar(rand) {
    return Math.floor(rand() * 36).toString(36);
  }

  function createPlayer(first, last, now, rand) {
    var f = clean(first);
    var l = clean(last);
    if (!f || !l) throw new Error('Vor- und Nachname sind nötig.');
    if (typeof now !== 'number' || !isFinite(now)) now = Date.now();
    if (typeof rand !== 'function') rand = Math.random;
    var id = 'p_' + Math.floor(now).toString(36) + randChar(rand) + randChar(rand) + randChar(rand) + randChar(rand);
    return { id: id, first: f, last: l, created: Math.floor(now) };
  }

  function fullKey(player) {
    return normalize(player.first) + ' ' + normalize(player.last);
  }

  function registerPlayer(roster, first, last, now, rand) {
    var f = clean(first);
    var l = clean(last);
    if (!f || !l) throw new Error('Vor- und Nachname sind nötig.');
    if (!roster.players) roster.players = [];
    var wantedFirst = normalize(f);
    var wantedLast = normalize(l);
    for (var i = 0; i < roster.players.length; i++) {
      var player = roster.players[i];
      if (normalize(player.first) === wantedFirst && normalize(player.last) === wantedLast) return player;
    }
    var created = createPlayer(f, l, now, rand);
    roster.players.push(created);
    return created;
  }

  function migrateName(roster, name, now, rand) {
    var raw = clean(name);
    if (!raw) return null;
    if (!roster.players) roster.players = [];
    var players = roster.players;
    var normFull = normalize(raw);
    var exact = players.filter(function (player) { return fullKey(player) === normFull; });
    if (exact.length === 1) return exact[0];
    var parts = raw.split(/\s+/);
    if (parts.length >= 2) {
      var first = normalize(parts[0]);
      var last = normalize(parts.slice(1).join(' '));
      var both = players.filter(function (player) {
        return normalize(player.first) === first && normalize(player.last) === last;
      });
      if (both.length === 1) return both[0];
    } else {
      var firsts = players.filter(function (player) { return normalize(player.first) === normFull; });
      if (firsts.length === 1) return firsts[0];
    }
    var createdFirst = parts[0];
    var createdLast = parts.length >= 2 ? parts.slice(1).join(' ') : parts[0];
    var created = createPlayer(createdFirst, createdLast, now, rand);
    players.push(created);
    return created;
  }

  function search(players, query, excludeIds) {
    var q = normalize(query);
    if (!q) return [];
    var exclude = {};
    (excludeIds || []).forEach(function (id) { exclude[id] = true; });
    var rows = [];
    (players || []).forEach(function (player) {
      if (!player || exclude[player.id]) return;
      var first = normalize(player.first);
      var last = normalize(player.last);
      var full = first + ' ' + last;
      if (first.indexOf(q) < 0 && last.indexOf(q) < 0 && full.indexOf(q) < 0) return;
      var prefix = first.indexOf(q) === 0 || last.indexOf(q) === 0 || full.indexOf(q) === 0;
      rows.push({ player: player, prefix: prefix, alpha: full, id: player.id });
    });
    rows.sort(function (a, b) {
      if (a.prefix !== b.prefix) return a.prefix ? -1 : 1;
      if (a.alpha < b.alpha) return -1;
      if (a.alpha > b.alpha) return 1;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
    return rows.map(function (row) { return row.player; });
  }

  function initialChar(last) {
    var text = clean(last);
    if (!text) return '';
    return Array.from(text)[0];
  }

  function displayNames(players) {
    var groups = {};
    var order = [];
    (players || []).forEach(function (player) {
      if (!player || player.id == null) return;
      var key = normalize(player.first);
      if (!groups[key]) {
        groups[key] = [];
        order.push(key);
      }
      groups[key].push(player);
    });
    var out = {};
    order.forEach(function (key) {
      var group = groups[key];
      if (group.length === 1) {
        out[group[0].id] = group[0].first;
        return;
      }
      var byInitial = {};
      group.forEach(function (player) {
        var initial = normalize(initialChar(player.last));
        if (!byInitial[initial]) byInitial[initial] = [];
        byInitial[initial].push(player);
      });
      group.forEach(function (player) {
        var initial = normalize(initialChar(player.last));
        if (byInitial[initial].length > 1) out[player.id] = player.first + ' ' + player.last;
        else out[player.id] = player.first + ' ' + initialChar(player.last).toLocaleUpperCase('de') + '.';
      });
    });
    return out;
  }

  root.WerwolfPlayers = {
    normalize: normalize,
    search: search,
    displayNames: displayNames,
    createPlayer: createPlayer,
    registerPlayer: registerPlayer,
    migrateName: migrateName
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
