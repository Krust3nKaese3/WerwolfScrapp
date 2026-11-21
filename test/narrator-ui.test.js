/* Oberfläche für „Wir erzählen selber“. Aufruf: node test/narrator-ui.test.js */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function startServer() {
  const server = http.createServer(function (req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('no');
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'text/plain' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, port: server.address().port });
    });
  });
}

function quietState() {
  return {
    v: 1,
    screen: 'night',
    step: 'call',
    selfTell: true,
    narratorQuiet: true,
    narratorIndex: 0,
    narratorCalls: [
      { role: 'seherin', playerId: null, slot: 1 },
      { role: 'hexe', playerId: 2, slot: 0 }
    ],
    nightDone: [],
    nightNumber: 1,
    day: 0,
    mayorId: 1,
    players: [
      { id: 1, name: 'Anna', role: 'werwolf', alive: true, loverIds: [] },
      { id: 2, name: 'Bea', role: 'hexe', alive: false, loverIds: [], healsLeft: 2, poisonLeft: true },
      { id: 3, name: 'Chris', role: 'dorfbewohner', alive: true, loverIds: [] },
      { id: 4, name: 'Dora', role: 'dorfbewohner', alive: true, loverIds: [] }
    ],
    counts: { seherin: 2, hexe: 1, werwolf: 1, dorfbewohner: 2 },
    rolePool: true,
    wolfMin: 1,
    wolfMax: 1,
    selection: [],
    prompts: [],
    promptIndex: 0,
    log: [],
    bonds: [],
    heals: [],
    poisons: [],
    wolfVotes: {},
    hosts: {},
    shownDead: [2],
    order: [1, 3, 4],
    config: { selfTell: true }
  };
}

function seerState() {
  const state = quietState();
  state.step = 'show';
  state.narratorQuiet = false;
  state.activeId = 1;
  state.actorId = 1;
  state.players[0].role = 'seherin';
  state.players[1].alive = true;
  state.players[1].role = 'werwolf';
  state.narratorCalls = [{ role: 'seherin', playerId: 1, slot: 0 }];
  state.prompts = [{ kind: 'seer-result', seenId: 2, role: 'werwolf', exact: false, label: 'Böse' }];
  state.promptIndex = 0;
  return state;
}

async function main() {
  const { chromium } = require('/tmp/node_modules/playwright-core');
  const started = await startServer();
  const browser = await chromium.launch({
    executablePath: '/usr/local/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const base = 'http://127.0.0.1:' + started.port + '/index.html';
  try {
    await togglePersists(browser, base);
    await quietAndSeer(browser, base);
    await narratorPlaysNight(browser, base);
    await gearMidGame(browser, base);
    await witchHealScreen(browser, base);
    await witchRules(browser, base);
  } finally {
    await browser.close();
    await new Promise(function (resolve) { started.server.close(resolve); });
  }
  console.log('narrator ui ok');
}

async function togglePersists(browser, base) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, locale: 'de-DE' });
  const errors = [];
  page.on('pageerror', function (error) { errors.push(String(error)); });
  await page.goto(base);
  await page.getByRole('button', { name: 'Wir erzählen selber: aus' }).click();
  await page.waitForFunction(function () {
    const raw = localStorage.getItem('werwolf.setup.v1');
    return raw && raw.indexOf('"selfTell":true') >= 0;
  });
  const keys = await page.evaluate(function () {
    return Object.keys(localStorage).filter(function (key) { return key.indexOf('werwolf.') === 0; });
  });
  keys.forEach(function (key) {
    assert.ok(/^werwolf\.(lobby|setup|game|scores)\.v1$/.test(key), key);
  });
  assert.ok(keys.indexOf('werwolf.setup.v1') >= 0);
  await page.reload();
  await page.getByRole('button', { name: 'Wir erzählen selber: an' }).waitFor();
  await page.getByRole('button', { name: 'Wir erzählen selber: an' }).click();
  await page.waitForFunction(function () {
    const raw = localStorage.getItem('werwolf.setup.v1');
    return raw && raw.indexOf('"selfTell":false') >= 0;
  });
  assert.deepStrictEqual(errors, []);
  await page.close();
}

