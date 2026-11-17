// Starlight Diner — diner floor layout in the 1280x720 view.
// Stations live in the left rail; tables fill the right floor; the pass
// tray runs along the bottom. Everything else reads these spots so the
// scene, the clicks and the screenshots all agree.
export const HUD_H = 64;

// 4 dish stations, stacked in the left rail.
export const STATIONS = [
  { x: 20,  y: 84,  w: 232, h: 132 },
  { x: 20,  y: 228, w: 232, h: 132 },
  { x: 20,  y: 372, w: 232, h: 132 },
  { x: 20,  y: 516, w: 232, h: 132 },
];

// 6 table spots (2 rows x 3 cols). Base game uses the first 4;
// the Extra Table upgrade opens spot 5.
export const TABLES = [
  { x: 430, y: 215, r: 78 },
  { x: 720, y: 215, r: 78 },
  { x: 1010, y: 215, r: 78 },
  { x: 430, y: 470, r: 78 },
  { x: 720, y: 470, r: 78 },
  { x: 1010, y: 470, r: 78 },
];

// The pass tray: cooked dishes wait here. 4 slots along the bottom.
export const TRAY = { x: 280, y: 622, w: 980, h: 82, slots: 4 };

// Door (customers walk in from here) and the diner sign position.
export const DOOR = { x: 1210, y: 96 };
export const SIGN = { x: 640, y: 40 };
