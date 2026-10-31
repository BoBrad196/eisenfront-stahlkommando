# Eisenfront: Stahlkommando

Echtzeit-Strategiespiel im Stil von Command & Conquer: Basen bauen, Rohstoffe fördern,
Dörfer besteuern, besetzen, unter „Schutz“ stellen oder plündern – und Europa erobern.

## Starten

```bash
npm install
npm run dev        # Entwicklungsserver, dann http://localhost:5173 öffnen
npm run build      # spielfertige Version in dist/ (mit beliebigem Webserver ausliefern)
```

## Spielprinzip

- **Strategiekarte Europa** – 62 Provinzen, angelehnt an reale Regionen. Klick = Details,
  Doppelklick = Detailkarte. Truppen werden zwischen Nachbarprovinzen verlegt (⚓ = Seeweg).
- **Detailkarte pro Provinz** – isometrische Ansicht wie bei klassischem C&C/Red Alert 2; hier wird gebaut und gekämpft.
- **Landschaft** – der Boden wird pixelgenau aus den Gelände-Texturen gemischt: natürliche Übergänge zwischen Wiese,
  Waldboden, Sand, Fels und Wasser, saftige und trockene Wiesenflächen, Wassertiefe, Uferschaum, nasser Sand,
  Grasbüschel, Blumen, Steine, Farne und Büsche, Mischwald aus vier Baumarten in verschiedenen Größen.
- **Dörfer** – jedes Dorf hat eine gepflasterte Dorfstraße mit zwei Querstraßen und weiteren Gassen, an denen beidseitig
  Grundstücke liegen (mindestens rund 20 Häuser): sechs Wohnhausarten (Fachwerk, Backstein, Klinker, Putz, kleine Kate),
  Bauernhöfe und Dreiseithof, zwei Scheunenarten, Obstwiesen und Gemüsegärten, Gasthaus und Kirche mit Kirchhof.
  In der Dorfmitte steht das **Gemeindehaus mit Dorfplatz** (Linde, Brunnen, Fahnenmast): dort weht die Fahne
  der Fraktion, die das Dorf hält oder Schutzgeld nimmt. Linden säumen die Dorfstraßen.
  Jedes Haus steht mit Tür und Vorgarten zur Straße, dahinter Gärten, Schuppen, Obstbäume. Grundstücke sind blockiert
  (Einheiten fahren auf den Straßen, dort kann nicht gebaut werden). Der Dorfplan steht in `src/sim/villageLayout.ts`.
- **Hauptmenü** – beim Start erscheint ein düsteres Titelbild (Dorf in der Dämmerung mit Nebel, Glut und Filmkorn)
  mit Ladebalken, danach: *Neuer Feldzug*, *Feldzug fortsetzen* (letzte Autospeicherung, alle 60 s und beim Verlassen
  der Seite), *Spielstand laden* (gespeicherter Stand), *Einstellungen* (Ton, Musik, Effekte, Vollbild) und *Beenden*.
  Im Spiel öffnet **Esc** oder der Knopf *Menü* das Hauptmenü (das Spiel ruht, dort auch *Spiel speichern*).
  Pfeiltasten und Enter bedienen es per Tastatur. Code: `src/ui/menu.ts`, Titelbild: `assets/graphics/menu/hero.jpg`.
  Mit `?menu=0` an der Adresse startet das Spiel ohne Menü (für Tests).
- **Stand 1940** – Einheiten, Waffen und Forschung entsprechen dem Jahr 1940: Panzer IV Ausf. D (kurze 7,5-cm-Kanone,
  ohne Schürzen), Neubaufahrzeug als schwerer Panzer, Panzerspähwagen Sd.Kfz. 232 mit Rahmenantenne, Sturmpanzer I
  (15-cm-sIG 33), Panzerbüchsen-Trupp (PzB 39), Ju 87 und Bf 109, Schnellboot, Zerstörer und Schwerer Kreuzer mit
  Geschützen. Fahrzeuge tragen dunkles Panzergrau (Tarnanstrich und Zimmerit kamen erst 1943; im Manifest dunkeln
  `shade` und `warm` die Grafik zusätzlich ab). Später entstandene Technik
  (Tiger, Panzerschreck, Hubschrauber, Strahlflugzeuge, Raketenschiffe, Verbundpanzerung) gibt es nicht.
