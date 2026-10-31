// Dorf-Infopanel mit Aktionen (Ausbau, Schutzgebühr, Plündern)
import type { Game } from '../game';
import { ECON, NEUTRAL, PLAYER } from '../sim/defs';
import type { Village } from '../sim/types';
import { factionName } from '../sim/world';
import { bar, costHtml, esc, fmt, icon } from './dom';

export function statusText(v: Village, owner: string): string {
  switch (v.status) {
    case 'eigen': return owner === PLAYER ? 'Stammdorf – zahlt dir Steuern' : `Stammdorf von ${factionName(owner)}`;
    case 'besetzt': return owner === PLAYER ? 'Besetzt – zahlt dir Besatzungsabgabe' : `Besetzt von ${factionName(owner)}`;
    case 'schutz': return `Zahlt Schutzgebühr an ${factionName(v.schutz!)}`;
    case 'schutz-pausiert': return `Schutzgebühr ausgesetzt – zu wenig Truppen von ${factionName(v.schutz!)} in der Nähe`;
    case 'aufstand': return 'Aufstand! Zahlt keine Abgaben';
    default: return 'Unabhängig';
  }
}

export function villageHtml(game: Game, provId: string, v: Village, compact = false): string {
  const prov = game.state.provinces[provId];
  const res = game.state.factions[PLAYER].res;
  const mine = prov.owner === PLAYER;
  const receiver = v.status === 'schutz' ? v.schutz : v.income > 0 ? prov.owner : null;
  const forMe = receiver === PLAYER;
  let html = `<div class="village">
    <div class="vhead">${icon('village.dorf', 'ico l')}<div><b>${esc(v.name)}</b><br><small class="st-${v.status}">${esc(statusText(v, prov.owner))}</small></div></div>
    <div class="kv"><span>${icon('icon.einwohner')} Einwohner</span><b>${fmt(v.pop)}</b></div>
    <div class="kv"><span>${icon('icon.zufriedenheit')} Zufriedenheit</span><b>${Math.round(v.happiness)} %</b></div>
    ${bar(v.happiness / 100, v.happiness < 30 ? 'bad' : v.happiness > 60 ? 'good' : '')}
    <div class="kv"><span>${icon('icon.geld')} Abgaben</span><b class="${forMe ? 'pos' : ''}">${fmt(v.income)} T/min${receiver && !forMe ? ` → ${esc(factionName(receiver))}` : ''}</b></div>`;
  if (compact) return html + '</div>';

  if (mine) {
    html += `<div class="sub">Ausbau</div>`;
    for (const [key, def] of Object.entries(ECON.villageUpgrades)) {
      const has = v.upgrades.includes(key);
      html += `<button class="row" data-act="upgrade" data-prov="${provId}" data-village="${v.id}" data-upgrade="${key}" ${has ? 'disabled' : ''}>
        <span><b>${def.name}</b> <small>${def.desc}</small></span><span>${has ? '✓ gebaut' : costHtml(def.cost, res)}</span></button>`;
    }
  } else {
    const mySchutz = v.schutz === PLAYER;
    html += `<div class="sub">Druck ausüben</div>
      <button class="row" data-act="schutz" data-prov="${provId}" data-village="${v.id}" data-on="${mySchutz ? 0 : 1}">
        <span><b>${mySchutz ? 'Schutzgebühr beenden' : 'Schutzgebühr fordern'}</b>
        <small>Zahlt ${Math.round(ECON.protectionRate * 100)} T je 100 Einwohner/min, solange deine Truppen (max. ${ECON.protectionRadius} Felder) überlegen sind</small></span></button>
      <button class="row danger" data-act="plunder" data-prov="${provId}" data-village="${v.id}" ${v.plunderCooldown > 0 ? 'disabled' : ''}>
        <span><b>Plündern</b> <small>${v.plunderCooldown > 0 ? `wieder möglich in ${Math.ceil(v.plunderCooldown)} s` : `ca. +${fmt(v.pop * ECON.plunder.geldPerPop)} T, +${fmt(v.pop * ECON.plunder.goldPerPop)} Gold. Kostet ${Math.round(ECON.plunder.popLoss * 100)} % der Einwohner${prov.owner === NEUTRAL ? ', Miliz wird feindlich' : ''}`}</small></span></button>`;
  }
  return html + '</div>';
}

/** Behandelt Klicks auf Dorf-Aktionen. Gibt true zurück, wenn die Aktion erkannt wurde. */
export function handleVillageAction(game: Game, el: HTMLElement): boolean {
  const { act, prov, village } = el.dataset;
  if (!prov || !village) return false;
  if (act === 'upgrade') game.issue({ type: 'villageUpgrade', province: prov, village, upgrade: el.dataset.upgrade! });
  else if (act === 'schutz') game.issue({ type: 'schutz', province: prov, village, on: el.dataset.on === '1' });
  else if (act === 'plunder') game.issue({ type: 'plunder', province: prov, village });
  else return false;
  return true;
}
