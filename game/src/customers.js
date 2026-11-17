// Starlight Diner — customers: species, orders, patience, arrivals.
// A customer arrives, walks to a free table, orders, and waits. Serve
// every dish they ordered before their patience runs out: they pay and
// leave happy. Let patience hit zero and they storm out angry — a strike.
import { SPECIES, VIP, DAYS } from './config.js';
import { TABLES, DOOR } from './layout.js';
import { pick, chance } from './random.js';

export class Customer {
  constructor(species, tableIdx, order, patienceMax, vip = false) {
    this.species = species;
    this.table = tableIdx;
    this.order = order;                 // dish keys, in order
    this.served = order.map(() => false);
    this.patience = patienceMax;
    this.patienceMax = patienceMax;
    this.vip = vip;
    this.state = 'arriving';            // arriving | seated | leaving | gone
    this.happy = false;
    this.anim = 0;                      // arrival / leaving animation 0..1
    this.bob = Math.random() * Math.PI * 2;
    this.x = DOOR.x; this.y = DOOR.y;
    this.tx = TABLES[tableIdx].x; this.ty = TABLES[tableIdx].y - 8;
    this.shake = 0;
  }

  get seated() { return this.state === 'seated'; }
  get done() { return this.served.every(Boolean); }
  get patienceFrac() { return Math.max(0, this.patience / this.patienceMax); }
  get lowPatience() { return this.patienceFrac < 0.35; }

  // First unserved dish this customer still wants, or -1.
  wants(dishKey) {
    for (let i = 0; i < this.order.length; i++) {
      if (!this.served[i] && this.order[i] === dishKey) return i;
    }
    return -1;
  }

  serve(dishKey) {
    const i = this.wants(dishKey);
    if (i < 0) return false;
    this.served[i] = true;
    return true;
  }

  update(dt) {
    this.bob += dt * 3;
    if (this.state === 'arriving') {
      this.anim = Math.min(1, this.anim + dt * 1.6);
      const e = 1 - Math.pow(1 - this.anim, 3);
      this.x = DOOR.x + (this.tx - DOOR.x) * e;
      this.y = DOOR.y + (this.ty - DOOR.y) * e;
      if (this.anim >= 1) this.state = 'seated';
    } else if (this.state === 'seated') {
      this.patience -= dt;
      if (this.shake > 0) this.shake -= dt;
    } else if (this.state === 'leaving') {
      this.anim = Math.min(1, this.anim + dt * 1.4);
      this.y -= dt * 120;
    }
  }
}

export class CustomerManager {
  constructor(game) {
    this.game = game;
    this.customers = [];
    this.spawnT = 2.0;      // first guest arrives quickly
    this.vipSpawned = false;
    this.rushDone = false;
    this.rushT = 0;
  }

  reset() {
    this.customers = [];
    this.spawnT = 2.0;
    this.vipSpawned = false;
    this.rushDone = false;
    this.rushT = 0;
  }

  freeTable() {
    const max = this.game.tableCount();
    for (let i = 0; i < max; i++) {
      if (!this.customers.some((c) => c.table === i && c.state !== 'gone')) return i;
    }
    return -1;
  }

  tableCount() { return this.game.tableCount(); }

  makeOrder(rng, day) {
    const two = chance(rng, DAYS[day].dishes2);
    const n = two ? 2 : 1;
    const order = [];
    for (let i = 0; i < n; i++) {
      order.push(pick(rng, this.game.dishes).key);
    }
    return order;
  }

  spawn(rng, day, forceVip = false) {
    const table = this.freeTable();
    if (table < 0) return null;
    let species = pick(rng, SPECIES);
    let vip = false;
    if (forceVip) { species = VIP; vip = true; }
    const dayCfg = DAYS[day];
    const patience = species.patience * dayCfg.patience * this.game.patienceMul();
    const order = this.makeOrder(rng, day);
    const c = new Customer(species, table, order, patience, vip);
    this.customers.push(c);
    return c;
  }

  update(dt, rng, day, elapsed) {
    // Rush hour: a burst of guests with a banner.
    if (!this.rushDone && elapsed >= DAYS[day].rushAt) {
      this.rushDone = true;
      this.rushT = 2.5;
      this.game.onRush();
      for (let i = 0; i < 3; i++) this.spawn(rng, day);
    }
    if (this.rushT > 0) this.rushT -= dt;

    // VIP appears once, past the halfway mark.
    if (!this.vipSpawned && elapsed > 55) {
      this.vipSpawned = true;
      this.spawn(rng, day, true);
    }

    // Steady arrivals while the day is still going.
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = DAYS[day].spawn * (0.8 + rng() * 0.4);
      this.spawn(rng, day);
    }

    for (const c of this.customers) {
      c.update(dt);
      if (c.state === 'seated' && c.patience <= 0) {
        c.state = 'leaving';
        c.happy = false;
        c.anim = 0;
        this.game.onWalkout(c);
      }
      if (c.state === 'leaving' && c.anim >= 1) c.state = 'gone';
    }
    this.customers = this.customers.filter((c) => c.state !== 'gone');
  }
}
