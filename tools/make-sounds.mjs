// Erzeugt die Geräusche (WAV, 44,1 kHz, mono) in assets/audio und trägt sie in assets/manifest.json ein.
// Alles wird synthetisch berechnet (Rauschen, Töne, Filter, Hall). Echte Aufnahmen lassen sich jederzeit
// gegen die Dateien tauschen. Vorhandene Dateien werden NICHT überschrieben (außer mit --force).
// Mehrere Varianten desselben Geräuschs heißen "<Schlüssel>.v2", ".v3" … – das Spiel wählt zufällig.
// Aufruf: npm run sounds   bzw.   npm run sounds -- --force
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../assets/', import.meta.url);
const force = process.argv.includes('--force');
const RATE = 44100;

// ---------- Synthese-Bausteine ----------
let seed = 99;
const setSeed = (n) => { seed = (n * 104729 + 12345) % 2147483647; for (let i = 0; i < 30; i++) rnd(); };
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const buf = (sec) => new Float32Array(Math.ceil(sec * RATE));
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d)); // Anstieg a, Abklingen d (s)
function lowpass(x, cutoff) {
  const k = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
  let y = 0;
  return x.map((v) => (y += k * (v - y)));
}
function highpass(x, cutoff) {
  const lp = lowpass(x, cutoff);
  return x.map((v, i) => v - lp[i]);
}
const bandpass = (x, lo, hi) => lowpass(highpass(x, lo), hi);
function noise(sec) { return buf(sec).map(() => rnd()); }
function mix(target, src, offset = 0, gain = 1) {
  const o = Math.floor(offset * RATE);
  for (let i = 0; i < src.length && i + o < target.length; i++) target[i + o] += src[i] * gain;
  return target;
}
function shape(x, fn) { return x.map((v, i) => v * fn(i / RATE)); }
function tone(sec, freq, type = 'sine') {
  let ph = 0;
  return buf(sec).map((_, i) => {
    const f = typeof freq === 'function' ? freq(i / RATE) : freq;
    ph += (2 * Math.PI * f) / RATE;
    if (type === 'square') return Math.sign(Math.sin(ph)) * 0.6;
    if (type === 'saw') return ((ph / Math.PI) % 2) - 1;
    return Math.sin(ph);
  });
}
function normalize(x, peak = 0.85) {
  const m = x.reduce((a, v) => Math.max(a, Math.abs(v)), 1e-6);
  return x.map((v) => (v / m) * peak);
}
/** Weiche Begrenzung: Spitzen runden statt hart abschneiden */
const soft = (x, drive = 1.4) => x.map((v) => Math.tanh(v * drive) / Math.tanh(drive));
/** Schroeder-Hall: 4 gedämpfte Kammfilter + 2 Allpässe. room = Raumgröße (0.6 Halle klein … 1.4 weite Landschaft) */
function reverb(x, wet = 0.3, room = 1, tail = 0.8, damp = 0.35) {
  const out = new Float32Array(x.length + Math.ceil(tail * RATE));
  out.set(x);
  const delays = [0.0297, 0.0371, 0.0411, 0.0437].map((d) => Math.floor(d * room * RATE));
  const fb = 0.8 + Math.min(0.1, tail * 0.06);
  const acc = new Float32Array(out.length);
  for (const d of delays) {
    const line = new Float32Array(d);
    let lp = 0, idx = 0;
    for (let i = 0; i < out.length; i++) {
      const inp = i < x.length ? x[i] : 0;
      const y = line[idx];
      lp = y * (1 - damp) + lp * damp;
      line[idx] = inp + lp * fb;
      idx = (idx + 1) % d;
      acc[i] += y * 0.25;
    }
  }
  for (const [d, g] of [[Math.floor(0.005 * RATE), 0.7], [Math.floor(0.0017 * RATE), 0.7]]) {
    const line = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < acc.length; i++) {
      const bufd = line[idx];
      const v = acc[i] + bufd * g;
      line[idx] = v;
      acc[i] = bufd - v * g;
      idx = (idx + 1) % d;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] += acc[i] * wet * 2;
  return out;
}
/** Fernes Echo (Hall der Landschaft): gedämpfte, verzögerte Kopien */
function echoes(x, list) {
  const out = new Float32Array(x.length + Math.ceil(0.9 * RATE));
  out.set(x);
  for (const [delay, gain, cut] of list) mix(out, lowpass(x, cut), delay, gain);
  return out;
}
function wav(samples) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples.length * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
  return data;
}
/** Anfang und Ende ausblenden, damit nichts knackt; Stille am Ende abschneiden */
function trim(x, fadeOut = 0.04) {
  let end = x.length;
  while (end > 0 && Math.abs(x[end - 1]) < 0.002) end--;
  const y = x.slice(0, Math.max(end, 1));
  const f = Math.min(Math.floor(fadeOut * RATE), y.length);
  for (let i = 0; i < f; i++) y[y.length - 1 - i] *= i / f;
  const a = Math.min(24, y.length);
  for (let i = 0; i < a; i++) y[i] *= i / a;
  return y;
}

