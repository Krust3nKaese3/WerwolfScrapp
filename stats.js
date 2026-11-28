/* Statistik aus kompakten Spielprotokollen.
   OpenScr lässt pro Schlüssel höchstens 256 KiB Text zu (assertStorageValue).
   Eine Summe über alle Schlüssel gibt es dort nicht. Dieses Protokoll liegt in einem Schlüssel.
   Ab mehr als MAX_GAMES Detailspielen oder ab SAFE_BYTES werden die ältesten Spiele
   zu Summen pro Spieler und Rolle gefaltet. Die ausgewerteten Zahlen bleiben gleich.
   Gefaltete Spiele behalten diese Summen, nicht mehr die Einzelereignisse. */
(function (root) {
  var LIMITS = {
    valueBytes: 256 * 1024,
    safeBytes: 200 * 1024,
    maxGames: 60
  };

  var TEAMS = { werwolf: 'wolf', politiker: 'politiker' };

  function teamOf(role) {
    return TEAMS[role] || 'village';
  }

  function emptyHistory() {
    return { v: 1, games: [], sum: {} };
  }

  function utf8Bytes(value) {
    var text = String(value == null ? '' : value);
    var n = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) {
        n += 4;
        i += 1;
      } else n += 3;
    }
    return n;
  }

  function historyBytes(history) {
    return utf8Bytes(JSON.stringify(history));
  }

  function blankRole() {
    return { g: 0, w: 0, d: 0, ds: 0, h: 0, tk: 0, ok: {} };
  }

  function slot(out, pid) {
    if (!out[pid]) out[pid] = { g: 0, w: 0, d: 0, ds: 0, roles: {} };
    return out[pid];
  }

  function roleSlot(out, pid, role) {
    var player = slot(out, pid);
    if (!player.roles[role]) player.roles[role] = blankRole();
    return player.roles[role];
  }

  function tallyGame(game) {
    var out = {};
    var winners = {};
    (game.wp || []).forEach(function (pid) { winners[pid] = true; });
    (game.pl || []).forEach(function (row) {
      var pid = row[0];
      var dealt = row[1] || '';
      if (!pid) return;
      var player = slot(out, pid);
      player.g += 1;
      var role = roleSlot(out, pid, dealt);
      role.g += 1;
      if (winners[pid]) {
        player.w += 1;
        role.w += 1;
      }
    });
    (game.ev || []).forEach(function (ev) {
      if (!ev || !ev.length) return;
      if (ev[0] === 'd') {
        var dead = slot(out, ev[2]);
        var round = Number(ev[1]) || 0;
        dead.d += 1;
        dead.ds += round;
        var diedAs = roleSlot(out, ev[2], ev[4] || '');
        diedAs.d += 1;
        diedAs.ds += round;
      } else if (ev[0] === 'h') {
        roleSlot(out, ev[2], ev[3] || '').h += 1;
      } else if (ev[0] === 'k') {
        var killer = roleSlot(out, ev[2], ev[3] || '');
        if (ev[6]) killer.tk += 1;
        else {
          var victimRole = ev[5] || '';
          killer.ok[victimRole] = (killer.ok[victimRole] || 0) + 1;
        }
      }
    });
    return out;
  }

  function addInto(sum, part) {
    Object.keys(part).forEach(function (pid) {
      var src = part[pid];
      var dst = slot(sum, pid);
      dst.g += src.g;
      dst.w += src.w;
      dst.d += src.d;
      dst.ds += src.ds;
      Object.keys(src.roles).forEach(function (role) {
        var from = src.roles[role];
        var to = roleSlot(sum, pid, role);
        to.g += from.g;
        to.w += from.w;
        to.d += from.d;
        to.ds += from.ds;
        to.h += from.h;
        to.tk += from.tk;
        Object.keys(from.ok).forEach(function (victimRole) {
          to.ok[victimRole] = (to.ok[victimRole] || 0) + from.ok[victimRole];
        });
      });
    });
  }

  function foldGame(history, game) {
    addInto(history.sum, tallyGame(game));
  }

  function resolveLimits(limits) {
    return {
      maxGames: limits && limits.maxGames != null ? limits.maxGames : LIMITS.maxGames,
      maxBytes: limits && limits.maxBytes != null ? limits.maxBytes : LIMITS.safeBytes
    };
  }

  function compactHistory(history, limits) {
    var bounds = resolveLimits(limits);
    if (!history.sum) history.sum = {};
    if (!Array.isArray(history.games)) history.games = [];
    while (history.games.length && (history.games.length > bounds.maxGames || historyBytes(history) > bounds.maxBytes)) {
      foldGame(history, history.games.shift());
    }
    return history;
  }

  function appendGame(history, game, limits) {
    var next = history ? JSON.parse(JSON.stringify(history)) : emptyHistory();
    if (!Array.isArray(next.games)) next.games = [];
    if (!next.sum || typeof next.sum !== 'object') next.sum = {};
    next.v = 1;
    next.games.push(game);
    return compactHistory(next, limits);
  }

  function combine(history) {
    var sum = {};
    addInto(sum, JSON.parse(JSON.stringify((history && history.sum) || {})));
    ((history && history.games) || []).forEach(function (game) { addInto(sum, tallyGame(game)); });
    return sum;
  }

  function copyRole(role) {
    var other = {};
    Object.keys(role.ok || {}).forEach(function (key) {
      if (role.ok[key]) other[key] = role.ok[key];
    });
    return {
      got: role.g,
      won: role.w,
      deaths: role.d,
      deathRoundSum: role.ds,
      healed: role.h,
      teamKills: role.tk,
      otherKills: other
    };
  }

  function playerStats(history, pid) {
    var all = combine(history);
    var row = all[pid] || { g: 0, w: 0, d: 0, ds: 0, roles: {} };
    var roles = {};
    Object.keys(row.roles || {}).forEach(function (role) {
      var stats = copyRole(row.roles[role]);
      var used = stats.got || stats.won || stats.deaths || stats.healed || stats.teamKills || Object.keys(stats.otherKills).length;
      if (used) roles[role] = stats;
    });
    return {
      games: row.g,
      wins: row.w,
      deaths: row.d,
      deathRoundSum: row.ds,
      roles: roles
    };
  }

  function roleCounts(role) {
    return { games: role.got || 0, wins: role.won || 0, deaths: role.deaths || 0 };
  }

  function addCounts(left, right) {
    return {
      games: left.games + right.games,
      wins: left.wins + right.wins,
      deaths: left.deaths + right.deaths
    };
  }

  function emptyCounts() {
    return { games: 0, wins: 0, deaths: 0 };
  }

  /* Host-Statistik erwartet Spiele/Siege/Tode und Rollen werwolf/dorfbewohner als Team-Summen. */
  function hostRecord(history, pid) {
    var stats = playerStats(history, pid);
    var roles = {};
    var wolf = emptyCounts();
    var village = emptyCounts();
    Object.keys(stats.roles || {}).forEach(function (role) {
      var counts = roleCounts(stats.roles[role]);
      roles[role] = counts;
      var team = teamOf(role);
      if (team === 'wolf') wolf = addCounts(wolf, counts);
      else if (team === 'village') village = addCounts(village, counts);
    });
    roles.werwolf = wolf;
    roles.dorfbewohner = village;
    return {
      id: String(pid),
      games: stats.games,
      wins: stats.wins,
      deaths: stats.deaths,
      roles: roles
    };
  }

  function hostRecords(history) {
    var all = combine(history);
    return Object.keys(all).filter(function (pid) {
      return pid && pid !== '0' && all[pid] && all[pid].g > 0;
    }).map(function (pid) { return hostRecord(history, pid); });
  }

  function bySeat(state) {
    var map = {};
    (state.players || []).forEach(function (player) { map[player.id] = player; });
    return map;
  }

  function pidOf(map, id) {
    if (id == null || Number(id) === 0) return 0;
    var player = map[Number(id)];
    if (!player) return 0;
    return player.pid || ('n:' + player.name);
  }

  function oneTarget(value) {
    if (Array.isArray(value)) return value.length ? Number(value[0]) : null;
    if (value == null || value === '') return null;
    var n = Number(value);
    return isNaN(n) ? null : n;
  }

  function allTargets(value) {
    if (Array.isArray(value)) return value.map(Number);
    var one = oneTarget(value);
    return one == null ? [] : [one];
  }

  var KIND = {
    wolf: 'w',
    heal: 'h',
    poison: 'g',
    seer: 's',
    amor: 'a',
    steal: 't',
    copy: 'c',
    nutte: 'u',
    schaufel: 'f',
    kill: 'k',
    jaeger: 'j',
    duell: 'd'
  };

  function sameKiller(list, act) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].a === act.a && list[i].n === act.n && list[i].p === act.p && oneTarget(list[i].t) === oneTarget(act.t)) return true;
    }
    return false;
  }

  function killersFor(hit, acts) {
    var found = [];
    acts.forEach(function (act) {
      if (act.n !== hit.n || oneTarget(act.t) !== hit.h) return;
      if (hit.c === 'woelfe' && act.p === 'wolf') found.push(act);
      if (hit.c === 'woelfe' && hit.by && act.p === 'kill' && act.a === hit.by) found.push(act);
      if (hit.c === 'gift' && act.p === 'poison') found.push(act);
      if (hit.c === 'schuss' && act.p === 'kill') found.push(act);
    });
    var unique = [];
    found.forEach(function (act) { if (!sameKiller(unique, act)) unique.push(act); });
    return unique;
  }

  function buildRecord(state, now) {
    var map = bySeat(state || {});
    var book = (state && state.book) || [];
    var acts = [];
    var dies = [];
    var saves = [];
    var hits = [];
    book.forEach(function (ev) {
      if (!ev || !ev.k) return;
      if (ev.k === 'act') acts.push(ev);
      else if (ev.k === 'die') dies.push(ev);
      else if (ev.k === 'save') saves.push(ev);
      else if (ev.k === 'hit') hits.push(ev);
    });
    var winners = {};
    (state.scoredNames || []).forEach(function (name) { winners[name] = true; });
    var wp = [];
    var pl = (state.players || []).map(function (player) {
      var pid = pidOf(map, player.id);
      if (winners[player.name]) wp.push(pid);
      var dealt = state.dealt && state.dealt[player.id] ? state.dealt[player.id] : player.role;
      return [pid, dealt || '', player.role || ''];
    });
    var ev = [];
    acts.forEach(function (act) {
      var targets = allTargets(act.t).map(function (id) { return pidOf(map, id); });
      if (act.p === 'vote') {
        ev.push(['v', act.n || 1, pidOf(map, act.a), targets.length ? targets[0] : 0, act.r || '']);
        return;
      }
      if (!KIND[act.p]) return;
      var row = ['n', act.n || 1, pidOf(map, act.a), KIND[act.p], targets.length ? targets[0] : 0, act.r || ''];
      if (targets.length > 1) row.push(targets[1]);
      ev.push(row);
    });
    dies.forEach(function (death) {
      ev.push(['d', death.n || 1, pidOf(map, death.a), death.c || '', death.r || '']);
    });
    saves.forEach(function (save) {
      ev.push(['h', save.n || 1, pidOf(map, save.a), save.r || '']);
    });
    var seenKill = {};
    function credit(act, death) {
      if (!act || !death) return;
      var key = act.a + ':' + death.a + ':' + death.n + ':' + death.c;
      if (seenKill[key]) return;
      seenKill[key] = true;
      var same = teamOf(act.r) === teamOf(death.r) ? 1 : 0;
      ev.push(['k', death.n || 1, pidOf(map, act.a), act.r || '', pidOf(map, death.a), death.r || '', same]);
    }
    hits.forEach(function (hit) {
      var death = null;
      for (var i = 0; i < dies.length; i++) {
        if (dies[i].a === hit.t && dies[i].n === hit.n && dies[i].c === hit.c) death = dies[i];
      }
      if (!death) return;
      killersFor(hit, acts).forEach(function (act) { credit(act, death); });
    });
    dies.forEach(function (death) {
      if (death.c !== 'jaeger' && death.c !== 'duell') return;
      var kind = death.c === 'jaeger' ? 'jaeger' : 'duell';
      acts.forEach(function (act) {
        if (act.p === kind && act.n === death.n && oneTarget(act.t) === death.a) credit(act, death);
      });
    });
    return {
      t: typeof now === 'number' ? Math.floor(now) : Date.now(),
      m: state && state.selfTell ? 1 : 0,
      w: (state && state.winner) || '',
      wp: wp,
      pl: pl,
      ev: ev
    };
  }

  root.WerwolfStats = {
    LIMITS: LIMITS,
    emptyHistory: emptyHistory,
    utf8Bytes: utf8Bytes,
    historyBytes: historyBytes,
    tallyGame: tallyGame,
    compactHistory: compactHistory,
    appendGame: appendGame,
    playerStats: playerStats,
    hostRecord: hostRecord,
    hostRecords: hostRecords,
    buildRecord: buildRecord,
    teamOf: teamOf
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
