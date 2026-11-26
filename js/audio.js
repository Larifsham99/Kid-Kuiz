// =====================================================================
//  SISTEM AUDIO
//  - Suara Bahasa Melayu melalui Web Speech API (ms-MY, sandaran id-ID)
//  - Kesan bunyi (betul, cuba lagi, ganjaran) disintesis dengan Web Audio
//  - Bunyi haiwan / kenderaan / alam disintesis (berfungsi luar talian)
//  - Muzik latar ringan
// =====================================================================
import { settings } from './store.js';
import { normalizeMalay, splitSentences, clipKey, letterize } from './malay-text.js';

let ctx = null;
let master = null;
let voice = null;
let voicesReady = false;
let musicTimer = null;
let musicGain = null;

function ac() {
  if (!ctx) {
    const C = self.AudioContext || self.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
// Buka kunci audio pada sentuhan pertama (keperluan pelayar mudah alih)
export function unlockAudio() {
  ac();
  try { if ('speechSynthesis' in self && !speechSynthesis.speaking) speechSynthesis.resume(); } catch { /* */ }
}

// ---------------- SUARA (TTS) ----------------
// Keutamaan: suara wanita Bahasa Melayu yang berkualiti tinggi (neural/natural),
// kemudian Bahasa Indonesia. Ibu bapa boleh memilih suara sendiri dalam tetapan.
const FEMALE = /yasmin|amira|damayanti|gadis|siti|nur\b|female|wanita|perempuan|woman/i;
const MALE = /osman|ardi|rizwan|\bmale\b|lelaki|\bman\b/i;
const QUALITY = /natural|neural|online|enhanced|premium|wavenet|studio|dipertingkat/i;
const langOf = (v) => (v.lang || '').replace('_', '-').toLowerCase();
export function voiceScore(v) {
  const l = langOf(v);
  // Bahasa Melayu sentiasa didahulukan (sebutan lebih penting daripada kualiti suara)
  let sc = l.startsWith('ms-my') ? 200 : l.startsWith('ms') ? 190 : l.startsWith('id') ? 60 : -999;
  const n = `${v.name} ${v.voiceURI || ''}`;
  if (FEMALE.test(n)) sc += 25;
  else if (MALE.test(n)) sc -= 40;
  if (QUALITY.test(n)) sc += 30;
  if (v.localService === false) sc += 5;
  return sc;
}
export const isFemaleVoice = (v) => FEMALE.test(`${v.name} ${v.voiceURI || ''}`) && !/\bmale\b/i.test(v.name.replace(/female/ig, ''));
export const isMaleVoice = (v) => !isFemaleVoice(v) && MALE.test(`${v.name} ${v.voiceURI || ''}`) || /osman|ardi|rizwan/i.test(v.name);
export const isQualityVoice = (v) => QUALITY.test(`${v.name} ${v.voiceURI || ''}`);
// Senarai suara Melayu/Indonesia, terbaik dahulu
export function rankVoices(list) {
  return list.filter((v) => voiceScore(v) > -900).sort((a, b) => voiceScore(b) - voiceScore(a));
}
export function malayVoices() {
  if (typeof speechSynthesis === 'undefined') return [];
  return rankVoices(speechSynthesis.getVoices());
}
const prefs = () => { try { return settings(); } catch { return {}; } };
function pickVoice() {
  if (typeof speechSynthesis === 'undefined') return null;
  const vs = speechSynthesis.getVoices();
  if (!vs.length) return null;
  voicesReady = true;
  const list = rankVoices(vs);
  const want = prefs().voiceName;
  return (want && list.find((v) => v.name === want)) || list[0] || null;
}
export function refreshVoice() { voice = pickVoice(); return voice; }
if (typeof self !== 'undefined' && 'speechSynthesis' in self) {
  voice = pickVoice();
  speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); };
}
export function voiceInfo() {
  if (!('speechSynthesis' in self)) return 'Tiada sokongan suara pada peranti ini';
  if (!voicesReady) voice = pickVoice();
  return voice ? `${voice.name} (${voice.lang})` : 'Suara lalai peranti (pasang suara Bahasa Melayu/Indonesia untuk sebutan terbaik)';
}