// ---------- Schusswaffen ----------
/** Ein Schuss: harter Knall (Mündungsknall), Körper, tiefer Schlag. punch = Tiefe, bright = Schärfe */
function bang({ len = 0.5, bright = 3000, body = 1400, punch = 130, punchGain = 0.4, decay = 0.05, crackGain = 1 } = {}) {
  const b = buf(len);
  mix(b, shape(highpass(noise(len), bright), (t) => env(t, 0.0004, 0.005 + decay * 0.1)), 0, crackGain);
  mix(b, shape(bandpass(noise(len), 140, body), (t) => env(t, 0.0008, decay)), 0, 0.9);
  mix(b, shape(tone(len, (x) => punch * Math.exp(-x * 22) + 38), (t) => env(t, 0.0008, decay * 1.2)), 0, punchGain);
  return b;
}
const landscape = (x, strong = 1) => echoes(reverb(x, 0.22 * strong, 1.25, 0.7), [[0.11, 0.2 * strong, 1800], [0.27, 0.12 * strong, 1100], [0.5, 0.07 * strong, 700]]);

// Karabiner 98k: scharfer, trockener Knall
const gewehr = () => landscape(bang({ len: 0.35, bright: 2600, body: 2400, punch: 110, punchGain: 0.25, decay: 0.035 }), 0.8);
// MG 34: schnelle Folge mit leichter Unregelmäßigkeit (ca. 850 Schuss/min)
const mg = () => {
  const b = buf(0.7);
  for (let i = 0; i < 7; i++) mix(b, bang({ len: 0.12, bright: 2200, body: 1800, punch: 120, punchGain: 0.28, decay: 0.022 }), i * 0.07 + Math.abs(rnd()) * 0.006, 1 - i * 0.04);
  return landscape(b, 0.8);
};
// Panzerabwehrbüchse / Pak: kurzer, sehr scharfer Knall mit metallischem Nachklang
const pak = () => {
  const b = bang({ len: 0.5, bright: 2000, body: 2800, punch: 160, punchGain: 0.5, decay: 0.05, crackGain: 1.2 });
  mix(b, shape(tone(0.5, 2300), (t) => env(t, 0.001, 0.05)), 0.004, 0.06);
  return landscape(b, 1);
};
// Panzerkanone (7,5 cm): dumpfer Schlag, Rohr „klingt“ nach
const kanone = () => {
  const b = bang({ len: 1.1, bright: 1300, body: 1000, punch: 90, punchGain: 0.9, decay: 0.16, crackGain: 0.8 });
  mix(b, shape(lowpass(noise(1.0), 500), (t) => env(t, 0.02, 0.28)), 0.02, 0.35);
  mix(b, shape(tone(0.8, 410), (t) => env(t, 0.002, 0.18)), 0.01, 0.05);
  return landscape(soft(b, 1.2), 1.3);
};
// Feldhaubitze: sehr tiefer Abschuss, rollender Nachhall
const artillerie = () => {
  const b = bang({ len: 1.6, bright: 900, body: 600, punch: 70, punchGain: 1.1, decay: 0.28, crackGain: 0.6 });
  mix(b, shape(lowpass(noise(1.4), 260), (t) => env(t, 0.06, 0.4)), 0.03, 0.6);
  return landscape(soft(b, 1.3), 1.7);
};
// Granatwerfer: „Plopp“ des Abschusses, dann das Pfeifen der fliegenden Granate
const granate = () => {
  const b = buf(0.9);
  mix(b, shape(tone(0.4, (x) => 190 * Math.exp(-x * 9) + 60), (t) => env(t, 0.002, 0.07)), 0, 0.9);
  mix(b, shape(lowpass(noise(0.3), 700), (t) => env(t, 0.002, 0.05)), 0, 0.5);
  mix(b, shape(tone(0.5, (x) => 1900 - x * 1100), (t) => 0.05 * Math.min(1, t * 6) * Math.exp(-t * 2.5)), 0.12, 1);
  return landscape(b, 1);
};
// Schiffsgeschütz: wuchtiger Doppelschlag über Wasser, langer Hall
const schiff = () => {
  const b = bang({ len: 2.0, bright: 800, body: 500, punch: 65, punchGain: 1.2, decay: 0.34, crackGain: 0.55 });
  mix(b, shape(lowpass(noise(1.6), 220), (t) => env(t, 0.08, 0.55)), 0.05, 0.7);
  return soft(echoes(reverb(b, 0.35, 1.5, 1.2), [[0.22, 0.3, 900], [0.48, 0.18, 600], [0.8, 0.1, 400]]), 1.2);
};
// Flak 38: schnell aufeinander folgende scharfe Schüsse mit Splitterwolke
const flak = () => {
  const b = buf(0.8);
  for (let i = 0; i < 3; i++) mix(b, bang({ len: 0.3, bright: 1800, body: 2000, punch: 100, punchGain: 0.45, decay: 0.04 }), i * 0.13 + Math.abs(rnd()) * 0.01, 1 - i * 0.12);
  mix(b, shape(highpass(noise(0.35), 3500), (t) => env(t, 0.01, 0.07)), 0.34, 0.12);
  return landscape(b, 1.1);
};
// Stuka „Jericho-Trompete“: heulende Sirene beim Sturzflug (Abwurf, Einschlag folgt separat)
const stuka = () => {
  const len = 1.1;
  const f = (t) => 520 + 380 * Math.min(1, t / 0.9) + 14 * Math.sin(t * 28);
  const s = tone(len, f, 'saw');
  const s2 = tone(len, (t) => f(t) * 1.505, 'saw');
  const a = shape(lowpass(s.map((v, i) => v * 0.6 + s2[i] * 0.3), 2600), (t) => Math.min(1, t * 6) * (0.55 + 0.45 * t / len) * Math.exp(-Math.max(0, t - 0.85) * 9));
  mix(a, shape(bandpass(noise(len), 400, 3000), (t) => 0.25 * Math.min(1, t * 5) * Math.exp(-Math.max(0, t - 0.85) * 9)), 0, 1);
  return reverb(a, 0.15, 1.2, 0.5);
};

