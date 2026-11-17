// Starlight Diner — tuning: dishes, species, days, upgrades.
// Every number that shapes difficulty lives here, so the game can be
// balanced by editing this file alone.
export const VIEW_W = 1280;
export const VIEW_H = 720;

// Dishes: key, name, cook seconds, coin price, color, icon glyph.
export const DISHES = [
  { key: 'soup',   name: 'Star Soup',    cook: 2.0, price: 10, color: '#ffb347', glyph: '✦' },
  { key: 'coffee', name: 'Comet Coffee', cook: 2.5, price: 12, color: '#c98cff', glyph: '☕' },
  { key: 'pie',    name: 'Moon Pie',     cook: 3.0, price: 14, color: '#ffd166', glyph: '◐' },
  { key: 'salad',  name: 'Nebula Salad', cook: 4.0, price: 18, color: '#6ee7a0', glyph: '✿' },
];

// Alien species: patience seconds, tip bonus, order size, colors.
export const SPECIES = [
  { key: 'blorp', name: 'Blorp', patience: 30, tip: 1.0, dishes: 1, body: '#7ddb7d', belly: '#c8f5c8', eyes: '#12351a' },
  { key: 'zap',   name: 'Zap',   patience: 18, tip: 1.5, dishes: 1, body: '#ffd94d', belly: '#fff3bf', eyes: '#4a3200' },
  { key: 'molly', name: 'Molly', patience: 24, tip: 1.2, dishes: 2, body: '#c98cff', belly: '#ecd9ff', eyes: '#2c1040' },
  { key: 'elder', name: 'Elder', patience: 35, tip: 1.6, dishes: 2, body: '#6db3ff', belly: '#d6e9ff', eyes: '#0a2540' },
];
export const VIP = { key: 'vip', name: 'Nova VIP', patience: 22, tip: 3.0, dishes: 2, body: '#ffd700', belly: '#fff7cc', eyes: '#4a3200' };

// Days: coin target, spawn interval (s), patience scale, rush at second.
export const DAYS = [
  { target: 120, spawn: 7.0, patience: 1.15, dishes2: 0.15, rushAt: 45 },
  { target: 200, spawn: 5.5, patience: 1.0,  dishes2: 0.35, rushAt: 40 },
  { target: 280, spawn: 5.0, patience: 0.95,  dishes2: 0.55, rushAt: 35 },
];
export const MAX_STRIKES = 3;
export const BASE_TABLES = 4;

// Upgrades sold between days: id, name, cost, blurb.
export const UPGRADES = [
  { id: 'oven',   name: 'Turbo Oven',   cost: 60,  blurb: 'Cook 30% faster' },
  { id: 'table',  name: 'Extra Table',  cost: 80,  blurb: '+1 table, more guests' },
  { id: 'music',  name: 'Calm Music',   cost: 50,  blurb: 'Patience +25%' },
  { id: 'tips',   name: 'Golden Tips',  cost: 70,  blurb: 'Tips +25%' },
];

export const COLORS = {
  space: '#0b1020', floor: '#2a1f3d', floorLine: '#3a2d55',
  counter: '#4a3550', counterTop: '#6b4d7a', wall: '#171233',
  cream: '#fff6e5', ink: '#241a33', muted: '#8d86a3',
  gold: '#ffd166', coral: '#ff7a6b', teal: '#4fd1c5', green: '#6ee7a0',
  red: '#ff5d5d', panel: 'rgba(16, 12, 32, 0.88)', panelEdge: '#4fd1c5',
};