- **Überrollschäden** – schwere Panzer (Panzer IV, Neubaufahrzeug; je schwerer, desto stärker) zerstören beim Überfahren,
  was im Weg steht. Die Simulation zählt die Überfahrten je Kachel (`map.crush`, wird mitgespeichert); daraus ergibt sich
  für jedes Objekt eine von vier Stufen (heil · beschädigt · schwer beschädigt · zerstört, siehe `src/sim/damage.ts`):
  - **Dorfstraßen**: Risse und ausgebrochene Pflastersteine → Schlaglöcher mit Pfützen → Pflaster zerstört, Matsch.
  - **Bäume**: schiefgedrückt → umgeknickt → nur noch Stumpf (dicke Bäume halten mehr aus, der Schatten verschwindet).
  - **Telegrafenmasten**: schief → abgebrochen, Leitung hängt am Boden → nur noch Stumpf.
  - **Feldzäune**: schief, Latten fehlen → nur noch Pfosten → weg.
  Dazu Staub, Splitter, Funken (gerissene Leitung) und eigene Geräusche (`sfx.knacken`, `sfx.schutt`).
  Leichte Fahrzeuge und Infanterie richten keinen Schaden an. Häuser, Mauern und Felsen sind ohnehin nicht befahrbar.
- **Lebendige Welt** – Wasserräder, Windmühlenflügel, Förderräder der Bergwerke, Kräne (Bauhof, Werft, Fabrik),
  das Funkmessgerät und der Windsack bewegen sich (eigene Bildfolgen aus Blender, samt mitlaufendem Schatten;
  schwer beschädigte Gebäude stehen still). Jedes Dorf hat eine Mühle – am Wasser eine Wassermühle, sonst eine
  Bockwindmühle. Dorfbewohner gehen über die Dorfstraßen (und weichen Fahrzeugen aus), Kühe grasen auf einer Weide,
  Bäume wiegen sich in Böen, Wolkenschatten ziehen über das Land, Vogelschwärme kreuzen die Karte und das Wasser
  glitzert. Das alles ist reine Darstellung (`src/render/ambient.ts`) und hat keinen Einfluss auf die Simulation.
- **Wege in echten Maßen** (1 Kachel = 5,6 m): Dorfstraße mit Kopfsteinpflaster 5,5 m, Schotter-Landstraße 5 m
  (Basis – Dörfer – Kartenrand, mit Telegrafenleitung), Feldweg 3 m (zu den Vorkommen). Ein Panzer IV ist 2,9 m breit.
- **Kulturlandschaft** – Feldwege verbinden Basis, Dörfer, Vorkommen und Kartenränder; entlang der Wege stehen
  Telegrafenmasten mit Leitungen. Bei den Dörfern liegen umzäunte Äcker (Weizen, junge Saat, gepflügt).
  Dörfer haben eine Kirche, beleuchtete Fenster und rauchende Schornsteine; Kraftwerk und Panzerfabrik qualmen ständig.
  Boden und Grafiken bekommen beim Laden eine warme, leicht entsättigte Farbstimmung, dazu eine Vignette.
- **Oberfläche (Kommandopult)** – rechts Minikarte im Messingrahmen, Ressourcen-Kacheln (Mark, Kohle, Eisen, Gold, Strom),
  Reiter Gebäude/Einheiten/Forschung/Dörfer mit Bildkarten und eine Produktionswarteschlange mit Restzeit.
  Unten die Befehlsleiste: Porträt mit Lebenspunkten, Auswahl-Kacheln (Klick = nur diese Einheit), Befehle
  Bewegen, Angriff, Reparieren, Sprengen (eigenes Gebäude verkaufen), Stopp und Verlegen in eine Nachbarprovinz.
  Gewählte Einheiten und Gebäude erhalten goldene Eckklammern.