// ---------- Einschläge, Zerstörung, Bau ----------
const explosion = () => {
  const b = bang({ len: 2.2, bright: 700, body: 420, punch: 75, punchGain: 1.2, decay: 0.3, crackGain: 0.7 });
  mix(b, shape(highpass(noise(0.6), 1800), (t) => env(t, 0.001, 0.08)), 0, 0.45);
  // Trümmer, die danach herabregnen
  for (let i = 0; i < 14; i++) mix(b, shape(bandpass(noise(0.05), 700, 4500), (t) => env(t, 0.001, 0.012)), 0.3 + Math.abs(rnd()) * 1.2, 0.08 + Math.abs(rnd()) * 0.12);
  mix(b, shape(lowpass(noise(1.8), 240), (t) => env(t, 0.1, 0.55)), 0.05, 0.6);
  return soft(landscape(b, 1.5), 1.2);
};
// Holz knackt und bricht (Baum, Mast, Zaun): kurzer Knall, dann splitterndes Rauschen
const knacken = () => {
  const b = buf(0.8);
  mix(b, shape(highpass(noise(0.05), 900), (t) => env(t, 0.001, 0.012)), 0, 1);
  mix(b, shape(highpass(noise(0.05), 1400), (t) => env(t, 0.001, 0.012)), 0.09, 0.8);
  mix(b, shape(lowpass(noise(0.6), 700), (t) => env(t, 0.03, 0.18)), 0.1, 0.55);
  for (let i = 0; i < 7; i++) mix(b, shape(highpass(noise(0.03), 1800), (t) => env(t, 0.001, 0.006)), 0.18 + i * 0.06 + Math.abs(rnd()) * 0.03, 0.35);
  mix(b, shape(tone(0.3, (x) => 80 - x * 40), (t) => env(t, 0.003, 0.08)), 0.28, 0.5);
  return reverb(b, 0.12, 0.8, 0.4);
};
// Pflaster bricht auf: Steine knirschen und poltern
const schutt = () => {
  const b = buf(1.0);
  mix(b, shape(tone(0.4, (x) => 90 - x * 40), (t) => env(t, 0.002, 0.09)), 0, 0.7);
  mix(b, shape(lowpass(noise(0.4), 600), (t) => env(t, 0.002, 0.08)), 0, 0.5);
  for (let i = 0; i < 16; i++) mix(b, shape(bandpass(noise(0.05), 900, 4500), (t) => env(t, 0.001, 0.012)), 0.03 + i * 0.045 + Math.abs(rnd()) * 0.04, 0.3 + Math.abs(rnd()) * 0.4);
  mix(b, shape(lowpass(noise(0.6), 1500), (t) => env(t, 0.02, 0.16)), 0.05, 0.3);
  return reverb(b, 0.1, 0.8, 0.4);
};
// Bauarbeiten: Hammerschläge auf Holz und Eisen, ein Sägezug
const bauen = () => {
  const hit = (f, g) => { const s = buf(0.4); for (const r of [1, 2.76, 5.4]) mix(s, shape(tone(0.4, f * r), (t) => env(t, 0.0008, 0.07 / r)), 0, g / r); mix(s, shape(highpass(noise(0.05), 1500), (t) => env(t, 0.0005, 0.006)), 0, 0.6 * g); return s; };
  const b = buf(1.0);
  mix(b, hit(260, 1), 0, 1); mix(b, hit(190, 0.9), 0.22, 0.9); mix(b, hit(240, 0.8), 0.46, 0.9);
  mix(b, shape(lowpass(noise(0.2), 400), (t) => env(t, 0.002, 0.05)), 0, 0.8);
  mix(b, shape(bandpass(noise(0.3), 1200, 5000), (t) => Math.sin(Math.min(1, t * 3.3) * Math.PI) * 0.25), 0.6, 0.5);
  return reverb(b, 0.12, 0.9, 0.4);
};

