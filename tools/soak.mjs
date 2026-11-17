// Starlight Diner — soak test (dev only).
// Plays the game for real in headless Chrome with real mouse clicks:
//   node tools/soak.mjs [games=3] [minutes=16]
// - auto-plays N full games (title -> 3 days -> win -> play again),
//   buying shop upgrades, retrying after losses
// - samples FPS + worst frame gap, watches console errors AND warnings,
//   failed requests, stuck states, audio state, key coverage (1-4, P, Esc, M)
// - then 90s of random clicks/keys (fuzz), then a responsiveness check
// - then loads at 1024x768 and 1920x1080 to check letterboxing
// Run from the repository root. Exit 0 = clean, 1 = any failure.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME_PATH = process.env.CHROME_BIN || '/usr/bin/google-chrome-stable';
const PORT = 8080;
const CDP_PORT = 9223;
const GAMES_TARGET = Number(process.argv[2] || 3);
const CAP_MIN = Number(process.argv[3] || 16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

const STATION = (i) => ({ x: 136, y: 150 + i * 144 });
const TRAY = (j) => ({ x: 280 + 245 * j + 122.5, y: 663 });
const BTN = { shop: { x: 495, y: 496 }, next: { x: 785, y: 496 }, shopNext: { x: 640, y: 446 }, retry: { x: 495, y: 496 }, again: { x: 495, y: 496 } };
const DISH_IDX = { soup: 0, coffee: 1, pie: 2, salad: 3 };

async function waitFor(url, timeout = 20000) {
  const t0 = now();
  while (now() - t0 < timeout) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('timeout waiting for ' + url);
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    this.errors = []; this.warnings = []; this.failedReqs = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push('exception: ' + JSON.stringify(msg.params.exceptionDetails).slice(0, 500));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'warning') {
        this.warnings.push('console.warn: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
      } else if (msg.method === 'Network.loadingFailed') {
        this.failedReqs.push(msg.params.errorText + ' ' + (msg.params.type || ''));
      }
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id; this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  }
  async nav(url, vw = 1280, vh = 720) {
    await this.send('Page.enable'); await this.send('Runtime.enable'); await this.send('Network.enable');
    await this.send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
    await this.send('Page.navigate', { url });
    await sleep(1400);
  }
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
}