// ---------------- KAWALAN SUARA ----------------
// Kelajuan, nada & tahap ekspresi boleh diubah secara berasingan oleh ibu bapa.
export const VOICE_RATES = { perlahan: { n: 'Perlahan', v: 0.8 }, sederhana: { n: 'Sederhana', v: 0.88 }, biasa: { n: 'Biasa', v: 0.95 }, laju: { n: 'Laju', v: 1.05 } };
export const VOICE_PITCHES = { rendah: { n: 'Rendah', v: 0.92 }, sederhana: { n: 'Sederhana', v: 1.0 }, tinggi: { n: 'Tinggi', v: 1.1 } };
export const VOICE_EXPR = { tenang: { n: 'Tenang', k: 0.4 }, sederhana: { n: 'Sederhana', k: 1 }, ceria: { n: 'Ceria', k: 1.6 } };
// Gaya lama (dikekalkan untuk keserasian tetapan lama)
export const VOICE_STYLES = {
  lembut: { n: 'Lembut keibuan', pitch: 1.0, rate: 0.86 },
  biasa: { n: 'Biasa', pitch: 1.05, rate: 0.93 },
  ceria: { n: 'Ceria', pitch: 1.15, rate: 0.98 },
};
// Ekspresi mengikut konteks: perubahan relatif kelajuan & nada
export const MOODS = {
  arahan: { rate: 0, pitch: 0 }, // lembut ketika memberi penerangan
  pujian: { rate: 0.05, pitch: 0.08 }, // ceria apabila berjaya
  galakan: { rate: -0.03, pitch: 0.03 }, // lembut & memujuk
  tenang: { rate: -0.07, pitch: -0.03 }, // doa & kandungan agama
};
function voiceParams(mood = 'arahan') {
  const s = prefs();
  const legacy = VOICE_STYLES[s.voiceStyle] || VOICE_STYLES.lembut;
  const rate = VOICE_RATES[s.voiceRateLvl]?.v ?? legacy.rate;
  const pitch = VOICE_PITCHES[s.voicePitchLvl]?.v ?? legacy.pitch;
  const k = VOICE_EXPR[s.voiceExpr]?.k ?? 1;
  const m = MOODS[mood] || MOODS.arahan;
  return { rate: Math.max(0.6, rate + m.rate * k), pitch: Math.max(0.6, pitch + m.pitch * k), base: rate };
}

export { splitSentences } from './malay-text.js';
// Teks lebih semula jadi untuk dibaca (nombor, tarikh, simbol, singkatan -> bacaan BM)
export function speechText(t) { return normalizeMalay(t); }

// ---------------- PAKEJ SUARA NEURAL / RAKAMAN ----------------
// Jika audio/ms-MY/manifest.json wujud, setiap ayat yang ada rakaman dimainkan
// daripada fail audio; ayat lain jatuh balik ke suara peranti.
let pack = null;
const clipCache = new Map();
export async function loadVoicePack(base = 'audio/ms-MY/') {
  try {
    const r = await fetch(base + 'manifest.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    const m = await r.json();
    if (!m || !m.clips || !Object.keys(m.clips).length) return null;
    pack = { base, voice: m.voice, clips: m.clips, count: Object.keys(m.clips).length };
    return pack;
  } catch { return null; }
}
export const voicePack = () => pack;
const usePack = () => pack && prefs().voiceEngine !== 'peranti';
// Lalai: hanya rakaman VO dimainkan; ayat yang belum dirakam senyap (tiada suara peranti).
// Ibu bapa boleh pilih 'peranti' di Tetapan untuk suara telefon.
const recOnly = () => prefs().voiceEngine !== 'peranti';
// Ayat tanpa rakaman: senyap, tetapi tunggu tempoh bacaan supaya cerita/pujian/peralihan
// tidak meluru (anak & ibu bapa sempat membaca teks di skrin). ~75 ms setiap aksara.
async function readPause(text, id) {
  const ms = Math.max(1200, String(text).length * 75) * (globalThis.__dcTimeScale || 1);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (id !== speakSeq) return; // diganggu oleh ucapan baharu
    await new Promise((res) => setTimeout(res, Math.min(100, end - Date.now())));
  }
}
// semua ayat dalam teks ini ada rakaman?
export function hasClip(text) {
  if (!pack) return false;
  return splitSentences(normalizeMalay(String(text), { letters: false })).every((s) => !!findClip(s));
}
async function clipUrl(file) {
  if (clipCache.has(file)) return clipCache.get(file);
  const res = await fetch(pack.base + file); // fetch penuh (bukan julat) supaya boleh di-cache untuk luar talian
  if (!res.ok) throw new Error('klip tiada');
  const url = URL.createObjectURL(await res.blob());
  clipCache.set(file, url);
  if (clipCache.size > 80) { const [k, u] = clipCache.entries().next().value; URL.revokeObjectURL(u); clipCache.delete(k); }
  return url;
}
// Cari klip; ayat yang hanya berbeza tanda baca akhir (cth. "Kucing!" / "Kucing.") berkongsi rakaman
function findClip(sentence) {
  const k = clipKey(sentence);
  if (pack.clips[k]) return pack.clips[k];
  const base = k.replace(/[.!?,]+$/, '');
  for (const end of ['.', '!', '?', '']) if (pack.clips[base + end]) return pack.clips[base + end];
  return null;
}
let currentAudio = null;
function playClip(file, { rate, id }) {
  return new Promise((resolve) => {
    if (id !== speakSeq) return resolve();
    clipUrl(file).then((url) => {
      if (id !== speakSeq) return resolve();
      const a = new Audio(url);
      currentAudio = a;
      a.preservesPitch = true; a.mozPreservesPitch = true; a.webkitPreservesPitch = true;
      a.playbackRate = Math.min(1.25, Math.max(0.75, rate));
      let done = false;
      const fin = () => { if (!done) { done = true; resolve(); } };
      a.onended = fin; a.onerror = fin;
      a.play().catch(fin);
    }).catch(() => resolve(false));
  });
}
// Muat turun semua klip supaya boleh digunakan tanpa internet
export async function downloadVoicePack(onProgress) {
  if (!pack) return 0;
  const files = [...new Set(Object.values(pack.clips))];
  let n = 0;
  for (let i = 0; i < files.length; i += 6) {
    await Promise.all(files.slice(i, i + 6).map((f) => fetch(pack.base + f).then(() => { n++; }).catch(() => {})));
    onProgress && onProgress(n, files.length);
  }
  return n;
}