// ---------- Oberfläche (Funk und Fernschreiber) ----------
const crackle = (sec, g = 0.25) => shape(bandpass(noise(sec), 700, 3800), (t) => g * (0.6 + 0.4 * Math.sin(t * 700)));
/** Funkgerät: Knacken beim Tastendruck, kurzer Pfeifton */
const funk = (freq, sec = 0.1) => {
  const b = buf(sec + 0.2);
  mix(b, shape(crackle(0.05, 0.9), (t) => env(t, 0.001, 0.015)), 0, 0.6);
  mix(b, shape(tone(sec, freq), (t) => env(t, 0.004, sec * 0.7)), 0.03, 0.28);
  mix(b, shape(crackle(sec + 0.1, 0.6), (t) => env(t, 0.003, 0.08)), 0.02, 0.2);
  mix(b, shape(crackle(0.05, 0.9), (t) => env(t, 0.001, 0.02)), sec + 0.05, 0.4);
  return b;
};
const einheit = () => { const b = buf(0.5); mix(b, funk(1250, 0.07), 0, 1); mix(b, funk(1650, 0.09), 0.2, 0.9); return b; };
const klick = () => { const b = shape(highpass(noise(0.05), 1200), (t) => env(t, 0.0005, 0.007)); mix(b, shape(tone(0.04, 900), (t) => env(t, 0.0005, 0.008)), 0, 0.4); return b; };
// Befehl bestätigt: Funkspruch-Knacken und zwei kurze Morsepunkte
const bestaetigung = () => { const b = buf(0.5); mix(b, funk(1100, 0.05), 0, 1); mix(b, shape(tone(0.045, 1500), (t) => env(t, 0.003, 0.03)), 0.22, 0.3); return b; };
// Alarm: Luftschutzsirene, auf- und abschwellend
const alarm = () => {
  const b = buf(1.8);
  const f = (t) => 520 + 300 * Math.sin((t / 1.8) * Math.PI * 2 - Math.PI / 2) * 0.5 + 150 * (t / 1.8);
  const s = lowpass(tone(1.8, f, 'saw'), 1800);
  mix(b, shape(s, (t) => Math.min(1, t * 8) * (0.5 + 0.5 * Math.sin((t / 1.8) * Math.PI)) * Math.exp(-Math.max(0, t - 1.4) * 6)), 0, 0.7);
  return reverb(b, 0.2, 1.2, 0.5);
};
// Erfolg: warme Glocken-Tonfolge (Dur-Dreiklang)
const bell = (f, sec, g) => { const b = buf(sec); for (const [r, a] of [[1, 1], [2.01, 0.4], [3.02, 0.2], [4.2, 0.1]]) mix(b, shape(tone(sec, f * r), (t) => env(t, 0.003, 0.35 / r)), 0, g * a); return b; };
const erfolg = () => { const b = buf(1.4); [392, 494, 587, 784].forEach((f, i) => mix(b, bell(f, 1.0, 0.5), i * 0.11, 1)); return reverb(b, 0.25, 1.1, 0.6); };
// Warnung: zwei tiefe Fernschreiber-Pieptöne
const warnung = () => { const b = buf(0.6); mix(b, shape(tone(0.18, 440, 'square'), (t) => env(t, 0.004, 0.09)), 0, 0.3); mix(b, shape(tone(0.18, 330, 'square'), (t) => env(t, 0.004, 0.09)), 0.22, 0.3); return lowpass(b, 2400); };
// Forschung abgeschlossen: Fernschreiber ratterte, dann Klingel
const forschung = () => {
  const b = buf(1.4);
  for (let i = 0; i < 14; i++) mix(b, shape(highpass(noise(0.02), 1500), (t) => env(t, 0.0005, 0.004)), 0.02 + i * 0.042 + Math.abs(rnd()) * 0.01, 0.35);
  mix(b, bell(1175, 0.8, 0.5), 0.62, 1);
  mix(b, bell(1175, 0.8, 0.4), 0.82, 1);
  return reverb(b, 0.18, 1, 0.5);
};