async function quietAndSeer(browser, base) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, locale: 'de-DE' });
  await page.addInitScript(function (payload) {
    localStorage.setItem('werwolf.game.v1', JSON.stringify(payload));
  }, quietState());
  await page.goto(base);
  await page.getByText('Seherin, wach auf.').waitFor();
  const note = await page.locator('.quiet-note').innerText();
  assert.strictEqual(note, 'Niemand handelt.');
  const weiter = page.getByRole('button', { name: 'Weiter' });
  assert.strictEqual(await weiter.isDisabled(), true);
  await page.waitForFunction(function () {
    const button = document.querySelector('#app [data-quiet="1"]');
    return button && !button.disabled;
  });
  await weiter.click();
  await page.getByText('Hexe, wach auf.').waitFor();
  assert.strictEqual(await page.locator('.quiet-note').innerText(), 'Niemand handelt.');
  await page.close();

  const seer = await browser.newPage({ viewport: { width: 412, height: 915 }, locale: 'de-DE' });
  await seer.addInitScript(function (payload) {
    localStorage.setItem('werwolf.game.v1', JSON.stringify(payload));
  }, seerState());
  await seer.goto(base);
  await seer.locator('.seer-huge').waitFor();
  const text = await seer.locator('#app').innerText();
  assert.ok(text.indexOf('Böse') >= 0, text);
  assert.ok(text.indexOf('Zeig das Ergebnis der Seherin') >= 0, text);
  const size = await seer.locator('.seer-huge').evaluate(function (el) {
    return parseFloat(getComputedStyle(el).fontSize);
  });
  assert.ok(size >= 60, String(size));
  await seer.close();
}

async function narratorPlaysNight(browser, base) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, locale: 'de-DE' });
  const errors = [];
  page.on('pageerror', function (error) { errors.push(String(error)); });
  await page.goto(base);
  await page.getByRole('button', { name: 'Wir erzählen selber: aus' }).click();
  for (const name of ['Anna', 'Bea', 'Chris', 'Dora']) {
    await page.fill('#name-input', name);
    await page.locator('#name-form button').click();
  }
  await page.getByRole('button', { name: 'Weiter zu den Rollen' }).click();
  await page.getByRole('button', { name: 'Rollen verteilen' }).click();
  const reveal = await page.locator('#app').innerText();
  assert.ok(reveal.indexOf('Danach behält nur der Erzähler') >= 0, reveal);
  const start = page.getByRole('button', { name: 'Spiel starten' });
  for (let i = 0; i < 8 && await start.isDisabled(); i++) {
    await page.locator('button[data-act="reveal-pick"]:not(.seen)').first().click();
    await page.getByRole('button', { name: 'Verstanden, verdecken' }).click();
  }
  await start.click();
  await page.getByRole('heading', { name: 'Alle Rollen' }).waitFor();
  const sheet = await page.locator('#app').innerText();
  assert.ok(sheet.indexOf('Anna') >= 0 && sheet.indexOf('Werwolf') >= 0, sheet);
  assert.ok(sheet.indexOf('lebt') >= 0, sheet);
  await page.getByRole('button', { name: 'Nacht beginnen' }).click();
  await page.getByText('Werwolf, wach auf.').waitFor();
  const forWhom = await page.locator('#app').innerText();
  assert.ok(forWhom.indexOf('Du tippst für') >= 0, forWhom);
  await page.locator('#app .choice').first().click();
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  const stayed = await page.locator('#app').innerText();
  assert.ok(stayed.indexOf('Werwolf, wach auf.') >= 0, stayed);
  assert.ok(stayed.indexOf('Fertig') >= 0, stayed);
  await page.locator('#app .choice').first().click();
  await page.getByRole('button', { name: 'Fertig' }).click();
  for (let i = 0; i < 6; i++) {
    const text = await page.locator('#app').innerText();
    if (text.indexOf('Morgen') >= 0) break;
    const sleep = page.getByRole('button', { name: 'Ich will gar nichts machen' });
    if (await sleep.count()) {
      await sleep.click();
      continue;
    }
    throw new Error('unerwarteter Erzähler-Screen\n' + text.slice(0, 400));
  }
  const morning = await page.locator('#app').innerText();
  assert.ok(morning.indexOf('Morgen') >= 0, morning);
  assert.deepStrictEqual(errors, []);
  await page.close();
}

