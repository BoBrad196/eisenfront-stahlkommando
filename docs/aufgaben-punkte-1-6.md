# Aufgaben: Punkte 1 bis 6 (Eisenfront: Stahlkommando)

Repo: /home/user/imperium-europa. Blender-Skripte: /home/user/blender-test (Kopien in tools/blender).
Installation: `python3 tools/blender/install.py <kind> <ordner>`, danach `python3 tools/blender/trim.py`.
Blender-Umgebung: /home/user/blender-env (`source bin/activate`). Ein Dorf-Render mit SAMPLES=96 dauert etwa 2 Minuten.
Meta-Werte (anchor, frames, scale) und Grundrisse nicht ändern.

## 1. Gebäude-Alterung im Dorf
- eflib.tiles1940: ausgebrochene/verschobene Ziegel, Moosbänder an Dachkanten.
- plaster1940: abgeplatzte Stellen mit Ziegel darunter verstärken, feuchte Ränder unten.
- Dachrinnen mit dunklen Laubstreifen.
- Stärke pro Haus zufällig (rnd).
Fertig: Dorf-Nahansicht zeigt die Veränderung, `npx tsx tests/village-gap.ts` besteht, Bild übernommen.

## 2. Übrige Gebäude
Kaserne, Panzerfabrik, Kraftwerk, Bergwerke, Goldmine, Verwaltung, Forschungszentrum, Flugfeld, Werft, Flakstellung, Geschützturm, Bauhof.
- Pro Instanz leichte Farb- und Verschmutzungsvarianten.
- Dachrinnen und Fallrohre an Hallen.
- Ruß um Schornsteine und Ausgänge.
Fertig: alle Gebäude neu gerendert, Screenshot im Spiel, `tests/conquest.ts` und `tests/sim-smoke.ts` bestehen.

## 3. Boden
- src/render/terrain.ts: Pfützen in Senken (wet/depth-Gitter), Erdflecke um Gebäude.
- src/render/province.ts: Reifenspuren entlang Dorfstraßen bei Fahrzeugverkehr.
- Mehr Varianten der Kleinteile in decor().
Fertig: Screenshots, FPS vorher/nachher gleich, `tests/sim-smoke.ts` besteht.

## 4. Vieh und Dorfbewohner
- leute.py: Kühe mit 3–4 Fellmustern und Größen, Pferde Rappe/Fuchs/Schimmel, Dorfbewohner mit 2–3 Kleidungsfarben und Kopfbedeckungen.
- Neue Sprite-Schlüssel (z. B. life.kuh.b) in assets/manifest.json, Auswahl pro Tier deterministisch in src/render/ambient.ts.
Fertig: Kontaktbogen, Screenshot eines Dorfs, `tests/sim-smoke.ts` besteht.

## 5. Animationen im Spiel (ohne neue Renderings)
- Wäsche flattert bei Wind (WIND aus ambient.ts).
- Schornsteinrauch: stärker bei Kohle (Kraftwerk, Fabriken), schwächer bei Häusern, Richtung mit WIND.
- Fahnen wehen im Rhythmus des Winds (drawFlag).
- Kühe grasen und ziehen, Pferde traben bei Gefechten in der Nähe (combatLevel).
Fertig: Kurzvideo oder Screenshots pro Punkt, FPS geprüft.

## 6. Modelldetail aller Gebäude
- eflib: Fugen, Relief, Verwitterung verbessern; zuerst an der Kaserne testen und mit dem Vorher-Bild vergleichen.
- Fensterrahmen, Gesimse, Dachrinnen je Haustyp.
- Alle Gebäude neu rendern, trim.py, Vorher/Nachher je Typ.
Fertig: Vergleich je Gebäudetyp, Tests bestehen.

Empfohlene Reihenfolge: 5 (ohne Renderings, sofort sichtbar), dann 3, dann 1 und 2, zuletzt 4 und 6.