// ---------- Klangkulisse: Tiere, Dorf, Motoren ----------
/** Formantfilter (zustandsvariabler Bandpass) mit zeitabhängiger Mittenfrequenz – gibt Stimmen ihren Vokalklang */
function formant(x, freqFn, q = 5) {
  let lo = 0, bp = 0;
  return x.map((v, i) => {
    const f = 2 * Math.sin(Math.PI * Math.min(0.45, freqFn(i / RATE) / RATE));
    lo += f * bp;
    const hi = v - lo - bp / q;
    bp += f * hi;
    return bp;
  });
}
/** Nahtlose Schleife: das Ende wird in den Anfang übergeblendet, danach um die Überblendzeit gekürzt */
function loopfix(x, xf = 0.08) {
  const n = Math.floor(xf * RATE), len = x.length - n;
  const out = x.slice(0, len);
  for (let i = 0; i < n; i++) { const a = i / n; out[i] = x[i] * a + x[len + i] * (1 - a); }
  return out;
}
const swell = (t, dur) => Math.sin(Math.min(1, Math.max(0, t / dur)) * Math.PI);
/** Vogelton: gleitende Frequenz, weicher Einsatz, leichter Oberton */
function chirp(dur, f0, f1, { vib = 0, harm = 0.15, amp = 1 } = {}) {
  const f = (t) => f0 + (f1 - f0) * (t / dur) + (vib ? Math.sin(t * 2 * Math.PI * vib) * 40 : 0);
  const a = tone(dur, f), b = tone(dur, (t) => f(t) * 2);
  return shape(a.map((v, i) => v + b[i] * harm), (t) => amp * Math.pow(swell(t, dur), 0.7));
}
const phrase = (parts, total) => { const b = buf(total); for (const [t, x, g = 1] of parts) mix(b, x, t, g); return b; };