- **Spuren und Matsch** – Fahrzeuge hinterlassen Ketten- bzw. Reifenspuren, die langsam verblassen. Wo oft gefahren wird,
  nutzt sich der Boden ab: plattgedrücktes Gras → Erde → tiefer Matsch mit Pfützen (schwere Fahrzeuge stärker,
  Infanterie tritt nur Trampelpfade aus). Gras wächst langsam nach. Die Abnutzung wird mitgespeichert;
  tiefer Matsch bremst Fahrzeuge (Radfahrzeuge mehr als Kettenfahrzeuge).
- **Nebel des Krieges** – Unerkundetes ist schwarz, Erkundetes ohne eigene Sicht abgedunkelt.
  Feindliche Einheiten sieht man nur in Sichtweite eigener Truppen und Gebäude.
  Auf der Europakarte gibt es Truppenstärken nur für eigene Provinzen, deren Nachbarn und Provinzen mit eigenen Truppen.
- **Rohstoffe**: Geld (Taler), Kohle, Eisen, Gold. Bergwerke müssen auf passenden Vorkommen stehen.
  Kraftwerke liefern Strom und verbrennen Kohle; bei Strommangel läuft alles halb so schnell.
- **Geld aus Dörfern** (abhängig von Einwohnern, Zufriedenheit und Gebäuden):
  - *Steuern* aus Stammdörfern (Steuersatz oben einstellbar)
  - *Besatzungsabgabe* aus eroberten Dörfern (Garnison hält sie ruhig, sonst Aufstand)
  - *Schutzgebühr* von fremden Dörfern, solange deine Truppen dort überlegen sind
  - *Plünderung* – sofort viel Geld, aber Einwohner und Zufriedenheit brechen ein
  - Dorfausbau: Markt, Wohnblock, Klinik · Gebäude *Verwaltung*: +25 % in der Provinz
- **Eroberung**: Alle Truppen und Gebäude des Besitzers in der Provinz vernichten.
  Danach kann ein Bauhof errichtet werden.
- **Forschung** – im *Forschungszentrum*, gilt für das ganze Reich: Fördertechnik, Turbinen, Steuerreform,
  Funkmesstechnik, Munition, Zusatzpanzerung, Stahlbeton sowie Freischaltung von Luftfahrt, Jagdfliegern und
  Neubaufahrzeug.
  Die KI-Mächte forschen ebenfalls.
- **Luftwaffe** – *Flugfeld* (nach Forschung „Luftfahrt“) baut *Sturzkampfbomber* (Ju 87 „Stuka“, wirft Bomben mit
  Flächenwirkung) und *Jagdflugzeuge* (Bf 109). Flugzeuge fliegen über jedes Gelände, können aber keine Provinz
  erobern. Treffen können sie nur Panzerbüchsen-Trupps (schwach), Panzerspähwagen (MG),
  die *Flakstellung* und andere Flugzeuge – Panzer, Geschütztürme und Artillerie nicht.
- **Marine** – Provinzen mit Meerzugang (⚓) haben auf der Detailkarte Meer an der echten Küstenseite.
  Die *Werft* muss direkt am Meer stehen und baut *Schnellboot*, *Zerstörer* und *Schweren Kreuzer*
  (die beiden großen nach Forschung „Marinetechnik“). Schiffe fahren nur auf dem Meer, beschießen Küsten,
  Basen und – je nach Waffe – Flugzeuge, erobern aber keine Provinz. Verlegen lassen sie sich nur zwischen
  Provinzen mit Meerzugang. Eine eigene Werft halbiert die Dauer von Seeüberfahrten aus dieser Provinz.
- **Diplomatie** (Knopf oben rechts) – jede KI-Macht hat eine *Haltung* zu dir. Geschenke verbessern sie,
  Angriffe und Eroberungen verschlechtern sie, und wer zu mächtig wird, ist unbeliebt.
  *Waffenstillstand*: keine Angriffe mehr (schwächere Mächte sind eher bereit).
  *Bündnis* (nach erprobtem Waffenstillstand): gemeinsame Sicht und +10 % Handelseinnahmen.
  Fällt die Haltung zu tief, kündigt die KI den Vertrag; ein eigener Angriff oder eine Kriegserklärung bricht ihn sofort
  und kostet Vertrauen bei allen. Sieg: alle verbliebenen Mächte besiegt oder verbündet.