function gearNight() {
  return {
    v: 1,
    screen: 'night',
    step: 'list',
    selfTell: false,
    showWolfAction: false,
    nightDone: [],
    nightNumber: 1,
    day: 0,
    mayorId: 1,
    players: [
      { id: 1, name: 'Anna', role: 'werwolf', alive: true, loverIds: [] },
      { id: 2, name: 'Bea', role: 'dorfbewohner', alive: true, loverIds: [] },
      { id: 3, name: 'Chris', role: 'dorfbewohner', alive: true, loverIds: [] },
      { id: 4, name: 'Dora', role: 'dorfbewohner', alive: true, loverIds: [] }
    ],
    counts: { werwolf: 1, dorfbewohner: 3, seherin: 0, hexe: 0, amor: 0, jaeger: 0, waschbaer: 0, nachahmerin: 0, nutte: 0, russe: 0, politiker: 0, schaufel: 0 },
    rolePool: false,
    wolfVotes: {},
    heals: [],
    poisons: [],
    hosts: {},
    selection: [],
    prompts: [],
    promptIndex: 0,
    log: [],
    bonds: [],
    order: [1, 2, 3, 4],
    config: {}
  };
}

async function gearMidGame(browser, base) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, locale: 'de-DE' });
  await page.addInitScript(function (payload) {
    localStorage.setItem('werwolf.game.v1', JSON.stringify(payload));
  }, gearNight());
  await page.goto(base);
  await page.getByRole('heading', { name: 'Wer ist wach?' }).waitFor();
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.getByRole('heading', { name: 'Einstellungen' }).waitFor();
  assert.ok((await page.locator('#set-tell').innerText()).indexOf('aus') >= 0);
  assert.ok((await page.locator('#set-wolf').innerText()).indexOf('aus') >= 0);
  assert.ok((await page.locator('#set-amor').innerText()).indexOf('an') >= 0);
  await page.locator('#set-amor').click();
  assert.ok((await page.locator('#set-amor').innerText()).indexOf('aus') >= 0);
  await page.locator('#settings-close').click();
  await page.getByRole('heading', { name: 'Wer ist wach?' }).waitFor();
  const names = await page.locator('button[data-act="night-pick"]:not([disabled])').count();
  assert.strictEqual(names, 4);
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.locator('#set-tell').click();
  await page.locator('#set-wolf').click();
  assert.ok((await page.locator('#set-tell').innerText()).indexOf('an') >= 0);
  assert.ok((await page.locator('#set-wolf').innerText()).indexOf('an') >= 0);
  await page.locator('#settings-close').click();
  await page.getByRole('heading', { name: 'Alle Rollen' }).waitFor();
  await page.getByRole('button', { name: 'Einstellungen' }).click();
  await page.locator('#set-tell').click();
  await page.locator('#settings-close').click();
  await page.getByRole('heading', { name: 'Wer ist wach?' }).waitFor();
  assert.strictEqual(await page.locator('button[data-act="night-pick"]:not([disabled])').count(), 4);
  await page.close();
}

function baseNight(extra) {
  const state = {
    v: 1,
    screen: 'night',
    step: 'show',
    selfTell: true,
    narratorQuiet: false,
    narratorIndex: 0,
    narratorCalls: [{ role: 'hexe', playerId: 4, slot: 0 }],
    activeId: 4,
    actorId: 4,
    nightNumber: 1,
    day: 0,
    mayorId: 1,
    players: [
      { id: 1, name: 'Wolf', role: 'werwolf', alive: true, loverIds: [], healsLeft: 0, poisonLeft: false },
      { id: 2, name: 'Anna', role: 'dorfbewohner', alive: true, loverIds: [], healsLeft: 0, poisonLeft: false },
      { id: 3, name: 'Bert', role: 'dorfbewohner', alive: true, loverIds: [], healsLeft: 0, poisonLeft: false },
      { id: 4, name: 'Hexe', role: 'hexe', alive: true, loverIds: [], healsLeft: 2, poisonLeft: true }
    ],
    counts: { werwolf: 1, dorfbewohner: 2, hexe: 1 },
    prompts: [],
    promptIndex: 0,
    selection: [],
    heals: [],
    poisons: [],
    wolfVotes: { 1: 2 },
    extraAttacks: [],
    hosts: {},
    copyHexes: [],
    nightDone: [1, 2, 3],
    shownDead: [],
    order: [1, 2, 3, 4],
    log: [],
    bonds: [],
    seenLove: {},
    votes: {},
    healPotions: 2,
    nachUses: 1,
    config: { selfTell: true }
  };
  Object.keys(extra || {}).forEach(function (key) { state[key] = extra[key]; });
  return state;
}