// Amsel: ruhiger, flötender Gesang
const amsel = () => {
  const parts = []; let t = 0;
  for (let i = 0; i < 6; i++) {
    const f0 = 1700 + Math.abs(rnd()) * 900, f1 = f0 + rnd() * 700, d = 0.14 + Math.abs(rnd()) * 0.2;
    parts.push([t, chirp(d, f0, f1, { vib: 18, harm: 0.2 }), 0.8]);
    t += d + 0.05 + Math.abs(rnd()) * 0.09;
  }
  return reverb(phrase(parts, t + 0.3), 0.18, 1.2, 0.7);
};
// Kohlmeise: „zi-zi-däh“
const meise = () => {
  const parts = []; let t = 0;
  for (let k = 0; k < 3; k++) {
    parts.push([t, chirp(0.06, 6500, 5600), 0.7], [t + 0.1, chirp(0.06, 6500, 5600), 0.7], [t + 0.22, chirp(0.11, 4300, 3700, { harm: 0.3 }), 0.9]);
    t += 0.5;
  }
  return reverb(phrase(parts, t + 0.2), 0.14, 1, 0.5);
};
// Fink: schneller, abfallender Triller mit Schlussschnörkel
const fink = () => {
  const parts = [];
  for (let i = 0; i < 14; i++) parts.push([i * 0.045, chirp(0.035, 5600 - i * 90, 4600 - i * 70), 0.55 + i * 0.01]);
  parts.push([0.7, chirp(0.12, 3000, 5200), 0.8], [0.84, chirp(0.1, 5200, 3600), 0.6]);
  return reverb(phrase(parts, 1.1), 0.14, 1, 0.5);
};
// Krähe: heiseres „kraah“, zwei- bis dreimal
const kraehe = () => {
  const b = buf(1.3);
  for (let i = 0; i < 3; i++) {
    const d = 0.28 + Math.abs(rnd()) * 0.08, f0 = 430 - i * 20;
    const src = tone(d, (t) => f0 - t * 120 + rnd() * 14, 'saw').map((v) => v + rnd() * 0.5);
    mix(b, shape(formant(src, (t) => 900 + t * 500, 3), (t) => swell(t, d) * 2.6), i * 0.4, 0.8);
  }
  return reverb(b, 0.22, 1.4, 0.9);
};
// Kuckuck: zwei absteigende Flötentöne, mehrfach
const kuckuck = () => {
  const parts = []; let t = 0;
  for (let k = 0; k < 4; k++) { parts.push([t, chirp(0.22, 790, 760, { harm: 0.1 })], [t + 0.3, chirp(0.28, 640, 610, { harm: 0.1 })]); t += 0.85; }
  return reverb(phrase(parts, t + 0.2), 0.3, 1.5, 1.0);
};
// Kuh: langes, tiefes „Muuh“ mit wandernder Mundhöhle
const kuhMuh = () => {
  const d = 1.5 + Math.abs(rnd()) * 0.4, f0 = 92 + rnd() * 10;
  const src = tone(d, (t) => f0 + 22 * Math.sin(Math.min(1, t / (d * 0.5)) * Math.PI / 2) - 12 * Math.max(0, t / d - 0.6) + Math.sin(t * 38) * 1.4, 'saw');
  const voice = formant(src.map((v, i) => v + rnd() * 0.12), (t) => 330 + 420 * Math.sin((t / d) * Math.PI) + 120 * (t / d), 3.5);
  const b = shape(voice, (t) => Math.min(1, t / 0.25) * Math.exp(-Math.max(0, t - d * 0.7) * 3.2) * 4);
  return reverb(lowpass(b, 1400), 0.24, 1.5, 0.9);
};
// Pferd: Wiehern, wechselnd hoch und tief
const wiehern = () => {
  const d = 1.4 + Math.abs(rnd()) * 0.3;
  const f = (t) => (t < 0.35 ? 520 + t * 1700 : t < d * 0.75 ? 1100 + 90 * Math.sin(t * 14) - (t - 0.35) * 180 : 700 - (t - d * 0.75) * 900) + rnd() * 12;
  const src = tone(d, f, 'saw').map((v) => v + rnd() * 0.25);
  const am = (t) => (t > 0.4 && t < d * 0.8 ? 0.65 + 0.35 * Math.sin(t * 2 * Math.PI * 13) : 1);
  const voice = formant(src, (t) => 1100 + 700 * Math.sin(t * 5), 3);
  return reverb(shape(voice, (t) => Math.min(1, t / 0.06) * am(t) * Math.exp(-Math.max(0, t - d * 0.8) * 5) * 3.4), 0.26, 1.6, 0.9);
};
// Pferd: Schnauben und Prusten
const schnauben = () => {
  const b = buf(0.9);
  const burst = (t0, len, g) => {
    mix(b, shape(lowpass(bandpass(noise(len), 250, 2800), 2800), (t) => env(t, 0.02, len / 3.5)), t0, g);
    mix(b, shape(lowpass(noise(len), 160), (t) => env(t, 0.05, len / 3) * (0.6 + 0.4 * Math.sign(Math.sin(t * 2 * Math.PI * 24)))), t0 + 0.05, g * 0.5);
  };
  burst(0, 0.38, 1); burst(0.42, 0.3, 0.7);
  return reverb(b, 0.18, 1.2, 0.5);
};
// Hahn: „Kikeriki“
const hahn = () => {
  const syl = [[0, 0.13, 520, 700], [0.17, 0.1, 650, 640], [0.3, 0.22, 760, 940], [0.58, 0.62, 900, 1180]];
  const b = buf(1.5);
  for (const [t0, d, f0, f1] of syl) {
    const last = t0 > 0.5;
    const src = tone(d, (t) => f0 + (f1 - f0) * (t / d) - (last ? Math.max(0, t / d - 0.5) * 900 : 0) + (last ? Math.sin(t * 50) * 28 : 0), 'saw');
    mix(b, shape(formant(src.map((v) => v + rnd() * 0.15), (t) => 1500 + 900 * Math.sin(t * 9), 4), (t) => Math.pow(swell(t, d), 0.5) * 3), t0, 0.85);
  }
  return reverb(b, 0.24, 1.5, 0.9);
};
// Hund: zwei bis drei Bellen
const hund = () => {
  const b = buf(1.2);
  const n = 2 + (Math.abs(rnd()) > 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const d = 0.17;
    const src = tone(d, (t) => 340 - t * 420 + rnd() * 8, 'saw').map((v) => v + rnd() * 0.45);
    mix(b, shape(formant(src, (t) => 750 + t * 3000, 2.6), (t) => env(t, 0.008, 0.07) * 3), i * 0.32, 0.9 - i * 0.1);
  }
  return reverb(b, 0.28, 1.6, 1.0);
};
// Kirchenglocke: ein einzelner Schlag, Obertöne klingen lange nach (die Töne wiederholt das Spiel)
const glocke = () => {
  const f = 262, b = buf(5.0);
  for (const [r, g, dk] of [[0.5, 0.7, 4.0], [1, 1, 3.4], [1.2, 0.6, 2.8], [1.5, 0.45, 2.2], [2, 0.5, 1.8], [2.51, 0.25, 1.2], [3.2, 0.18, 0.8], [4.1, 0.1, 0.5]]) {
    mix(b, shape(tone(5.0, f * r * (1 + rnd() * 0.0015)), (t) => env(t, 0.002, dk)), 0, g);
  }
  mix(b, shape(bandpass(noise(0.12), 500, 3500), (t) => env(t, 0.0005, 0.02)), 0, 0.5);
  return reverb(b, 0.3, 1.8, 1.6);
};
// Wassermühle (Schleife, 1,6 s = ein Radumlauf): Plätschern, Holzklappern, Mahlgrollen
const muehleLoop = () => {
  const P = 1.6, xf = 0.1, total = P + xf;
  const b = buf(total);
  mix(b, shape(bandpass(noise(total), 500, 3200), (t) => 0.22 + 0.12 * Math.sin(t / P * Math.PI * 2 * 4)), 0, 1);
  mix(b, shape(lowpass(noise(total), 140), (t) => 0.7 + 0.3 * Math.sin(t / P * Math.PI * 2 * 2)), 0, 0.8);
  for (let i = 0; i < 4; i++) {
    const t0 = 0.2 + i * (P / 4);
    mix(b, shape(tone(0.12, 330 - i * 12), (t) => env(t, 0.001, 0.025)), t0, 0.35);
    mix(b, shape(bandpass(noise(0.05), 600, 2500), (t) => env(t, 0.0008, 0.012)), t0, 0.5);
  }
  return loopfix(b, xf);
};
// Panzermotor mit Kettenrasseln (Schleife, 1 s): Zündfolge als Obertonreihe, rollendes Rasseln
const panzerLoop = () => {
  const P = 1.0, xf = 0.1, total = P + xf;
  const b = buf(total);
  for (let k = 1; k <= 22; k++) {
    const ph = ((k * 7919) % 100) / 100 * Math.PI * 2;
    mix(b, tone(total, 25 * k).map((_, i) => Math.sin((2 * Math.PI * 25 * k * i) / RATE + ph) / Math.pow(k, 0.95)), 0, 0.5);
  }
  mix(b, shape(lowpass(noise(total), 220), (t) => 0.7 + 0.3 * Math.sin(t / P * Math.PI * 2 * 3)), 0, 0.7);
  for (let i = 0; i < 14; i++) {
    const t0 = (i + 0.3 * rnd()) * (P / 14);
    mix(b, shape(bandpass(noise(0.04), 900, 4200), (t) => env(t, 0.0006, 0.007)), (t0 + P) % P, 0.22);
  }
  return loopfix(b, xf);
};
// Flugzeugmotor (Schleife, 1 s): dröhnender Propellerrhythmus mit Luftrauschen
const flugLoop = () => {
  const P = 1.0, xf = 0.1, total = P + xf;
  const b = buf(total);
  for (let k = 1; k <= 24; k++) mix(b, tone(total, 38 * k).map((_, i) => Math.sin((2 * Math.PI * 38 * k * i) / RATE + k * 1.7) / Math.pow(k, 0.8)), 0, 0.4);
  mix(b, shape(bandpass(noise(total), 300, 2500), (t) => 0.35 + 0.15 * Math.sin(t / P * Math.PI * 2 * 38)), 0, 0.6);
  return loopfix(b, xf);
};