- **Ton und Musik** – Geräusche für Waffen, Explosionen, Bauen, Funkbestätigung und Meldungen; räumlich
  (leiser in der Ferne, links/rechts nach Lage, nur Sichtbares). Die Musik entsteht live im Browser und wird im Kampf
  treibender. Lautstärke über „Ton“ oben rechts. Ton startet nach dem ersten Klick (Browser-Regel).
- **Gegner**: Westbund, Nordpakt, Ostunion, Südallianz (KI) und unabhängige Provinzen mit Miliz.
  Die Miliz bleibt friedlich, bis man sie angreift oder ein Dorf plündert.

### Steuerung (Detailkarte)

| Aktion | Eingabe |
|---|---|
| Einheiten wählen | Linksklick / Rahmen ziehen, Shift = hinzufügen, Doppelklick = alle dieses Typs |
| Bewegen / Angreifen | Rechtsklick |
| Angriffsbewegung | A, dann Ziel anklicken |
| Stopp | S |
| Alle eigenen Einheiten | Strg+A |
| Kontrollgruppe festlegen / hinzufügen | Strg+1…9 (oder Alt+1…9) / Umschalt+1…9 |
| Kontrollgruppe wählen | 1…9, zweimal schnell = Kamera springt hin |
| Reparieren | R, dann eigenes Gebäude anklicken (kostet Geld, nochmal klicken = stoppen) |
| Sammelpunkt | Kaserne/Panzerfabrik wählen, Rechtsklick auf die Karte |
| Kamera | Pfeiltasten, Bildschirmrand, mittlere Maustaste, Minikarte, Mausrad = Zoom |
| Zum Bauhof / zur Europakarte | H / M |
| Pause | P |
| Bau abbrechen / aus Warteschlange nehmen | Rechtsklick auf den Knopf |

## Ordnerstruktur

```
assets/              ← GRAFIKEN (separat austauschbar, wird unverändert ausgeliefert)
  manifest.json      Zuordnung Grafik-Schlüssel → Datei
  graphics/
    terrain/         Boden-Rauten 64×32, Vorkommen, Bäume und Felsen
    buildings/       Gebäude (Breite = Größe × 64 px)
    units/           Einheiten mit 8 Blickrichtungen nebeneinander
    village/         Dorf (3×3 Kacheln)
    icons/           Symbole für Rohstoffe usw.
    effects/         Explosion …
  audio/             Geräusche (WAV/MP3/OGG), ebenfalls über manifest.json austauschbar
data/                ← SPIELWERTE (ohne Programmierkenntnisse anpassbar)
  units.json         Einheiten: Kosten, Leben, Reichweite, Schaden, Waffenwirkung
  buildings.json     Gebäude: Kosten, Strom, Ertrag, Voraussetzungen
  economy.json       Steuern, Abgaben, Plünderung, Zufriedenheit, KI-Stärke, Diplomatie-Regeln
  research.json      Forschungsprojekte: Kosten, Dauer, Voraussetzungen
  factions.json      Mächte und Farben
  map/provinces.json Provinzen, Startbesitzer, Dörfer, Vorkommen, Seewege
  map/europe.json    (automatisch erzeugt – nicht bearbeiten; enthält auch Küstenanteil und -richtung je Provinz)
src/
  sim/               Spiellogik ohne Grafik (Zustand, Befehle, Simulation, KI, Wegfindung)
  render/            Strategiekarte und Detailkarte zeichnen
  ui/                Seitenleisten und Bedienelemente
tools/               Hilfsskripte (Karte erzeugen, Platzhaltergrafiken)
tests/               Simulationstests ohne Browser (npx tsx tests/conquest.ts)
```

### Touch-Bedienung (Smartphone, Tablet)
Das Spiel erkennt Touch-Geräte selbst (grober Zeiger oder erster Fingerdruck) und schaltet dann auf Touch-Bedienung. Am besten im Querformat; im Hochformat erscheint ein Hinweis.

| Geste | Wirkung |
|---|---|
| Antippen | Einheit / Gebäude / Dorf wählen; mit gewählten Einheiten: Boden = Bewegen, Gegner = Angreifen |
| Doppeltippen / langes Drücken | alle sichtbaren Einheiten desselben Typs wählen (Europakarte: Detailkarte öffnen) |
| Ein Finger ziehen | Karte verschieben (bei aktivem „Rahmen“: Auswahlrahmen aufziehen) |
| Zwei Finger | zoomen und verschieben |