let speakSeq = 0;
function sayOne(text, { lang, rate, pitch, id }) {
  return new Promise((resolve) => {
    if (id !== speakSeq || typeof speechSynthesis === 'undefined') return resolve();
    const u = new SpeechSynthesisUtterance(text);
    if (lang === 'en') {
      u.lang = 'en-GB';
      const en = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)).sort((a, b) => (FEMALE.test(b.name) - FEMALE.test(a.name)))[0];
      if (en) u.voice = en;
    } else {
      if (!voice) voice = pickVoice();
      if (voice) u.voice = voice;
      u.lang = voice ? voice.lang : 'ms-MY';
    }
    u.rate = rate; u.pitch = pitch; u.volume = 1;
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    u.onend = fin; u.onerror = fin;
    // jaga-jaga jika onend tidak dipanggil
    setTimeout(fin, 700 + text.length * 120);
    speechSynthesis.speak(u);
  });
}
// mood: 'arahan' | 'pujian' | 'galakan' | 'tenang'
export function speak(text, { lang, rate, interrupt = true, mood = 'arahan' } = {}) {
  const s = prefs();
  if (!s.voice || !text) return Promise.resolve();
  try {
    if (interrupt) stopSpeak();
    const id = speakSeq;
    const vp = voiceParams(mood);
    const r = rate || vp.rate;
    // kunci rakaman guna huruf asal; suara peranti guna nama huruf (A -> ei, H -> heish)
    const parts = lang === 'en' ? [String(text)] : splitSentences(normalizeMalay(text, { letters: false }));
    if (globalThis.__dcCapture && lang !== 'en') parts.forEach((p) => globalThis.__dcCapture.push({ text: p, mood }));
    return parts.reduce((p, part, i) => p.then(async () => {
      if (id !== speakSeq) return;
      if (i > 0) await new Promise((res) => setTimeout(res, 160)); // jeda semula jadi antara ayat
      const file = lang !== 'en' && usePack() ? findClip(part) : null;
      if (file) {
        // klip neural sudah mengandungi ekspresi; hanya kelajuan pilihan ibu bapa digunakan
        const ok = await playClip(file, { rate: vp.base / 0.88, id });
        if (ok !== false) return;
      }
      if (recOnly()) { await readPause(part, id); return; } // tiada rakaman: senyap + masa membaca
      if (typeof speechSynthesis !== 'undefined') await sayOne(lang === 'en' ? part : letterize(part), { lang, rate: r, pitch: vp.pitch, id });
    }), Promise.resolve()).catch(() => {});
  } catch { return Promise.resolve(); }
}
export function stopSpeak() {
  speakSeq++;
  try { if (currentAudio) { currentAudio.pause(); currentAudio = null; } } catch { /* */ }
  try { speechSynthesis.cancel(); } catch { /* */ }
}

