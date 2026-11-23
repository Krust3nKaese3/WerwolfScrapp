/* Fokussiertes Namensfeld bleibt dasselbe Element. Aufruf: node test/focus-input.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('/tmp/node_modules/jsdom');

const root = path.join(__dirname, '..');

function html() {
  return '<!DOCTYPE html><html><body>' +
    '<button type="button" id="gear-btn"></button>' +
    '<div id="settings-panel" hidden>' +
    '<button type="button" id="settings-close"></button>' +
    '<button type="button" id="set-tell"></button>' +
    '<button type="button" id="set-wolf"></button>' +
    '<button type="button" id="set-amor"></button>' +
    '</div>' +
    '<button type="button" id="bug-btn"></button>' +
    '<div id="bug-panel" hidden>' +
    '<textarea id="bug-text"></textarea>' +
    '<p id="bug-status"></p>' +
    '<button type="button" id="bug-close"></button>' +
    '<button type="button" id="bug-copy"></button>' +
    '</div>' +
    '<div id="app">Laden …</div>' +
    '</body></html>';
}

function waitFor(read, timeout) {
  const start = Date.now();
  return new Promise(function (resolve, reject) {
    (function tick() {
      let value;
      try { value = read(); } catch (error) { reject(error); return; }
      if (value) { resolve(value); return; }
      if (Date.now() - start > timeout) { reject(new Error('timeout')); return; }
      setTimeout(tick, 15);
    })();
  });
}

async function main() {
  const resumed = [];
  const acquired = [];
  const dom = new JSDOM(html(), {
    url: 'http://127.0.0.1/index.html',
    pretendToBeVisual: true,
    runScripts: 'dangerously'
  });
  const window = dom.window;
  const listeners = [];
  window.visualViewport = new window.EventTarget();
  window.OpenScrBridge = {
    multiplayer: {
      onMessage: function (cb) { listeners.push(cb); return function () {}; },
      onPlayersChanged: function () { return function () {}; },
      onJoinRequest: function () { return function () {}; },
      onHostAway: function () { return function () {}; },
      onResumed: function (cb) { resumed.push(cb); return function () {}; },
      send: function () { return Promise.resolve({ seq: 1 }); },
      broadcast: function () { return Promise.resolve({ seq: 1 }); },
      host: function () { return Promise.resolve({}); },
      resume: function () { return Promise.resolve(null); }
    },
    keepAwake: {
      acquire: function () { acquired.push('acquire'); return Promise.resolve(); },
      release: function () { return Promise.resolve(); }
    }
  };
  window.Audio = function Audio() {
    this.play = function () { acquired.push('audio'); return Promise.resolve(); };
  };
  ['players.js', 'stats.js', 'game.js', 'net.js', 'app.js'].forEach(function (file) {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  });

  const input = await waitFor(function () {
    return window.document.getElementById('name-input');
  }, 3000);
  input.value = 'Ann';
  input.focus();
  input.setSelectionRange(2, 3);
  assert.strictEqual(window.document.activeElement, input);

  ['pointerdown', 'touchstart', 'click'].forEach(function (type) {
    input.dispatchEvent(new window.Event(type, { bubbles: true }));
    var list = window.document.getElementById('name-suggest');
    if (list) list.dispatchEvent(new window.Event(type, { bubbles: true }));
  });
  assert.deepStrictEqual(acquired, []);
  assert.strictEqual(window.document.activeElement, input);

  window.dispatchEvent(new window.Event('resize'));
  window.visualViewport.dispatchEvent(new window.Event('resize'));
  assert.strictEqual(resumed.length, 1);
  resumed[0]({
    role: 'host',
    selfId: 'host-1',
    roomCode: 'ABCD',
    players: [],
    status: 'ready'
  });

  const same = window.document.getElementById('name-input');
  assert.strictEqual(same, input);
  assert.strictEqual(window.document.activeElement, input);
  assert.strictEqual(input.value, 'Ann');
  assert.strictEqual(input.selectionStart, 2);
  assert.strictEqual(input.selectionEnd, 3);

  input.blur();
  await new Promise(function (resolve) { setTimeout(resolve, 30); });
  assert.ok(window.document.getElementById('name-input'));
  dom.window.close();
  console.log('focus input ok');
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
