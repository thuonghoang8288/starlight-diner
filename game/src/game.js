// Starlight Diner — the game itself: state machine, days, shop, scoring.
// States: title → playing ⇄ paused → results → shop → playing …
// → win (after day 3) or lose (3 strikes on a day) → retry / title.
// All rules live here; render.js only draws, customers.js and kitchen.js
// only hold their own entities.
import { DISHES, SPECIES, DAYS, UPGRADES, MAX_STRIKES, VIEW_W, VIEW_H } from './config.js';
import { TABLES, STATIONS } from './layout.js';
import { Customer, CustomerManager } from './customers.js';
import { Kitchen } from './kitchen.js';
import { Renderer } from './render.js';
import { AudioSys } from './audio.js';
import { Input } from './input.js';
import { mulberry32 } from './random.js';

const BEST_KEY = 'starlight-diner-best';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.input = new Input(canvas);
    this.audio = new AudioSys();
    this.renderer = new Renderer();
    this.kitchen = new Kitchen(this);
    this.customers = new CustomerManager(this);
    this.rng = Math.random;
    this.t = 0;
    this.state = 'title';
    this.day = 0;
    this.dayCoins = 0;
    this.totalScore = 0;
    this.scoreAtDayStart = 0;
    this.strikes = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.totalServes = 0;
    this.totalTips = 0;
    this.elapsed = 0;
    this.hand = null;
    this.upgrades = new Set();
    this.floaters = [];
    this.particles = [];
    this.bannerText = '';
    this.bannerT = 0;
    this.buttons = [];
    this.shopCards = [];
    this.dayStats = { coins: 0, tips: 0, serves: 0, walkouts: 0, bestCombo: 0 };
    this.best = 0;
    try { this.best = Number(localStorage.getItem(BEST_KEY) || 0) || 0; } catch { this.best = 0; }
    this.attract = this.makeAttract();
    this.setButtons();
  }

  get dishes() { return DISHES; }
  tableCount() { return 4 + (this.upgrades.has('table') ? 1 : 0); }
  cookMul() { return this.upgrades.has('oven') ? 0.7 : 1; }
  patienceMul() { return this.upgrades.has('music') ? 1.25 : 1; }
  tipMul() { return this.upgrades.has('tips') ? 1.25 : 1; }

  // Decorative guests for the title screen: seated, orders up, patience frozen.
  makeAttract() {
    const rng = mulberry32(7);
    const list = [];
    const speciesIdx = [0, 2, 3];
    const orders = [['soup'], ['coffee', 'pie'], ['salad']];
    for (let i = 0; i < 3; i++) {
      const c = new Customer(SPECIES[i === 1 ? 2 : speciesIdx[i]] || SPECIES[0], i, orders[i], 30);
      c.state = 'seated';
      c.x = TABLES[i].x;
      c.y = TABLES[i].y - 8;
      c.bob = rng() * 6;
      list.push(c);
    }
    return list;
  }

  setButtons() {
    const cx = VIEW_W / 2;
    this.buttons = [];
    this.shopCards = [];
    if (this.state === 'results') {
      this.buttons = [
        { x: cx - 270, y: 470, w: 250, h: 52, label: 'Upgrade Shop', action: 'shop' },
        { x: cx + 20, y: 470, w: 250, h: 52, label: this.day + 1 >= 3 ? 'Final Results →' : 'Next Day →', action: 'next' },
      ];
    } else if (this.state === 'shop') {
      UPGRADES.forEach((u, i) => {
        this.shopCards.push({ x: 140 + i * 260, y: 200, w: 240, h: 150, upgrade: u });
      });
      this.buttons = [
        { x: cx - 125, y: 420, w: 250, h: 52, label: this.day + 1 >= 3 ? 'Final Results →' : 'Next Day →', action: 'next' },
      ];
    } else if (this.state === 'win') {
      this.buttons = [
        { x: cx - 270, y: 470, w: 250, h: 52, label: 'Play Again', action: 'again' },
        { x: cx + 20, y: 470, w: 250, h: 52, label: 'Title Screen', action: 'title' },
      ];
    } else if (this.state === 'lose') {
      this.buttons = [
        { x: cx - 270, y: 470, w: 250, h: 52, label: 'Try Day Again', action: 'retry' },
        { x: cx + 20, y: 470, w: 250, h: 52, label: 'Title Screen', action: 'title' },
      ];
    }
  }

  toState(s) {
    this.state = s;
    this.setButtons();
  }

  startDay(d) {
    this.day = d;
    this.scoreAtDayStart = this.totalScore;
    this.dayCoins = 0;
    this.strikes = 0;
    this.combo = 0;
    this.elapsed = 0;
    this.hand = null;
    this.floaters = [];
    this.particles = [];
    this.customers.reset();
    this.kitchen.reset();
    this.dayStats = { coins: 0, tips: 0, serves: 0, walkouts: 0, bestCombo: 0 };
    this.dayStartTips = this.totalTips;
    this.dayStartServes = this.totalServes;
    this.toState('playing');
  }

  retryDay() {
    this.totalScore = this.scoreAtDayStart;
    this.startDay(this.day);
  }

  nextDay() {
    if (this.day + 1 >= 3) {
      this.finishRun();
    } else {
      this.startDay(this.day + 1);
    }
  }

  finishRun() {
    this.toState('win');
    this.audio.win();
    if (this.totalScore > this.best) {
      this.best = this.totalScore;
      try { localStorage.setItem(BEST_KEY, String(this.best)); } catch { /* offline-safe */ }
    }
  }

  dayComplete() {
    this.dayStats = {
      coins: this.dayCoins,
      tips: this.totalTips - this.dayStartTips,
      serves: this.totalServes - this.dayStartServes,
      walkouts: this.dayStats.walkouts,
      bestCombo: this.bestCombo,
    };
    this.audio.win();
    this.toState('results');
  }

  dayFailed() {
    this.audio.lose();
    this.toState('lose');
  }

  buyUpgrade(id) {
    const u = UPGRADES.find((x) => x.id === id);
    if (!u || this.upgrades.has(id) || this.dayCoins < u.cost) return false;
    this.dayCoins -= u.cost;
    this.upgrades.add(id);
    this.audio.coin();
    this.addFloater(640, 180, `${u.name} installed!`, '#6ee7a0', 24);
    return true;
  }

  onRush() {
    this.bannerText = '⚡ RUSH HOUR! ⚡';
    this.bannerT = 2.5;
    this.audio.rush();
  }

  onWalkout(c) {
    if (this.state !== 'playing') return; // two walkouts in one tick must not double-count past MAX_STRIKES
    this.strikes += 1;
    this.combo = 0;
    this.dayStats.walkouts += 1;
    this.audio.strike();
    const spot = TABLES[c.table];
    this.addFloater(spot.x, spot.y - 120, 'Walkout!  ♥ -1', '#ff5d5d', 24);
    this.burst(spot.x, spot.y, '#8d86a3', 10);
    if (this.strikes >= MAX_STRIKES) this.dayFailed();
  }

  serveCustomer(c) {
    if (!this.hand) return;
    const dish = DISHES.find((d) => d.key === this.hand);
    const idx = c.wants(this.hand);
    if (idx < 0) {
      c.shake = 0.5;
      this.audio.angry();
      const spot = TABLES[c.table];
      this.addFloater(spot.x, spot.y - 130, 'Not what they ordered!', '#ff5d5d', 18);
      return;
    }
    c.serve(this.hand);
    this.hand = null;
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const comboMult = Math.min(2, 1 + 0.1 * (this.combo - 1));
    const tip = Math.round(dish.price * 0.5 * c.patienceFrac * c.species.tip * this.tipMul() * comboMult);
    const earned = dish.price + tip;
    this.dayCoins += earned;
    this.totalScore += earned;
    this.totalTips += tip;
    this.totalServes += 1;
    const spot = TABLES[c.table];
    this.addFloater(spot.x, spot.y - 130, `+${earned} 🪙`, '#ffd166', 24);
    if (tip > 0) this.addFloater(spot.x, spot.y - 158, `tip +${tip}`, '#4fd1c5', 17);
    this.burst(spot.x, spot.y - 20, dish.color, 14);
    this.audio.serve();
    this.audio.coin();
    if (c.done) {
      c.state = 'leaving';
      c.happy = true;
      c.anim = 0;
    }
    if (this.dayCoins >= DAYS[this.day].target) this.dayComplete();
  }

  addFloater(x, y, text, color, size = 20) {
    this.floaters.push({ x, y, text, color, size, t: 0, life: 1.4 });
  }

  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 140;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
        t: 0, life: 0.6 + Math.random() * 0.4, color, size: 3 + Math.random() * 4,
      });
    }
  }

  clickButton(x, y) {
    for (const b of this.buttons) {
      if (b.disabled) continue;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.action;
    }
    return null;
  }

  handleClick(x, y) {
    this.audio.unlock();
    // Mute toggle (top-right speaker icon)
    if (x >= 1224 && x <= 1256 && y >= 18 && y <= 50) {
      this.audio.setMuted(!this.audio.muted);
      return;
    }
    // Pause toggle (top bar, left of mute)
    if (this.state === 'playing' && x >= 1180 && x <= 1212 && y >= 18 && y <= 50) {
      this.toState('paused');
      return;
    }
    if (this.state === 'paused') { this.toState('playing'); return; }

    if (this.state === 'title') { this.startDay(0); return; }

    if (this.state === 'results' || this.state === 'win' || this.state === 'lose') {
      const a = this.clickButton(x, y);
      if (a === 'shop') this.toState('shop');
      else if (a === 'next') this.nextDay();
      else if (a === 'again') { this.totalScore = 0; this.upgrades = new Set(); this.startDay(0); }
      else if (a === 'retry') this.retryDay();
      else if (a === 'title') { this.toState('title'); this.attract = this.makeAttract(); }
      return;
    }

    if (this.state === 'shop') {
      for (const card of this.shopCards) {
        if (x >= card.x && x <= card.x + card.w && y >= card.y && y <= card.y + card.h) {
          this.buyUpgrade(card.upgrade.id);
          return;
        }
      }
      const a = this.clickButton(x, y);
      if (a === 'next') this.nextDay();
      return;
    }

    if (this.state !== 'playing') return;

    // Stations
    const si = this.kitchen.stationAt(x, y);
    if (si >= 0) {
      const st = this.kitchen.stations[si];
      if (st.status === 'ready') {
        if (!this.hand) { this.hand = this.kitchen.takeReady(si); this.audio.click(); }
      } else if (st.status === 'idle') {
        this.kitchen.startCook(si);
      }
      return;
    }
    // Tray slots: take a dish, swap with the held one, or put the held
    // dish down on an empty slot.
    const slot = this.kitchen.traySlotAt(x, y);
    if (slot >= 0) {
      if (this.kitchen.tray[slot]) {
        const d = this.kitchen.takeTray(slot);
        if (this.hand) { // swap: put the held dish back if there is room
          const free = this.kitchen.trayFree();
          if (free >= 0) this.kitchen.tray[free] = this.hand;
          else { this.kitchen.tray[slot] = d; return; }
        }
        this.hand = d;
        this.audio.click();
        return;
      }
      if (this.hand) { // empty slot: put the held dish down
        this.kitchen.tray[slot] = this.hand;
        this.hand = null;
        this.audio.click();
        return;
      }
    }
    // Customers (click near a seated guest)
    for (const c of this.customers.customers) {
      if (!c.seated) continue;
      const dx = x - c.x, dy = y - (c.y + 10);
      if (dx * dx + dy * dy < 70 * 70) {
        if (this.hand) this.serveCustomer(c);
        else this.addFloater(c.x, c.y - 140, 'Pick up a dish first!', '#8d86a3', 16);
        return;
      }
    }
  }

  handleKey(k) {
    this.audio.unlock();
    if (k === 'm') { this.audio.setMuted(!this.audio.muted); return; }
    if (this.state === 'title' && (k === 'Enter' || k === ' ')) { this.startDay(0); return; }
    if (this.state === 'playing' && (k === ' ' || k === 'p' || k === 'Escape')) { this.toState('paused'); return; }
    if (this.state === 'paused' && (k === ' ' || k === 'p' || k === 'Enter' || k === 'Escape')) { this.toState('playing'); return; }
    if (this.state === 'playing' && ['1', '2', '3', '4'].includes(k)) {
      this.kitchen.startCook(Number(k) - 1);
      return;
    }
    if ((this.state === 'results' || this.state === 'shop') && k === 'Enter') { this.nextDay(); return; }
    if ((this.state === 'win' || this.state === 'lose') && k === 'Enter') {
      if (this.state === 'win') { this.totalScore = 0; this.upgrades = new Set(); this.startDay(0); }
      else this.retryDay();
    }
  }

  update(dt) {
    this.t += dt;
    if (this.bannerT > 0) this.bannerT -= dt;
    for (const f of this.floaters) f.t += dt;
    this.floaters = this.floaters.filter((f) => f.t < f.life);
    for (const p of this.particles) {
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt;
    }
    this.particles = this.particles.filter((p) => p.t < p.life);

    if (this.state === 'title') {
      for (const c of this.attract) c.bob += dt * 3;
      return;
    }
    // Screenshot scenes are frozen: they stage one moment, they do not play.
    if (this.shotMode) return;
    if (this.state !== 'playing') return;
    this.elapsed += dt;
    this.customers.update(dt, this.rng, this.day, this.elapsed);
    this.kitchen.update(dt);
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    const r = this.renderer;
    if (this.state === 'title') {
      r.drawDiner(ctx, this.t);
      for (let i = 0; i < 4; i++) r.drawStation(ctx, i, this.kitchen.stations[i], false, this.t);
      r.drawTray(ctx, this.kitchen, null, this.t);
      r.drawTitle(ctx, this);
      return;
    }
    r.drawDiner(ctx, this.t);
    for (let i = 0; i < 4; i++) {
      r.drawStation(ctx, i, this.kitchen.stations[i], this.input.hover(...stationRect(i)), this.t);
    }
    for (const c of this.customers.customers) r.drawCustomer(ctx, c, this.t);
    r.drawTray(ctx, this.kitchen, this.hand, this.t);
    r.drawHUD(ctx, this);
    r.drawParticles(ctx, this);
    r.drawFloaters(ctx, this);
    r.drawBanner(ctx, this);
    if (this.state === 'paused') r.drawPaused(ctx, this);
    else if (this.state === 'results') r.drawResults(ctx, this);
    else if (this.state === 'shop') r.drawShop(ctx, this);
    else if (this.state === 'win') r.drawWin(ctx, this);
    else if (this.state === 'lose') r.drawLose(ctx, this);
    // Held-dish cursor ring
    if (this.hand && this.state === 'playing') {
      const d = DISHES.find((x) => x.key === this.hand);
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.arc(this.input.x, this.input.y, 20, 0, Math.PI * 2); ctx.fill();
      text2(ctx, d.glyph, this.input.x, this.input.y + 1, 20, '#241a33');
      ctx.restore();
    }
  }
}

function stationRect(i) {
  const s = STATIONS[i];
  return [s.x, s.y, s.w, s.h];
}
function text2(ctx, s, x, y, size, color) {
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px "Trebuchet MS", Verdana, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}