// Sebut BM dan (jika dwibahasa) English
export async function speakWord(ms, en) {
  await speak(ms);
  if (en && settings().lang === 'dual') await speak(en, { lang: 'en', interrupt: false });
}

// ---------------- BLOK SINTESIS ----------------
function env(g, t, a, d, peak, sus = 0) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), t + a + d);
}
function tone({ type = 'sine', f = 440, f2, t = 0, dur = 0.3, vol = 0.3, a = 0.01, filter, vib, out }) {
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + t;
  const o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = c.createGain();
  env(g, t0, a, dur, vol);
  let node = o;
  if (vib) {
    const l = c.createOscillator(); l.frequency.value = vib.rate;
    const lg = c.createGain(); lg.gain.value = vib.depth;
    l.connect(lg); lg.connect(o.frequency); l.start(t0); l.stop(t0 + dur + 0.1);
  }
  if (filter) {
    const fl = c.createBiquadFilter(); fl.type = filter.type || 'lowpass'; fl.frequency.value = filter.f; fl.Q.value = filter.q || 1;
    if (filter.f2) fl.frequency.exponentialRampToValueAtTime(filter.f2, t0 + dur);
    node.connect(fl); node = fl;
  }
  node.connect(g); g.connect(out || master);
  o.start(t0); o.stop(t0 + a + dur + 0.05);
}
let noiseBuf = null;
function noise({ t = 0, dur = 0.3, vol = 0.3, a = 0.01, filter = { type: 'lowpass', f: 1000 }, out, lfo }) {
  const c = ac(); if (!c) return;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = c.currentTime + t;
  const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const fl = c.createBiquadFilter(); fl.type = filter.type; fl.frequency.value = filter.f; fl.Q.value = filter.q || 1;
  if (filter.f2) fl.frequency.exponentialRampToValueAtTime(filter.f2, t0 + dur);
  const g = c.createGain();
  env(g, t0, a, dur, vol);
  if (lfo) {
    const l = c.createOscillator(); l.frequency.value = lfo.rate;
    const lg = c.createGain(); lg.gain.value = lfo.depth;
    const vca = c.createGain(); vca.gain.value = 1 - lfo.depth;
    l.connect(lg); lg.connect(vca.gain); l.start(t0); l.stop(t0 + dur + a + 0.1);
    s.connect(fl); fl.connect(vca); vca.connect(g);
  } else { s.connect(fl); fl.connect(g); }
  g.connect(out || master);
  s.start(t0); s.stop(t0 + a + dur + 0.05);
}

// ---------------- GETARAN (telefon yang menyokong) ----------------
export function haptic(pattern = 15) {
  try { if (settings().vibrate !== false && navigator.vibrate) navigator.vibrate(pattern); } catch { /* tidak disokong */ }
}

