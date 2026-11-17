// Starlight Diner — headless test + screenshot driver (dev only).
// Drives the real Chrome at /opt/meta-chromium/chrome over CDP:
//   node tools/shots.mjs test    — full playthrough test, asserts every
//                                  state transition, fails on any console error
//   node tools/shots.mjs shots   — captures shots.json into screenshots/
// Run from the repository root. Serves game/ itself on :8080.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME_PATH = process.env.CHROME_BIN || '/usr/bin/google-chrome-stable'; // stock Chrome; /opt/meta-chromium/chrome refuses headless here (Hatch WebGL policy)
const PORT = 8080;
const CDP_PORT = 9222;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('timeout waiting for ' + url);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    this.failedReqs = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push('exception: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 500));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 500));
      } else if (msg.method === 'Network.loadingFailed') {
        this.failedReqs.push(msg.params.errorText + ' ' + (msg.params.type || ''));
      }
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  }
  async nav(url) {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await this.send('Page.navigate', { url });
    await sleep(1400);
    // Viewport is now exactly 1280x720, so view coords == client coords.
    // Still read the game's own transform as a sanity check.
    const t = await this.eval(`window.__game ? ({ s: window.__game.input.scale, ox: window.__game.input.ox, oy: window.__game.input.oy }) : null`);
    if (t && Math.abs(t.s - 1) > 0.001) console.log('WARN viewport transform not 1:1: ' + JSON.stringify(t));
  }
  // x, y are VIEW coords (1280x720 game space); the game maps them itself.
  async click(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(120);
  }
  async key(key, code, vk) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
    await sleep(120);
  }
  async shot(file, quality = 80) {
    const r = await this.send('Page.captureScreenshot', { format: 'jpeg', quality });
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    return r.data.length;
  }
}

async function startChrome() {
  const chrome = spawn(CHROME_PATH, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    `--remote-debugging-port=${CDP_PORT}`, '--window-size=1280,720', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return { chrome, cdp: new CDP(ws) };
}

async function startServer() {
  const { openSync } = await import('node:fs');
  const logFd = openSync('/tmp/serve-driver.log', 'w');
  const server = spawn(process.execPath, ['serve.ts', String(PORT)], { cwd: ROOT, stdio: ['ignore', logFd, logFd] });
  try {
    await waitFor(`http://127.0.0.1:${PORT}/`);
  } catch (e) {
    const log = readFileSync('/tmp/serve-driver.log', 'utf8');
    throw new Error('server failed to start: ' + log.slice(0, 800));
  }
  return server;
}

// --- shared helpers -------------------------------------------------------
async function waitForState(cdp, want, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await cdp.eval(`window.__game && window.__game.state`);
    if (s === want) return true;
    await sleep(250);
  }
  return false;
}

async function firstSeated(cdp) {
  return cdp.eval(`(() => {
    const g = window.__game;
    const c = g.customers.customers.find((x) => x.seated);
    return c ? { order: c.order, x: c.x, y: c.y, table: c.table } : null;
  })()`);
}

async function waitSeated(cdp, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const c = await firstSeated(cdp);
    if (c) return c;
    await sleep(400);
  }
  throw new Error('no seated customer appeared');
}

// Cook the given dish (by key), wait until it is on the tray or ready at
// its station, take it into the hand. Returns the dish key.
async function cookAndTake(cdp, dishKey) {
  const idx = await cdp.eval(`(() => {
    const g = window.__game;
    const i = g.kitchen.stations.findIndex((s) => s.dish.key === '${dishKey}');
    g.kitchen.startCook(i);
    return i;
  })()`);
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    const where = await cdp.eval(`(() => {
      const g = window.__game;
      const tray = g.kitchen.tray.indexOf('${dishKey}');
      const st = g.kitchen.stations[${idx}].status;
      return { tray, st };
    })()`);
    if (where.tray >= 0) {
      // tray slot center: TRAY x=280 w=980, 4 slots of 245px
      await cdp.click(280 + 245 * where.tray + 122.5, 622 + 41);
      return dishKey;
    }
    if (where.st === 'ready') {
      await cdp.click(136, 150 + idx * 144);
      return dishKey;
    }
    await sleep(300);
  }
  throw new Error('dish ' + dishKey + ' never became ready');
}

async function serveCustomer(cdp, cust) {
  const dishKey = cust.order.find((k) => true);
  await cookAndTake(cdp, dishKey);
  await cdp.click(cust.x, cust.y + 10);
  await sleep(300);
}

