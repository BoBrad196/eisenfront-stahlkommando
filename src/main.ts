import './style.css';
import { assets } from './assets';
import { audio } from './audio';
import { Game } from './game';
import { MainMenu } from './ui/menu';
import { ensureMap, placeBuilding, placementError, spawnUnit } from './sim/world';

const app = document.getElementById('app')!;

// Touch-Bedienung: Geräte mit grobem Zeiger sofort, sonst beim ersten Fingerdruck; eine Maus-Bewegung schaltet zurück
const setTouch = (on: boolean) => document.body.classList.toggle('touch', on);
setTouch(matchMedia('(pointer: coarse)').matches);
window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') setTouch(true); }, true);
window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && !matchMedia('(pointer: coarse)').matches) setTouch(false); }, true);
const hint = document.createElement('div');
hint.id = 'rotatehint';
hint.innerHTML = '<div><svg viewBox="0 0 48 48" width="56" height="56" fill="none" stroke="currentColor" stroke-width="3"><rect x="14" y="4" width="20" height="40" rx="3"/><path d="M40 20c3 2 5 5 5 8M8 28c-3-2-5-5-5-8" stroke-linecap="round"/></svg><p>Bitte das Gerät quer halten</p></div>';
document.body.appendChild(hint);
// Antippen der Karte schließt das ausgefahrene Kommandopult (Handy-Layout)
window.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).id === 'screen') document.getElementById('main')?.classList.remove('sb-open'); }, true);
const menu = new MainMenu(document.body); // zeigt zuerst den Ladebalken auf dem Titelbild
audio.load(); // läuft nebenher, blockiert den Start nicht
assets.load((done, total) => menu.setProgress(done, total)).then(() => {
  const game = new Game(app);
  game.menu = menu;
  menu.attach(game);
  // für Tests und Fehlersuche in der Konsole
  Object.assign(window, { game, menu, audio, assets, __sim: { ensureMap, placeBuilding, placementError, spawnUnit } });
  // Das Spiel ruht, bis im Hauptmenü ein Feldzug gewählt wird (?menu=0 überspringt das Menü für Tests)
  if (new URLSearchParams(location.search).get('menu') === '0') { game.newGame(); menu.hide(); return; }
  game.setSuspended(true);
  menu.show(false);
});