// ---------------- KESAN BUNYI ----------------
const sfxOn = () => settings().sound;
export const sfx = {
  tap() { if (!sfxOn()) return; tone({ type: 'sine', f: 660, f2: 880, dur: 0.07, vol: 0.12 }); },
  pick() { if (!sfxOn()) return; tone({ type: 'triangle', f: 520, f2: 700, dur: 0.08, vol: 0.15 }); },
  drop() { if (!sfxOn()) return; tone({ type: 'triangle', f: 400, f2: 300, dur: 0.1, vol: 0.15 }); },
  correct() {
    if (!sfxOn()) return;
    [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', f, t: i * 0.08, dur: 0.22, vol: 0.22 }));
  },
  wrong() { if (!sfxOn()) return; tone({ type: 'sine', f: 330, f2: 260, dur: 0.25, vol: 0.18 }); tone({ type: 'sine', f: 262, f2: 220, t: 0.18, dur: 0.3, vol: 0.14 }); },
  flip() { if (!sfxOn()) return; noise({ dur: 0.06, vol: 0.12, filter: { type: 'highpass', f: 2500 } }); },
  coin() { if (!sfxOn()) return; tone({ type: 'square', f: 988, dur: 0.07, vol: 0.08 }); tone({ type: 'square', f: 1319, t: 0.07, dur: 0.25, vol: 0.08 }); },
  win() {
    if (!sfxOn()) return;
    const mel = [523, 587, 659, 784, 659, 784, 1047];
    mel.forEach((f, i) => tone({ type: 'triangle', f, t: i * 0.12, dur: 0.25, vol: 0.2 }));
    tone({ type: 'sine', f: 262, t: 0, dur: 0.9, vol: 0.12 });
  },
  reward() {
    if (!sfxOn()) return;
    for (let i = 0; i < 8; i++) tone({ type: 'sine', f: 1200 + i * 180, t: i * 0.05, dur: 0.18, vol: 0.1 });
    sfx.win();
  },
  step() { if (!sfxOn()) return; tone({ type: 'sine', f: 440, f2: 520, dur: 0.05, vol: 0.08 }); },
  bump() { if (!sfxOn()) return; tone({ type: 'sine', f: 140, f2: 90, dur: 0.12, vol: 0.2 }); },
  pop() { if (!sfxOn()) return; tone({ type: 'sine', f: 300, f2: 900, dur: 0.08, vol: 0.18 }); },
  // ---- pek maklum balas kanak-kanak (ganti ucapan berulang) ----
  // "yeay" tanpa suara: pop-pop-ding + kilauan (pujian bunyi, pelbagai supaya tidak membosankan)
  yay() {
    if (!sfxOn()) return;
    const v = Math.floor(Math.random() * 3);
    const sets = [[659, 784, 1047, 1319], [523, 659, 880, 1175], [587, 740, 988, 1319]][v];
    sets.forEach((f, i) => tone({ type: 'triangle', f, t: i * 0.07, dur: 0.18, vol: 0.16 }));
    tone({ type: 'sine', f: 300, f2: 900, dur: 0.07, vol: 0.12 });
    for (let i = 0; i < 6; i++) tone({ type: 'sine', f: 1800 + Math.random() * 1600, t: 0.25 + i * 0.045, dur: 0.09, vol: 0.035 });
  },
  // rentetan betul: nada makin tinggi ikut bilangan
  streak(k = 1) { if (!sfxOn()) return; const b = 523 * 2 ** (Math.min(8, k) / 12); [0, 4, 7, 12].forEach((s, i) => tone({ type: 'square', f: b * 2 ** (s / 12), t: i * 0.06, dur: 0.12, vol: 0.05, filter: { type: 'lowpass', f: 3000 } })); },
  // salah: "boing" kartun yang lembut, tidak menakutkan
  boing() { if (!sfxOn()) return; tone({ type: 'sine', f: 330, f2: 160, dur: 0.28, vol: 0.18, vib: { rate: 16, depth: 30 } }); tone({ type: 'triangle', f: 196, t: 0.05, dur: 0.15, vol: 0.06 }); },
  // antara soalan: desiran naik
  whoosh() { if (!sfxOn()) return; noise({ dur: 0.22, vol: 0.06, a: 0.04, filter: { type: 'bandpass', f: 600, f2: 2400, q: 1.3 } }); tone({ type: 'sine', f: 440, f2: 880, t: 0.08, dur: 0.1, vol: 0.05 }); },
  // pusingan terakhir: gendang bergulung + simbal kecil
  lastRound() { if (!sfxOn()) return; noise({ dur: 0.7, vol: 0.08, a: 0.05, filter: { type: 'bandpass', f: 220, q: 2 }, lfo: { rate: 24, depth: 0.8 } }); noise({ t: 0.7, dur: 0.4, vol: 0.07, filter: { type: 'highpass', f: 5000 } }); tone({ type: 'triangle', f: 784, t: 0.7, dur: 0.25, vol: 0.12 }); },
  // anak lama diam: ting-ting lembut menarik perhatian
  ping() { if (!sfxOn()) return; tone({ type: 'sine', f: 1319, dur: 0.12, vol: 0.09 }); tone({ type: 'sine', f: 1568, t: 0.16, dur: 0.18, vol: 0.08 }); },
  // bintang terbang ke kiraan
  zip() { if (!sfxOn()) return; tone({ type: 'sine', f: 900, f2: 2200, dur: 0.18, vol: 0.06 }); },
  // peralihan skrin: desiran lembut
  swish() { if (!sfxOn()) return; noise({ dur: 0.16, vol: 0.035, a: 0.03, filter: { type: 'bandpass', f: 900, f2: 2600, q: 1.2 } }); tone({ type: 'sine', f: 520, f2: 700, t: 0.05, dur: 0.07, vol: 0.04 }); },
  // suis hidup / mati
  toggle(on) { if (!sfxOn()) return; tone({ type: 'triangle', f: on ? 620 : 520, f2: on ? 930 : 360, dur: 0.08, vol: 0.12 }); noise({ dur: 0.03, vol: 0.05, filter: { type: 'highpass', f: 3000 } }); },
  note(i) { if (!sfxOn()) return; const sc = [262, 330, 392, 523, 587, 659, 784, 880]; tone({ type: 'triangle', f: sc[i % sc.length], dur: 0.35, vol: 0.22 }); },
};

// Sintesis mentah untuk pek bunyi permainan (mematuhi tetapan bunyi ibu bapa)
export const synth = {
  on: () => !!settings().sound,
  tone: (o) => { if (sfxOn()) tone(o); },
  noise: (o) => { if (sfxOn()) noise(o); },
};

// ---------------- BUNYI SEBENAR (sintesis) ----------------
const SYN = {
  kucing() { tone({ type: 'sawtooth', f: 520, f2: 760, dur: 0.25, vol: 0.18, filter: { type: 'bandpass', f: 1400, q: 3 } }); tone({ type: 'sawtooth', f: 760, f2: 430, t: 0.25, dur: 0.45, vol: 0.18, filter: { type: 'bandpass', f: 1200, f2: 800, q: 3 } }); return 0.8; },
  anjing() { for (const t of [0, 0.38]) { noise({ t, dur: 0.12, vol: 0.35, filter: { type: 'bandpass', f: 700, q: 1.5 } }); tone({ type: 'sawtooth', f: 330, f2: 180, t, dur: 0.14, vol: 0.25, filter: { type: 'lowpass', f: 1200 } }); } return 0.7; },
  lembu() { tone({ type: 'sawtooth', f: 130, f2: 105, dur: 1.3, vol: 0.32, a: 0.15, filter: { type: 'lowpass', f: 500, f2: 900, q: 4 }, vib: { rate: 5, depth: 3 } }); return 1.5; },
  kambing() { tone({ type: 'sawtooth', f: 420, f2: 380, dur: 0.9, vol: 0.2, a: 0.05, filter: { type: 'bandpass', f: 1100, q: 2 }, vib: { rate: 11, depth: 35 } }); return 1.0; },
  biri() { tone({ type: 'sawtooth', f: 320, f2: 300, dur: 0.85, vol: 0.2, a: 0.05, filter: { type: 'bandpass', f: 900, q: 2 }, vib: { rate: 8, depth: 22 } }); return 1.0; },
  ayam() { const seq = [[500, 600, 0.12], [600, 650, 0.12], [650, 700, 0.14], [700, 900, 0.5]]; let t = 0; seq.forEach(([a, b, d]) => { tone({ type: 'sawtooth', f: a, f2: b, t, dur: d, vol: 0.18, filter: { type: 'bandpass', f: 1500, q: 2 } }); t += d + 0.03; }); tone({ type: 'sawtooth', f: 900, f2: 500, t, dur: 0.3, vol: 0.15, filter: { type: 'bandpass', f: 1300, q: 2 } }); return t + 0.4; },
  itik() { for (const t of [0, 0.28, 0.56]) tone({ type: 'sawtooth', f: 260, f2: 220, t, dur: 0.16, vol: 0.25, filter: { type: 'bandpass', f: 1300, q: 6 } }); return 0.8; },
  kuda() { tone({ type: 'sawtooth', f: 900, f2: 400, dur: 1.0, vol: 0.16, filter: { type: 'bandpass', f: 1600, q: 2 }, vib: { rate: 14, depth: 70 } }); noise({ t: 0.9, dur: 0.3, vol: 0.1, filter: { type: 'bandpass', f: 600 } }); return 1.3; },
  singa() { noise({ dur: 1.1, vol: 0.4, a: 0.2, filter: { type: 'lowpass', f: 600, f2: 200, q: 3 } }); tone({ type: 'sawtooth', f: 110, f2: 70, dur: 1.1, vol: 0.25, a: 0.2, filter: { type: 'lowpass', f: 400 }, vib: { rate: 22, depth: 8 } }); return 1.3; },
  katak() { for (const t of [0, 0.45]) { for (let i = 0; i < 4; i++) tone({ type: 'square', f: 180, f2: 140, t: t + i * 0.05, dur: 0.04, vol: 0.18, filter: { type: 'lowpass', f: 900 } }); } return 0.8; },
  burung() { for (let i = 0; i < 5; i++) tone({ type: 'sine', f: 2600 + (i % 2) * 400, f2: 3800, t: i * 0.14, dur: 0.07, vol: 0.18 }); return 0.8; },
  burunghantu() { tone({ type: 'sine', f: 420, f2: 380, dur: 0.35, vol: 0.3, a: 0.06 }); tone({ type: 'sine', f: 420, f2: 360, t: 0.55, dur: 0.6, vol: 0.3, a: 0.06 }); return 1.3; },
  lebah() { tone({ type: 'sawtooth', f: 230, f2: 250, dur: 1.4, vol: 0.12, a: 0.1, filter: { type: 'bandpass', f: 600, q: 1 }, vib: { rate: 9, depth: 18 } }); return 1.5; },
  gajah() { tone({ type: 'sawtooth', f: 500, f2: 760, dur: 0.8, vol: 0.18, a: 0.08, filter: { type: 'bandpass', f: 1400, q: 1.5 }, vib: { rate: 30, depth: 25 } }); noise({ dur: 0.8, vol: 0.12, filter: { type: 'bandpass', f: 1800, q: 2 } }); return 1.0; },
  monyet() { for (let i = 0; i < 5; i++) tone({ type: 'square', f: 700 + i * 60, f2: 400, t: i * 0.16, dur: 0.1, vol: 0.12, filter: { type: 'bandpass', f: 1500, q: 2 } }); return 0.9; },
  kereta() { for (const t of [0, 0.45]) { tone({ type: 'square', f: 400, t, dur: 0.3, vol: 0.12 }); tone({ type: 'square', f: 500, t, dur: 0.3, vol: 0.1 }); } return 0.9; },
  ambulans() { for (let i = 0; i < 4; i++) tone({ type: 'square', f: i % 2 ? 960 : 770, t: i * 0.45, dur: 0.42, vol: 0.08, filter: { type: 'lowpass', f: 2500 } }); return 1.9; },
  polis() { for (let i = 0; i < 2; i++) { tone({ type: 'sawtooth', f: 600, f2: 1300, t: i * 0.9, dur: 0.45, vol: 0.08, filter: { type: 'lowpass', f: 2500 } }); tone({ type: 'sawtooth', f: 1300, f2: 600, t: i * 0.9 + 0.45, dur: 0.45, vol: 0.08, filter: { type: 'lowpass', f: 2500 } }); } return 1.9; },
  bomba() { for (let i = 0; i < 6; i++) { tone({ type: 'triangle', f: 1800, t: i * 0.22, dur: 0.2, vol: 0.18 }); tone({ type: 'sine', f: 2700, t: i * 0.22, dur: 0.15, vol: 0.08 }); } return 1.4; },
  keretaapi() { tone({ type: 'sine', f: 740, dur: 0.6, vol: 0.18, a: 0.05 }); tone({ type: 'sine', f: 880, dur: 0.6, vol: 0.12, a: 0.05 }); for (let i = 0; i < 6; i++) noise({ t: 0.7 + i * 0.2, dur: 0.1, vol: 0.25, filter: { type: 'bandpass', f: 900, q: 1 } }); return 2.0; },
  kapalterbang() { noise({ dur: 1.8, vol: 0.35, a: 0.6, filter: { type: 'bandpass', f: 300, f2: 2500, q: 1 } }); return 1.9; },
  helikopter() { noise({ dur: 1.6, vol: 0.45, a: 0.1, filter: { type: 'lowpass', f: 500 }, lfo: { rate: 11, depth: 0.95 } }); return 1.7; },
  motosikal() { tone({ type: 'sawtooth', f: 70, f2: 180, dur: 1.2, vol: 0.2, a: 0.05, filter: { type: 'lowpass', f: 700 }, vib: { rate: 26, depth: 12 } }); return 1.3; },
  basikal() { for (const t of [0, 0.3]) { tone({ type: 'sine', f: 2100, t, dur: 0.25, vol: 0.2 }); tone({ type: 'sine', f: 3150, t, dur: 0.2, vol: 0.08 }); tone({ type: 'sine', f: 2120, t: t + 0.02, dur: 0.23, vol: 0.1, vib: { rate: 30, depth: 30 } }); } return 0.7; },
  kapal() { tone({ type: 'sawtooth', f: 110, dur: 1.6, vol: 0.25, a: 0.15, filter: { type: 'lowpass', f: 450 } }); tone({ type: 'sawtooth', f: 165, dur: 1.6, vol: 0.15, a: 0.15, filter: { type: 'lowpass', f: 450 } }); return 1.8; },
  hujan() { noise({ dur: 2.2, vol: 0.3, a: 0.3, filter: { type: 'highpass', f: 1800 } }); for (let i = 0; i < 18; i++) tone({ type: 'sine', f: 1500 + Math.random() * 2500, f2: 600, t: Math.random() * 2, dur: 0.03, vol: 0.06 }); return 2.3; },
  guruh() { noise({ dur: 0.15, vol: 0.5, filter: { type: 'lowpass', f: 2500 } }); noise({ t: 0.1, dur: 2.0, vol: 0.6, a: 0.1, filter: { type: 'lowpass', f: 180, q: 1 } }); return 2.2; },
  angin() { noise({ dur: 2.2, vol: 0.35, a: 0.6, filter: { type: 'bandpass', f: 400, f2: 1100, q: 6 } }); return 2.3; },
  ombak() { for (const t of [0, 1.2]) noise({ t, dur: 1.1, vol: 0.3, a: 0.5, filter: { type: 'lowpass', f: 900, f2: 300 } }); return 2.4; },
  jam() { for (let i = 0; i < 6; i++) tone({ type: 'square', f: i % 2 ? 1400 : 1900, t: i * 0.35, dur: 0.02, vol: 0.12, filter: { type: 'bandpass', f: 2000, q: 4 } }); return 2.1; },
  loceng() { tone({ type: 'sine', f: 659, dur: 0.8, vol: 0.3 }); tone({ type: 'sine', f: 1318, dur: 0.4, vol: 0.06 }); tone({ type: 'sine', f: 523, t: 0.6, dur: 1.0, vol: 0.3 }); tone({ type: 'sine', f: 1046, t: 0.6, dur: 0.5, vol: 0.06 }); return 1.7; },
  telefon() { for (const t of [0, 0.9]) tone({ type: 'square', f: 1200, t, dur: 0.6, vol: 0.06, vib: { rate: 20, depth: 200 } }); return 1.6; },
  dram() { [0, 0.3, 0.6].forEach((t, i) => { if (i < 2) tone({ type: 'sine', f: 140, f2: 50, t, dur: 0.25, vol: 0.6 }); else noise({ t, dur: 0.15, vol: 0.4, filter: { type: 'highpass', f: 1500 } }); }); return 0.9; },
  tepuk() { for (let i = 0; i < 5; i++) noise({ t: i * 0.22, dur: 0.05, vol: 0.5, filter: { type: 'bandpass', f: 1300, q: 1 } }); return 1.2; },
  wisel() { tone({ type: 'sine', f: 2400, dur: 0.9, vol: 0.18, vib: { rate: 28, depth: 120 } }); return 1.0; },
};
export const hasSound = (id) => !!SYN[id];
export async function playSound(id, { withOno = false, ono = '' } = {}) {
  const c = ac();
  if (!c || !SYN[id]) return;
  const dur = SYN[id]();
  await new Promise((r) => setTimeout(r, dur * 1000 + 150));
  if (withOno && ono) await speak(ono, { interrupt: false });
}

// ---------------- MUZIK LATAR ----------------
const SONG = [[0, 523], [1, 659], [2, 784], [3, 659], [4, 698], [5, 880], [6, 784], [8, 659], [9, 587], [10, 523], [11, 587], [12, 659], [13, 523], [14, 587]];
const BASS = [[0, 131], [4, 175], [8, 196], [12, 131]];
export function startMusic() {
  stopMusic();
  if (!settings().music) return;
  const c = ac(); if (!c) return;
  musicGain = c.createGain(); musicGain.gain.value = 0.18; musicGain.connect(master);
  const beat = 0.28;
  const play = () => {
    SONG.forEach(([b, f]) => tone({ type: 'triangle', f, t: b * beat, dur: beat * 0.9, vol: 0.12, out: musicGain }));
    BASS.forEach(([b, f]) => tone({ type: 'sine', f, t: b * beat, dur: beat * 3.5, vol: 0.12, out: musicGain }));
  };
  play();
  musicTimer = setInterval(play, 16 * beat * 1000);
}
export function stopMusic() {
  clearInterval(musicTimer); musicTimer = null;
  if (musicGain) { try { musicGain.disconnect(); } catch { /* */ } musicGain = null; }
}