function startServer() {
  return spawn(process.execPath, ['serve.ts', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
}
async function startChrome() {
  const chrome = spawn(CHROME_PATH, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--remote-debugging-port=${CDP_PORT}`, '--window-size=1280,720', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return { chrome, cdp: new CDP(ws) };
}

const STATE_EXPR = `(() => {
  const g = window.__game; if (!g) return null;
  return {
    state: g.state, day: g.day, dayCoins: g.dayCoins, strikes: g.strikes,
    hand: g.hand, serves: g.totalServes, walkouts: g.dayStats.walkouts,
    upgrades: [...g.upgrades],
    seated: g.customers.customers.filter((c) => c.seated).map((c) => ({ x: c.x, y: c.y, order: [...c.order], patience: Math.round(c.patience * 10) / 10 })),
    stations: g.kitchen.stations.map((s) => ({ dish: s.dish.key, status: s.status })),
    tray: [...g.kitchen.tray],
  };
})()`;

const failures = [];
const notes = [];
function fail(m) { failures.push(m); console.log('SOAK-FAIL  ' + m); }
function note(m) { notes.push(m); console.log('soak: ' + m); }

async function main() {
  const server = startServer();
  const { chrome, cdp } = await startChrome();
  const tStart = now();
  const capMs = CAP_MIN * 60 * 1000;
  let gamesWon = 0, daysDone = 0, lastState = '', lastProgress = now(), lastServes = 0;
  let fpsMin = 999, fpsSamples = 0, maxGap = 0;
  let keysTested = false, audioChecked = false;
  try {
    await cdp.nav(`http://127.0.0.1:${PORT}/`);
    // FPS meter inside the page.
    await cdp.eval(`window.__fps = { n: 0, maxGap: 0, last: performance.now(), big: [] };
      (function loop() { const t = performance.now(); const gap = t - window.__fps.last; window.__fps.last = t; if (gap > window.__fps.maxGap) window.__fps.maxGap = gap; if (gap > 100 && window.__fps.big.length < 30) window.__fps.big.push({ gap: Math.round(gap), t: Math.round(t) }); window.__fps.n++; requestAnimationFrame(loop); })();`);
    let fpsMark = { n: 0, t: now() };
    let lastFpsSample = now();

    while (gamesWon < GAMES_TARGET && now() - tStart < capMs) {
      const s = await cdp.eval(STATE_EXPR);
      if (!s) { fail('game object vanished'); break; }
      if (!['title', 'playing', 'paused', 'results', 'shop', 'win', 'lose'].includes(s.state)) { fail('unknown state: ' + s.state); break; }

      // FPS sample every 10s
      if (now() - lastFpsSample > 10000) {
        const f = await cdp.eval(`({ n: window.__fps.n, maxGap: window.__fps.maxGap, big: window.__fps.big })`);
        const fps = (f.n - fpsMark.n) / ((now() - fpsMark.t) / 1000);
        fpsMin = Math.min(fpsMin, fps); fpsSamples++;
        maxGap = Math.max(maxGap, f.maxGap);
        note(`FPS ${fps.toFixed(1)} (min so far ${fpsMin.toFixed(1)}), worst frame gap ${f.maxGap.toFixed(0)}ms, seated=${s.seated.length} state=${s.state} day=${s.day + 1} coins=${s.dayCoins} serves=${s.serves} bigGaps=${JSON.stringify(f.big.slice(-5))}`);
        fpsMark = { n: f.n, t: now() }; lastFpsSample = now();
      }

      // Progress watchdog: serves or state must move within 60s while playing
      if (s.serves !== lastServes || s.state !== lastState) { lastProgress = now(); lastServes = s.serves; }
      if (s.state === 'playing' && now() - lastProgress > 60000) { fail('STUCK: no progress for 60s while playing (serves=' + s.serves + ', seated=' + s.seated.length + ')'); break; }
      lastState = s.state;

      // Audio check once, after the first real gesture
      if (!audioChecked && s.state !== 'title') {
        const a = await cdp.eval(`window.__game.audio.ctx ? ({ hasCtx: true, state: window.__game.audio.ctx.state }) : ({ hasCtx: false })`);
        note('audio after first gesture: ' + JSON.stringify(a));
        if (!a.hasCtx) fail('audio context never created after gesture');
        audioChecked = true;
      }

      // Key coverage once, early in game 1 day 1
      if (!keysTested && s.state === 'playing' && gamesWon === 0 && s.day === 0) {
        await cdp.key('1', 'Digit1', 49);
        const st = await cdp.eval(`window.__game.kitchen.stations[0].status`);
        if (st !== 'cooking') fail('key 1 did not start cooking soup (status=' + st + ')'); else note('key 1 cooks soup OK');
        await cdp.key('p', 'KeyP', 80);
        const paused = await cdp.eval(`window.__game.state`);
        if (paused !== 'paused') fail('key P did not pause (state=' + paused + ')'); else note('key P pauses OK');
        await cdp.key('Escape', 'Escape', 27);
        const resumed = await cdp.eval(`window.__game.state`);
        if (resumed !== 'playing') fail('Escape did not resume (state=' + resumed + ')'); else note('Escape resumes OK');
        await cdp.key('m', 'KeyM', 77);
        const muted = await cdp.eval(`window.__game.audio.muted`);
        if (muted !== true) fail('key M did not mute'); else note('key M mutes OK');
        await cdp.key('m', 'KeyM', 77);
        if ((await cdp.eval(`window.__game.audio.muted`)) !== false) fail('key M did not unmute');
        keysTested = true;
      }

      if (s.state === 'title') { await cdp.key('Enter', 'Enter', 13); }
      else if (s.state === 'playing') {
        if (!s.seated.length) { await sleep(220); continue; }
        const byPatience = [...s.seated].sort((a, b) => a.patience - b.patience);
        if (s.hand) {
          // 1. Serve: hand matches someone seated.
          const who = byPatience.find((c) => c.order.includes(s.hand));
          if (who) await cdp.click(who.x, who.y + 10);
          else {
            // Nobody wants it: put it down on an empty tray slot, or swap
            // with a tray dish if the tray is full.
            const empty = s.tray.indexOf(null);
            if (empty >= 0) await cdp.click(TRAY(empty).x, TRAY(empty).y);
            else await cdp.click(TRAY(0).x, TRAY(0).y);
          }
        } else {
          // 2. Take a dish a seated guest wants (tray first, then ready station).
          let acted = false;
          for (const c of byPatience) {
            const want = c.order[0];
            if (!want) continue;
            if (s.tray.includes(want)) { await cdp.click(TRAY(s.tray.indexOf(want)).x, TRAY(s.tray.indexOf(want)).y); acted = true; break; }
            const st = s.stations[DISH_IDX[want]];
            if (st.status === 'ready') { await cdp.click(STATION(DISH_IDX[want]).x, STATION(DISH_IDX[want]).y); acted = true; break; }
          }
          // 3. Start cooking on every idle station for a seated guest's order
          // (parallel kitchen, like a human player — sequential play starves day 3).
          if (!acted) {
            const started = new Set();
            for (const c of byPatience) {
              const want = c.order[0];
              if (!want) continue;
              const si = DISH_IDX[want];
              if (started.has(si)) continue;
              if (s.stations[si].status === 'idle') { await cdp.click(STATION(si).x, STATION(si).y); started.add(si); }
            }
            if (!started.size) await sleep(220);
          }
        }
      } else if (s.state === 'results') {
        daysDone++;
        note(`day ${s.day + 1} complete: coins=${s.dayCoins} serves=${s.serves} walkouts=${s.walkouts}`);
        await cdp.click(BTN.shop.x, BTN.shop.y); // go to shop every time
      } else if (s.state === 'shop') {
        const shop = await cdp.eval(`({ coins: window.__game.dayCoins, cards: window.__game.shopCards.map((c) => ({ id: c.upgrade.id, cost: c.upgrade.cost, x: c.x + c.w / 2, y: c.y + c.h / 2 })) })`);
        const owned = new Set(await cdp.eval(`[...window.__game.upgrades]`));
        const affordable = shop.cards.filter((c) => !owned.has(c.id) && c.cost <= shop.coins).sort((a, b) => a.cost - b.cost);
        if (affordable.length) { await cdp.click(affordable[0].x, affordable[0].y); note('bought upgrade ' + affordable[0].id + ' for ' + affordable[0].cost + 'c'); }
        await cdp.click(BTN.shopNext.x, BTN.shopNext.y);
      } else if (s.state === 'lose') {
        note(`day ${s.day + 1} LOST (strikes=${s.strikes}) — retrying`);
        await cdp.click(BTN.retry.x, BTN.retry.y);
      } else if (s.state === 'win') {
        gamesWon++;
        note(`GAME ${gamesWon} WON — totalScore=${await cdp.eval(`window.__game.totalScore`)} serves=${s.serves}`);
        if (gamesWon < GAMES_TARGET) await cdp.click(BTN.again.x, BTN.again.y);
      } else if (s.state === 'paused') {
        await cdp.key(' ', 'Space', 32);
      }
      await sleep(120);
    }

    note(`auto-play done: games won=${gamesWon}/${GAMES_TARGET}, days completed=${daysDone}, elapsed=${((now() - tStart) / 1000).toFixed(0)}s`);
    if (gamesWon < GAMES_TARGET) fail(`only ${gamesWon}/${GAMES_TARGET} games won within ${CAP_MIN} min`);

    // --- Fuzz: 90s of random clicks + keys ---
    note('fuzz phase: 90s random clicks/keys');
    const fuzzKeys = ['1', '2', '3', '4', ' ', 'p', 'm', 'Enter', 'Escape'];
    const fuzzCodes = { 1: 'Digit1', 2: 'Digit2', 3: 'Digit3', 4: 'Digit4', ' ': 'Space', p: 'KeyP', m: 'KeyM', Enter: 'Enter', Escape: 'Escape' };
    const fuzzVk = { 1: 49, 2: 50, 3: 51, 4: 52, ' ': 32, p: 80, m: 77, Enter: 13, Escape: 27 };
    const fuzzEnd = now() + 90000;
    let fuzzClicks = 0, fuzzKeysN = 0;
    while (now() < fuzzEnd) {
      if (Math.random() < 0.7) { await cdp.click(Math.floor(Math.random() * 1280), Math.floor(Math.random() * 720)); fuzzClicks++; }
      else { const k = fuzzKeys[Math.floor(Math.random() * fuzzKeys.length)]; await cdp.key(k, fuzzCodes[k], fuzzVk[k]); fuzzKeysN++; }
      await sleep(90);
    }
    note(`fuzz done: ${fuzzClicks} clicks + ${fuzzKeysN} keys, errors=${cdp.errors.length} warnings=${cdp.warnings.length}`);
    if (cdp.errors.length) fail('errors during fuzz: ' + cdp.errors.slice(0, 3).join(' | '));

    // --- Responsiveness after fuzz ---
    const sAfter = await cdp.eval(STATE_EXPR);
    note('state after fuzz: ' + (sAfter ? sAfter.state : 'null'));
    if (!sAfter) fail('game object gone after fuzz');
    else {
      // Drive back to a playable state and prove one serve still works.
      const serves0 = sAfter.serves;
      const proveEnd = now() + 60000;
      let proved = false;
      while (now() < proveEnd && !proved) {
        const s = await cdp.eval(STATE_EXPR);
        if (!s) break;
        if (s.state === 'title') await cdp.key('Enter', 'Enter', 13);
        else if (s.state === 'results') await cdp.click(BTN.next.x, BTN.next.y);
        else if (s.state === 'shop') await cdp.click(BTN.shopNext.x, BTN.shopNext.y);
        else if (s.state === 'lose') await cdp.click(BTN.retry.x, BTN.retry.y);
        else if (s.state === 'win') await cdp.click(BTN.again.x, BTN.again.y);
        else if (s.state === 'paused') await cdp.key(' ', 'Space', 32);
        else if (s.state === 'playing' && s.seated.length) {
          const t = s.seated[0]; const want = t.order[0];
          if (!want) { await sleep(200); continue; }
          if (s.hand === want) await cdp.click(t.x, t.y + 10);
          else if (s.tray.includes(want)) await cdp.click(TRAY(s.tray.indexOf(want)).x, TRAY(s.tray.indexOf(want)).y);
          else { const si = DISH_IDX[want]; if (s.stations[si].status !== 'cooking') await cdp.click(STATION(si).x, STATION(si).y); }
        }
        if ((await cdp.eval(`window.__game.totalServes`)) > serves0) proved = true;
        await sleep(200);
      }
      if (proved) note('responsiveness after fuzz: OK (serve completed)');
      else fail('game not responsive after fuzz (no serve in 60s)');
    }

    // --- Viewport / letterbox checks ---
    for (const [vw, vh] of [[1024, 768], [1920, 1080]]) {
      await cdp.nav(`http://127.0.0.1:${PORT}/`, vw, vh);
      const v = await cdp.eval(`(() => { const r = document.getElementById('game').getBoundingClientRect(); const g = window.__game; return { state: g.state, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, vw: innerWidth, vh: innerHeight }; })()`);
      note(`viewport ${vw}x${vh}: ${JSON.stringify(v)}`);
      if (v.state !== 'title') fail(`viewport ${vw}x${vh}: expected title, got ${v.state}`);
      if (v.rect.w > vw || v.rect.h > vh) fail(`viewport ${vw}x${vh}: canvas overflows`);
    }
  } finally {
    chrome.kill(); server.kill();
  }

  console.log('\n=== SOAK SUMMARY ===');
  console.log(`games won: ${gamesWon}/${GAMES_TARGET}, days done: ${daysDone}`);
  console.log(`FPS min sample: ${fpsMin === 999 ? 'n/a' : fpsMin.toFixed(1)} over ${fpsSamples} samples; worst frame gap: ${maxGap.toFixed(0)}ms`);
  console.log(`console errors: ${cdp.errors.length}, warnings: ${cdp.warnings.length}, failed requests: ${cdp.failedReqs.length}`);
  if (cdp.errors.length) console.log('ERRORS:\n' + cdp.errors.slice(0, 10).join('\n'));
  if (cdp.warnings.length) console.log('WARNINGS:\n' + cdp.warnings.slice(0, 10).join('\n'));
  if (cdp.failedReqs.length) console.log('FAILED REQS:\n' + cdp.failedReqs.slice(0, 10).join('\n'));
  if (failures.length) { console.log('FAILURES:\n- ' + failures.join('\n- ')); process.exit(1); }
  console.log('SOAK CLEAN');
  process.exit(0);
}
main().catch((e) => { console.error('SOAK CRASH: ' + (e.stack || e)); process.exit(1); });
