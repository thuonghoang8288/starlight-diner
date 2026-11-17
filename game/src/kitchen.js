// Starlight Diner — the kitchen: 4 dish stations and the pass tray.
// Click a station to start cooking (one dish per station). When a dish
// finishes it lands on the tray; click a tray dish (or a ready station)
// to hold it, then click a customer to serve.
import { DISHES } from './config.js';
import { STATIONS, TRAY } from './layout.js';

export class Kitchen {
  constructor(game) {
    this.game = game;
    this.stations = DISHES.map((d) => ({ dish: d, status: 'idle', t: 0, dur: 0 }));
    this.tray = [null, null, null, null];
  }

  reset() {
    this.stations = DISHES.map((d) => ({ dish: d, status: 'idle', t: 0, dur: 0 }));
    this.tray = [null, null, null, null];
  }

  cookTime(dish) {
    return dish.cook * this.game.cookMul();
  }

  startCook(i) {
    const s = this.stations[i];
    if (!s || s.status !== 'idle') return false;
    s.status = 'cooking';
    s.t = 0;
    s.dur = this.cookTime(s.dish);
    this.game.audio.cook();
    return true;
  }

  trayFree() { return this.tray.indexOf(null); }

  update(dt) {
    for (const s of this.stations) {
      if (s.status !== 'cooking') continue;
      s.t += dt;
      if (s.t >= s.dur) {
        const slot = this.trayFree();
        if (slot >= 0) {
          this.tray[slot] = s.dish.key;
          s.status = 'idle'; s.t = 0;
          this.game.audio.ready();
        } else {
          s.status = 'ready';
          this.game.audio.ready();
        }
      }
    }
  }

  // Clicking a ready station picks its dish up (if the tray is full the
  // dish waits there; clicking it takes it straight into the hand).
  takeReady(i) {
    const s = this.stations[i];
    if (!s || s.status !== 'ready') return null;
    s.status = 'idle'; s.t = 0;
    return s.dish.key;
  }

  takeTray(slot) {
    if (slot < 0 || slot >= this.tray.length) return null;
    const d = this.tray[slot];
    this.tray[slot] = null;
    return d;
  }

  // Hit-test helpers for the game: which station / tray slot is here?
  stationAt(x, y) {
    for (let i = 0; i < STATIONS.length; i++) {
      const s = STATIONS[i];
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return i;
    }
    return -1;
  }

  traySlotAt(x, y) {
    if (y < TRAY.y || y > TRAY.y + TRAY.h) return -1;
    const slotW = TRAY.w / TRAY.slots;
    const i = Math.floor((x - TRAY.x) / slotW);
    if (i < 0 || i >= TRAY.slots) return -1;
    return i;
  }
}