// ---------- Dateiliste ----------
// Jeder Eintrag: [Schlüssel, Datei, Erzeuger, Startwert]; Varianten (.v2 …) bekommen anderen Startwert
const LIST = [];
const add = (key, file, fn, variants = 1) => { for (let v = 1; v <= variants; v++) LIST.push([v === 1 ? key : `${key}.v${v}`, v === 1 ? file : file.replace('.wav', `_${v}.wav`), fn, 1000 * v + key.length * 7]); };
add('sfx.gewehr', 'audio/gewehr.wav', gewehr, 3);
add('sfx.mg', 'audio/mg.wav', mg, 3);
add('sfx.pak', 'audio/pak.wav', pak, 2);
add('sfx.kanone', 'audio/kanone.wav', kanone, 2);
add('sfx.artillerie', 'audio/artillerie.wav', artillerie, 2);
add('sfx.granate', 'audio/granate.wav', granate, 2);
add('sfx.schiff', 'audio/schiff.wav', schiff, 2);
add('sfx.flak', 'audio/flak.wav', flak, 2);
add('sfx.stuka', 'audio/stuka.wav', stuka, 1);
add('sfx.explosion', 'audio/explosion.wav', explosion, 3);
add('sfx.knacken', 'audio/knacken.wav', knacken, 3);
add('sfx.schutt', 'audio/schutt.wav', schutt, 2);
add('sfx.bauen', 'audio/bauen.wav', bauen, 2);
add('ui.einheit', 'audio/einheit_bereit.wav', einheit, 1);
add('ui.klick', 'audio/klick.wav', klick, 1);
add('ui.bestaetigung', 'audio/funk_bestaetigung.wav', bestaetigung, 2);
add('ui.alarm', 'audio/alarm.wav', alarm, 1);
add('ui.erfolg', 'audio/erfolg.wav', erfolg, 1);
add('ui.warnung', 'audio/warnung.wav', warnung, 1);
add('ui.forschung', 'audio/forschung.wav', forschung, 1);
add('amb.vogel', 'audio/vogel_amsel.wav', amsel, 2);
add('amb.vogel.meise', 'audio/vogel_meise.wav', meise, 2);
add('amb.vogel.fink', 'audio/vogel_fink.wav', fink, 2);
add('amb.kraehe', 'audio/vogel_kraehe.wav', kraehe, 2);
add('amb.kuckuck', 'audio/vogel_kuckuck.wav', kuckuck, 1);
add('amb.kuh', 'audio/kuh_muh.wav', kuhMuh, 3);
add('amb.pferd', 'audio/pferd_wiehern.wav', wiehern, 2);
add('amb.schnauben', 'audio/pferd_schnauben.wav', schnauben, 2);
add('amb.hahn', 'audio/hahn.wav', hahn, 2);
add('amb.hund', 'audio/hund.wav', hund, 2);
add('amb.glocke', 'audio/glocke.wav', glocke, 1);
add('amb.muehle', 'audio/muehle_schleife.wav', muehleLoop, 1);
add('amb.panzer', 'audio/panzer_schleife.wav', panzerLoop, 1);
add('amb.flug', 'audio/flug_schleife.wav', flugLoop, 1);
const ALIAS = {};

