/* Spielerliste, Vorschläge und Statistik. Aufruf: node test/players-ui.test.js */
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

async function addNamed(page, first, last) {
  await page.fill('#name-input', first);
  await page.fill('#last-input', last);
  await page.locator('#name-form button[type="submit"]').click();
}

async function main() {
  const pkg = require('/tmp/node_modules/playwright-core');
  const { chromium } = pkg;
  const started = await startServer();
  const browser = await chromium.launch({
    executablePath: '/usr/local/bin/google-chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const base = 'http://127.0.0.1:' + started.port + '/index.html';
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', function (error) { errors.push(String(error)); });
  try {
    await page.goto(base);
    await page.getByRole('heading', { name: 'Werwolf' }).waitFor();
    await addNamed(page, 'Maximilian', 'Bausch');
    await page.fill('#name-input', 'bau');
    assert.strictEqual(await page.locator('#name-suggest button').count(), 0);
    await page.locator('button[aria-label="Maximilian entfernen"]').click();
    await page.fill('#name-input', 'BAU');
    await page.locator('#name-suggest button', { hasText: 'Maximilian Bausch' }).click();
    assert.ok((await page.locator('#app').innerText()).indexOf('Maximilian') >= 0);
    await page.locator('button[aria-label="Maximilian entfernen"]').click();

    await addNamed(page, 'Max', 'Bausch');
    await addNamed(page, 'Max', 'Klein');
    let text = await page.locator('#app').innerText();
    assert.ok(text.indexOf('Max B.') >= 0, text);
    assert.ok(text.indexOf('Max K.') >= 0, text);
    await page.locator('button[aria-label="Max B. entfernen"]').click();
    await page.locator('button[aria-label="Max entfernen"]').click();

    await addNamed(page, 'Max', 'Bausch');
    await addNamed(page, 'Max', 'Bauer');
    text = await page.locator('#app').innerText();
    assert.ok(text.indexOf('Max Bausch') >= 0, text);
    assert.ok(text.indexOf('Max Bauer') >= 0, text);

    await page.getByRole('button', { name: 'Statistik' }).click();
    await page.getByRole('button', { name: 'Maximilian Bausch' }).click();
    text = await page.locator('#app').innerText();
    assert.ok(text.indexOf('0 Spiele') >= 0, text);
    assert.ok(text.indexOf('Siegquote') >= 0, text);
    await page.getByRole('button', { name: 'Zurück', exact: true }).click();
    await page.getByRole('button', { name: 'Max Bauer' }).click();
    await page.getByRole('button', { name: 'Zurück', exact: true }).click();
    await page.getByRole('button', { name: 'Zurück', exact: true }).click();
    text = await page.locator('#app').innerText();
    assert.ok(text.indexOf('Max Bausch') >= 0, text);
    assert.ok(text.indexOf('Name hinzufügen') >= 0, text);
    const stored = await page.evaluate(function () { return localStorage.getItem('werwolf.players.v1'); });
    assert.ok(stored.indexOf('"first":"Maximilian"') >= 0, stored);
    assert.ok(stored.indexOf('"last":"Bausch"') >= 0, stored);
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise(function (resolve) { started.server.close(resolve); });
  }
  console.log('players ui ok');
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
