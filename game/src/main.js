// Starlight Diner — boot: canvas, game loop, resize, input wiring.
// ?shot=start|play|rush|end renders a deterministic screenshot scene
// (see shots.js); without it the game starts on the title screen.
import { Game } from './game.js';
import { loadShot } from './shots.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);
window.__game = game; // test/debug handle (used by tools/shots.mjs)

function frame(now) {
  const dt = Math.min(0.05, (now - (frame.last || now)) / 1000 || 0.016);
  frame.last = now;
  for (const c of game.input.drainClicks()) game.handleClick(c.x, c.y);
  for (const k of game.input.drainKeys()) game.handleKey(k);
  game.update(dt);
  game.render();
  requestAnimationFrame(frame);
}

function resize() { game.input.fit(); }
window.addEventListener('resize', resize);
resize();

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
if (shot) {
  const seed = Number(params.get('seed') || 1);
  loadShot(game, shot, seed);
}

requestAnimationFrame(frame);