async function witchHealScreen(browser, base) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, locale: 'de-DE' });
  const errors = [];
  page.on('pageerror', function (error) { errors.push(String(error)); });
  await page.addInitScript(function (payload) {
    localStorage.setItem('werwolf.game.v1', JSON.stringify(payload));
  }, baseNight({
    prompts: [{ kind: 'heal', source: 'role', target: 'person', healsLeft: 2, reactive: true, victims: [2] }]
  }));
  await page.goto(base);
  await page.locator('.victim-huge').waitFor();
  const huge = await page.locator('.victim-huge').innerText();
  assert.strictEqual(huge, 'Anna');
  const size = await page.locator('.victim-huge').evaluate(function (el) {
    return parseFloat(getComputedStyle(el).fontSize);
  });
  assert.ok(size >= 60, String(size));
  const choices = page.locator('#app button[data-act="select"]');
  assert.strictEqual(await choices.count(), 1);
  assert.ok((await choices.first().innerText()).indexOf('Anna') >= 0);
  assert.strictEqual(await page.locator('#app').innerText().then(function (text) { return text.indexOf('Bert'); }), -1);
  await page.getByRole('button', { name: 'Keinen Heiltrank' }).waitFor();
  await choices.first().click();
  await page.locator('#app .choice.selected').waitFor();
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  assert.strictEqual(await page.locator('#app .choice.selected').count(), 0);
  const afterBack = await page.evaluate(function () {
    return JSON.parse(localStorage.getItem('werwolf.game.v1'));
  });
  assert.deepStrictEqual(afterBack.heals, []);
  assert.strictEqual(afterBack.players[3].healsLeft, 2);
  await page.getByRole('button', { name: 'Keinen Heiltrank' }).click();
  const skipped = await page.evaluate(function () {
    return JSON.parse(localStorage.getItem('werwolf.game.v1'));
  });
  assert.deepStrictEqual(skipped.heals, []);
  assert.strictEqual(skipped.players[3].healsLeft, 2);
  assert.deepStrictEqual(errors, []);
  await page.close();

  const none = await browser.newPage({ viewport: { width: 412, height: 915 }, locale: 'de-DE' });
  await none.addInitScript(function (payload) {
    localStorage.setItem('werwolf.game.v1', JSON.stringify(payload));
  }, baseNight({
    wolfVotes: {},
    prompts: [{ kind: 'info', victimReveal: true, victims: [], text: 'Heute Nacht kein Opfer der Wölfe' }]
  }));
  await none.goto(base);
  await none.locator('.victim-none').waitFor();
  assert.strictEqual(await none.locator('.victim-none').innerText(), 'Heute Nacht kein Opfer der Wölfe');
  assert.strictEqual(await none.locator('#app button[data-act="select"]').count(), 0);
  await none.getByRole('button', { name: 'Weiter' }).click();
  await none.close();
}

async function witchRules(browser, base) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, locale: 'de-DE' });
  await page.goto(base);
  await page.getByRole('button', { name: 'Wir erzählen selber: aus' }).click();
  await page.locator('summary', { hasText: 'Kurze Regeln' }).click();
  const told = await page.locator('#app').innerText();
  assert.ok(told.indexOf('Im Erzählermodus sieht sie die Opfer der Werwölfe') >= 0, told);
  await page.getByRole('button', { name: 'Wir erzählen selber: an' }).click();
  await page.locator('summary', { hasText: 'Kurze Regeln' }).click();
  const blind = await page.locator('#app').innerText();
  assert.ok(blind.indexOf('ohne das Opfer zu kennen') >= 0, blind);
  assert.strictEqual(blind.indexOf('Im Erzählermodus sieht sie die Opfer der Werwölfe'), -1);
  await page.close();
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