Die Werkzeugleiste über der Befehlsleiste bietet **Mehrfach** (weitere Einheiten antippen = hinzufügen/abwählen), **Rahmen**, **Alle**, **Abwählen**, **Sammelpunkt** (bei gewählter Fabrik) und **Karte**. Beim Bauen setzt das Antippen nur den Geisterumriss, **Hier bauen** bestätigt. Auf kleinen Bildschirmen (Höhe unter 560 px) ist die Seitenleiste ein ausfahrbares Pult (Knopf **Pult**) und die obere Leiste zeigt die Rohstoffe kompakt. Code: `src/ui/touch.ts` (Gesten), `src/ui/touchbar.ts` (Leiste), Anpassungen in `province.ts` / `strategic.ts`; Test mit Playwright-Touch-Emulation, nicht auf echten Geräten.

### Gerenderte Grafiken (Blender)

Boden, Gebäude, Dorf, Bäume, Felsen, Rohstoffvorkommen und alle Einheiten werden in Blender gerendert
(fotorealistische Materialien mit Kantenabrieb, Staub, Schlamm; physikalischer Himmel; Licht von links oben).
Die Skripte liegen in `tools/blender/`:

| Skript | erzeugt |
|---|---|
| `eflib.py` | gemeinsame Bibliothek: Kamera passend zum Spielraster (1 Kachel = 5,6 m), Licht, Materialien, Bauformen |
| `boden.py` | nahtlose Bodentexturen (Draufsicht, je 4×4 Kacheln): Gras, Waldboden, Sand, Fels, Wasser, Erde, Acker, Saat, Weizen |
| `gebaeude1940.py` | alle Gebäude im Stil um 1940 (Backstein, Fachwerk, Grundstücke), inkl. Fahnen- und Schornsteinpositionen |
| `grundstuecke.py` | Dorfgrundstücke (6 Häuser, 3 Höfe, 2 Scheunen, 2 Gärten, Gasthaus, Kirche, Gemeindehaus mit Fahnenmast, Wasser- und Windmühle) in vier Ausrichtungen zur Straße |
| `leute.py` | Dorfbewohner (Bauer, Bäuerin) und Kuh, 8 Richtungen mit Schritt- bzw. Grasbildern |
| `einheiten1940.py` | Fahrzeuge (Wanne und Turm getrennt, 16 Richtungen), Infanterie (8 Richtungen, Laufbilder), Flugzeuge, Schiffe |
| `objekte.py` | Bäume, Felsen, Rohstoffvorkommen |
| `panzer4.py` | Panzer IV (Vorschaubild mit Gras und Fahrspuren, Spritesheets) |
| `install.py` | setzt die Einzelbilder zu Bildstreifen zusammen und trägt sie ins Manifest ein |

Bewegliche Teile (`'anim'` in den Bau-Funktionen) werden getrennt gerendert: Das Grundbild enthält sie nicht, danach
entsteht je Teil eine Bildfolge, in der das übrige Modell als Holdout die Verdeckung übernimmt und der Schattenfänger
nur den Schatten des Teils aufnimmt. Im Manifest heißen sie `<grafik>.anim0` mit `frames` und `fps`.

```bash
python3 -m venv blender-env && blender-env/bin/pip install bpy      # Blender als Python-Modul
blender-env/bin/python tools/blender/gebaeude.py /tmp/geb            # rendern (SAMPLES=… für Qualität)
python3 tools/blender/install.py gebaeude /tmp/geb                   # ins Spiel übernehmen
```

Gerenderte Grafiken sind doppelt so hoch aufgelöst wie ein Spielpixel (`"scale": 0.5` im Manifest) und tragen
`"photo": true`; `npm run placeholders` überschreibt sie nicht. Weitere Felder: `tiles` (Bodentextur über n×n Kacheln),
`tint` (Stärke der Teamfarbe), `flag` (Mastspitze für die Teamfahne), `smoke` (Schornsteine).

### Grafiken austauschen