mkdirSync(new URL('audio/', ROOT), { recursive: true });
let made = 0;
const FILES = {};
for (const [key, file, fn, sd] of LIST) {
  FILES[key] = file;
  const url = new URL(file, ROOT);
  if (!force && existsSync(url)) continue;
  setSeed(sd);
  // Schleifen dürfen weder ein- noch ausgeblendet werden
  const loop = /^amb\.(muehle|panzer|flug)/.test(key);
  const raw = fn();
  writeFileSync(url, wav(normalize(soft(loop ? raw : trim(raw), 1.1), key.startsWith('ui.') ? 0.7 : loop ? 0.6 : 0.9)));
  made++;
}

// In das Manifest eintragen (eigene Schlüssel und eigene Musik bleiben erhalten)
const mUrl = new URL('manifest.json', ROOT);
const manifest = existsSync(mUrl) ? JSON.parse(readFileSync(mUrl, 'utf8')) : {};
manifest.audio = { ...(manifest.audio ?? {}), ...FILES, ...ALIAS };
manifest.music ??= [];
manifest._audioInfo = 'audio: Geräusch-Schlüssel -> Datei (WAV, MP3 oder OGG). Varianten heißen "<Schlüssel>.v2", ".v3" und werden zufällig gewählt. music: Liste eigener Musikstücke; leer = Musik wird im Browser erzeugt.';
writeFileSync(mUrl, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${made} Geräusche erzeugt, ${Object.keys(manifest.audio).length} im Manifest.`);
