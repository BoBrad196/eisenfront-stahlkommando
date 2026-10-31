#!/bin/sh
# Funkmeldungen auf Deutsch: synthetische Stimme (espeak-ng, Sprache de) mit Funkfilter.
# Aufruf: sh tools/make-voices.sh   (braucht espeak-ng und ffmpeg; schreibt assets/audio/funk_*.wav)
set -e
OUT="$(dirname "$0")/../assets/audio"
mk() { # Schlüssel-Name, Text
  for v in 1 2; do
    if [ $v = 1 ]; then P=38; S=150; else P=52; S=138; fi
    espeak-ng -v de -p $P -s $S -w /tmp/_v.wav "$2"
    ffmpeg -loglevel error -y -i /tmp/_v.wav -af "highpass=f=320,lowpass=f=3300,acompressor=ratio=6:attack=5:release=60,volume=3,loudnorm=I=-16:TP=-1.5" -ar 22050 -ac 1 "$OUT/funk_$1$( [ $v = 2 ] && echo _2).wav"
  done
}
mk feuer "Feuer frei"
mk vorwaerts "Vorwärts"
mk deckung "In Deckung"
mk halt "Halt"
mk sanitaeter "Sanitäter"
mk munition "Munition fehlt"
mk verstaerkung "Brauchen Verstärkung"
mk feind "Feind gesichtet"
mk mehrere "Mehrere Feindkontakte"
mk ziel_gesichert "Ziel gesichert"
mk ziel_verloren "Ziel verloren"
mk auftrag_erfuellt "Auftrag erfüllt"
mk auftrag_gescheitert "Auftrag gescheitert"
mk verstanden "Verstanden"
mk wiederholen "Wiederholen"
mk rueckzug "Rückzug"
mk nachladen "Nachladen"
mk panzer "Panzer voraus"
echo "fertig"