1. Neue Datei (PNG, SVG oder WebP) in den passenden Ordner unter `assets/graphics/` legen.
2. Entweder die alte Datei gleichen Namens ersetzen **oder** in `assets/manifest.json` den Pfad ändern,
   z. B. `"unit.kampfpanzer": "graphics/units/leopard.png"`.
3. Seite neu laden – fertig. Am Programmcode ändert sich nichts.

Maße und Regeln für die isometrische Ansicht:

| Art | Format |
|---|---|
| Bodenkachel | Raute 64×32 px (Bildgröße 64×32, außerhalb transparent) |
| Gebäude | Breite = Größe × 64 px (Bauhof 192), Höhe frei; die untere Spitze der Grundfläche liegt unten in der Bildmitte |
| Fahrzeuge, Schiffe, Flugzeuge | 16 Einzelbilder nebeneinander, beginnend mit Südost (rechts unten), dann im Uhrzeigersinn |
| Panzer-Türme | eigenes Bild mit Schlüssel `….turm` (z. B. `unit.kampfpanzer.turm`), gleiche Maße und Ankerpunkt wie die Wanne; dreht sich zum Ziel |
| Infanterie | 8 Richtungen nebeneinander × 3 Reihen untereinander (Stehen, Schritt, Schritt) für die Laufanimation |
| Geschütz- und Flakturm | 8 Richtungen nebeneinander |
| Bäume, Felsen | stehen mit ihrem Ankerpunkt auf der Kachelmitte (`object.baum1`–`4`, `object.fels`, `object.fels2`) |
| Kleinteile | `decor.gras`, `decor.trockengras`, `decor.blumen`, `decor.steine`, `decor.busch`, `decor.farn` – werden flach in den Boden gezeichnet |

Die Bodentexturen werden nicht als Rauten aneinandergesetzt, sondern als Farbvorlage abgetastet und weich gemischt –
eigene Texturen sollten daher eher gleichmäßig sein (ohne Rand oder Kante innerhalb der Raute).

Unter `sprites` im Manifest stehen pro Grafik `anchor` (der Bodenpunkt im Einzelbild, in Pixeln)
`frames` (Anzahl der Richtungen) und `rows` (Animationsbilder). Wer eigene Grafiken mit anderen Maßen nutzt, passt dort den Ankerpunkt an.
Einheiten und Gebäude werden automatisch leicht in Teamfarbe eingefärbt. Fehlt eine Grafik,
zeichnet das Spiel einen Platzhalter. `npm run placeholders` legt fehlende Platzhalter neu an,
ohne eigene Grafiken zu überschreiben. Die Platzhalter werden aus einfachen 3D-Formen berechnet
(Gebäude: `tools/make-placeholders.mjs`, Einheiten: `tools/unit-models.mjs`).

Live im Spiel animiert (nicht im Bild enthalten): Luftschrauben, fallende Bomben, Mündungsfeuer,
Staub hinter Fahrzeugen, Rauch bei schweren Schäden, Funken bei Explosionen und ausgebrannte Wracks.

### Geräusche und Musik austauschen

Im Manifest stehen unter `audio` die Geräusche (z. B. `"sfx.kanone": "audio/kanone.wav"`). Eigene Aufnahmen
(WAV, MP3 oder OGG) einfach unter gleichem Namen ablegen oder den Pfad ändern.
Für eigene Musik die Stücke nach `assets/audio/` legen und unter `music` eintragen, z. B.
`"music": ["audio/marsch.mp3", "audio/thema.ogg"]` – sie laufen dann nacheinander statt der erzeugten Musik.
`npm run sounds` legt fehlende Geräusche neu an, `npm run sounds -- --force` erzeugt alle neu und überschreibt eigene Dateien
(synthetisch berechnet, 44,1 kHz mit Hall und Echo, siehe `tools/make-sounds.mjs`). Mehrere Varianten desselben Geräuschs heißen
`<Schlüssel>.v2`, `.v3` – das Spiel wählt zufällig eine aus. Entfernte Geräusche klingen dumpfer, ein Begrenzer verhindert Übersteuern.

Die Musik (d-Moll: Streicherteppich, Celli, Glockentöne, fernes Paukengrollen, Hallraum) entsteht live in `src/audio.ts`;
bei Kampfgeschehen kommen Pauken, Marschtrommel, Blech und ein Cello-Ostinato dazu.