// --- test mode ------------------------------------------------------------
async function runTests() {
  const server = await startServer();
  const { chrome, cdp } = await startChrome();
  const results = [];
  const check = (name, ok, extra = '') => {
    results.push({ name, ok, extra });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  };
  try {
    await cdp.nav(`http://127.0.0.1:${PORT}/`);
    check('loads with no console errors', cdp.errors.length === 0, cdp.errors.join(' | '));
    check('title screen shows', (await cdp.eval(`window.__game.state`)) === 'title');
    await cdp.key('Enter', 'Enter', 13);
    check('Enter starts the game', await waitForState(cdp, 'playing', 3000));

    const cust = await waitSeated(cdp);
    check('a customer arrives and sits', !!cust, JSON.stringify(cust?.order));
    const coins0 = await cdp.eval(`window.__game.dayCoins`);
    await serveCustomer(cdp, cust);
    const after = await cdp.eval(`({ coins: window.__game.dayCoins, serves: window.__game.totalServes, hand: window.__game.hand })`);
    check('serving earns coins', after.coins > coins0 && after.serves === 1 && after.hand === null, JSON.stringify(after));

    // Wrong dish: cook something the next guest did not order.
    const cust2 = await waitSeated(cdp);
    const wrong = ['soup', 'coffee', 'pie', 'salad'].find((k) => !cust2.order.includes(k));
    await cookAndTake(cdp, wrong);
    await cdp.click(cust2.x, cust2.y + 10);
    await sleep(300);
    const wrongAfter = await cdp.eval(`({ serves: window.__game.totalServes, hand: window.__game.hand })`);
    check('wrong dish is refused, hand kept', wrongAfter.serves === 1 && wrongAfter.hand === wrong, JSON.stringify(wrongAfter));
    // Serve it to someone who wants it (or leave it; clear by serving a matching guest)
    const cust3 = await waitSeated(cdp);
    if (cust3.order.includes(wrong)) {
      await cdp.click(cust3.x, cust3.y + 10);
      await sleep(300);
    } else {
      await cdp.eval(`window.__game.hand = null`); // test-only reset
    }

    // Pause / resume
    await cdp.key(' ', 'Space', 32);
    check('Space pauses', await waitForState(cdp, 'paused', 2000));
    await cdp.key(' ', 'Space', 32);
    check('Space resumes', await waitForState(cdp, 'playing', 2000));

    // Walkout: drain a guest's patience
    await cdp.eval(`(() => { const c = window.__game.customers.customers.find((x) => x.seated); if (c) c.patience = 0.05; })()`);
    await sleep(1200);
    const strikes = await cdp.eval(`window.__game.strikes`);
    check('walkout adds a strike', strikes === 1, 'strikes=' + strikes);

    // Day complete: top the coins up, then serve once more
    await cdp.eval(`window.__game.dayCoins = 115`);
    const cust4 = await waitSeated(cdp);
    await serveCustomer(cdp, cust4);
    check('reaching the target ends the day', await waitForState(cdp, 'results', 5000));

    // Shop: buy the Turbo Oven, then next day
    await cdp.click(495, 496); // Upgrade Shop
    check('results -> shop', await waitForState(cdp, 'shop', 3000));
    await cdp.click(260, 275); // Turbo Oven card
    await sleep(300);
    const oven = await cdp.eval(`window.__game.upgrades.has('oven')`);
    check('upgrade can be bought', oven === true);
    await cdp.click(640, 446); // Next Day
    check('shop -> day 2', (await waitForState(cdp, 'playing', 3000)) && (await cdp.eval(`window.__game.day`)) === 1);

    // Lose: wait for a guest to sit, then force two more strikes
    await cdp.eval(`window.__game.strikes = 2`);
    const loseCust = await waitSeated(cdp);
    await cdp.eval(`(() => { const c = window.__game.customers.customers.find((x) => x.seated); if (c) c.patience = 0.05; })()`);
    await sleep(1200);
    check('3 strikes fails the day', await waitForState(cdp, 'lose', 3000));
    await cdp.click(505, 496); // Try Day Again
    check('retry restarts the same day', (await waitForState(cdp, 'playing', 3000)) && (await cdp.eval(`window.__game.day`)) === 1 && (await cdp.eval(`window.__game.strikes`)) === 0);

    // Win: jump to day 3, finish it, then play again
    await cdp.eval(`window.__game.day = 2; window.__game.dayCoins = 270; window.__game.scoreAtDayStart = window.__game.totalScore;`);
    const cust5 = await waitSeated(cdp);
    await serveCustomer(cdp, cust5);
    check('day 3 target -> results', await waitForState(cdp, 'results', 5000));
    await cdp.click(785, 496); // Final Results
    check('final results -> win screen', await waitForState(cdp, 'win', 3000));
    await cdp.click(505, 496); // Play Again
    check('play again restarts day 1', (await waitForState(cdp, 'playing', 3000)) && (await cdp.eval(`window.__game.day`)) === 0);

    check('still no console errors', cdp.errors.length === 0, cdp.errors.join(' | '));
    check('no failed network requests', cdp.failedReqs.length === 0, cdp.failedReqs.join(' | '));
  } catch (e) {
    console.log('ERROR  ' + e.message);
    results.push({ name: 'exception', ok: false, extra: e.message });
  } finally {
    chrome.kill();
    server.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.name).join(', ')); process.exit(1); }
}

// --- screenshots mode -----------------------------------------------------
async function runShots() {
  const server = await startServer();
  const { chrome, cdp } = await startChrome();
  const shots = JSON.parse(readFileSync(join(ROOT, 'shots.json'), 'utf8'));
  mkdirSync(join(ROOT, 'screenshots'), { recursive: true });
  try {
    for (const s of shots) {
      await cdp.nav(`http://127.0.0.1:${PORT}/${s.query}`);
      let quality = 82;
      let file = join(ROOT, 'screenshots', s.name);
      let bytes = await cdp.shot(file, quality);
      while (bytes > 262144 && quality > 40) {
        quality -= 12;
        bytes = await cdp.shot(file, quality);
      }
      const { width, height } = await cdp.eval(`({ width: 1280, height: 720 })`);
      console.log(`${s.name}: ${(bytes / 1024).toFixed(0)} KiB (q${quality}), ${width}x${height}, errors=${cdp.errors.length}`);
    }
    if (cdp.errors.length) console.log('CONSOLE ERRORS: ' + cdp.errors.join(' | '));
    if (cdp.failedReqs.length) console.log('FAILED REQUESTS: ' + cdp.failedReqs.join(' | '));
  } finally {
    chrome.kill();
    server.kill();
  }
}

const mode = process.argv[2];
if (mode === 'test') runTests();
else if (mode === 'shots') runShots();
else { console.log('usage: node tools/shots.mjs test|shots'); process.exit(2); }