**Klangkulisse (Detailkarte):** `src/ambience.ts` mischt abhängig vom Bildausschnitt Wind (mit Böen), Laubrauschen (viel Wald im Bild),
Plätschern und Wellen (Wasser im Bild), Vogelstimmen (Amsel, Meise, Fink, Krähe, Kuckuck), Muhen, Wiehern und Schnauben der Weidetiere
(von deren Position aus), Hund, Hahn und Kirchenglocke im Dorf, das Klappern der Wassermühle sowie Panzer- und Flugzeugmotoren (bei
fahrenden Fahrzeugen im Bild). Sobald gekämpft wird, verstummen Vögel, Tiere und Dorf und kehren danach langsam zurück.
Eigener Regler „Umgebung“ im Ton-Menü. Die Weiden sind mit Kühen und Pferden besetzt (Pferd: `tools/blender/leute.py`).

| Schlüssel | Wann |
|---|---|
| sfx.gewehr, sfx.mg | Karabiner 98k, MG 34 (auch Bordkanone) |
| sfx.pak | Panzerbüchse |
| sfx.kanone | Panzerkanone, Küstenbatterie |
| sfx.artillerie | Sturmpanzer I (15-cm-Haubitze) |
| sfx.schiff | Schiffsgeschütze |
| sfx.flak | Flak |
| sfx.stuka | Abwurf des Sturzkampfbombers (Sirene), Einschlag folgt als sfx.explosion |
| sfx.granate | Granatwerfer (derzeit keine Einheit) |
| sfx.explosion | Explosion / zerstörtes Fahrzeug oder Gebäude |
| sfx.knacken, sfx.schutt | Bäume, Masten, Zäune brechen / Pflaster bricht auf |
| sfx.bauen | Gebäude platziert |
| ui.einheit | Einheit fertig ausgebildet (Funk) |
| ui.bestaetigung | Befehl an Einheiten (Funk) |
| ui.alarm (Luftschutzsirene), ui.warnung, ui.erfolg, ui.forschung | Meldungen |
| ui.klick | Knopfdruck |
| amb.vogel, amb.vogel.meise, amb.vogel.fink, amb.kraehe, amb.kuckuck | Vogelstimmen |
| amb.kuh, amb.pferd, amb.schnauben | Weidetiere |
| amb.hund, amb.hahn, amb.glocke | Dorf |
| amb.muehle, amb.panzer, amb.flug | Schleifen: Wassermühle, Panzermotor mit Ketten, Flugzeugmotor |

### Karte ändern

Provinzen, Dörfer und Seewege stehen in `data/map/provinces.json`. Nach Änderungen
`npm run map` ausführen – das erzeugt die Grenzen in `data/map/europe.json` neu
(Grenzen aus den Provinz-Mittelpunkten, Küstenlinien aus Natural-Earth-Daten).

## Technik

- TypeScript + Vite, Zeichnen mit Canvas 2D, keine Spiel-Engine nötig.
- Die Simulation (`src/sim`) ist vom Zeichnen getrennt, läuft in festen Schritten (20/s) und
  verändert den Zustand nur über **Befehle**. Damit ist sie für einen späteren **Mehrspielermodus**
  vorbereitet: Alle Rechner führen dieselben Befehle aus (Lockstep) oder ein Server rechnet.
- Spielstände werden im Browser gespeichert (Speichern/Laden oben rechts).

## Ausbaustufen

- [x] Etappe 1–5: Karte, Wirtschaft, Basisbau, Einheiten & Kampf, Eroberung
- [x] Etappe 6 (Grundversion): KI-Gegner mit Verstärkung und Angriffswellen
- [x] Isometrische Ansicht, Nebel des Krieges, Aufklärung
- [x] Reparieren, Sammelpunkte, Kontrollgruppen
- [x] Forschung, Luftwaffe (Stuka, Jagdflugzeug, Flak), Diplomatie
- [x] Seeeinheiten (Werft, drei Schiffstypen, Küsten nach echter Geografie)
- [x] Ton und Musik
- [ ] Mehrspieler (Lockstep über WebSocket)
