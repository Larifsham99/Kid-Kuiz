// =====================================================================
//  SKRIP VO IKUT BAJET KREDIT — pilih ayat belum dirakam yang paling penting dahulu
//    node tools/skrip-kredit.mjs 7000
//  Hasil: rakaman/kredit/NN.txt + NN.kunci.txt, studio/skrip-kredit.html
// =====================================================================
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
globalThis.localStorage ||= { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = String(v); }, removeItem(k) { delete this.d[k]; } };
const { normalizeMalay, splitSentences, clipKey } = await import('../js/malay-text.js');
const { STORIES } = await import('../js/akhlak/data.js');
const { STEPS } = await import('../js/games/wuduk.js');
const { PANGGILAN } = await import('../js/store.js');

const BUDGET = +(process.argv[2] || 7000);
const PART = 2400;
const LETTER = { A: 'ei', B: 'bi', C: 'si', D: 'di', E: 'i', F: 'ef', G: 'ji', H: 'Heish', I: 'ai', J: 'jei', K: 'kei', L: 'el', M: 'em', N: 'en', O: 'o', P: 'pi', Q: 'kiu', R: 'ar', S: 'es', T: 'ti', U: 'yu', V: 'vi', W: 'dabel yu', X: 'eks', Y: 'wai', Z: 'zed' };
const TAG = { arahan: '[warmly]', pujian: '[cheerfully]', galakan: '[gently]', tenang: '[softly]' };
const base = (s) => clipKey(s).replace(/[.!?,]+$/, '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const man = JSON.parse(readFileSync('audio/ms-MY/manifest.json', 'utf8')).clips;
const have = new Set(Object.keys(man).map(base));

const groups = [];
const items = new Map();
let group = '';
const add = (text, mood = 'arahan') => {
  for (const s of splitSentences(normalizeMalay(String(text), { letters: false }))) {
    const t = s.trim(); const k = base(t);
    if (!t || !k || have.has(k) || items.has(k)) continue;
    items.set(k, { text: t, mood, group });
  }
};
// 2) Jom Berwuduk: langkah
group = 'Jom Berwuduk';
add('Jom belajar berwuduk! Mula dengan membaca Bismillah.');
STEPS.forEach((s) => add(s.say, 'tenang'));
add('Alhamdulillah, wuduk kamu sudah sempurna!', 'pujian');
// 3) Arahan level 1 permainan baharu & tutorial senget
group = 'Arahan permainan baharu';
[
  'Bantu robot ambil bintang! Tekan anak panah. Kemudian tekan Jalan.',
  'Jom bina! Pilih blok. Kemudian tekan pulau. Ikut gambar pelan, ya.',
  'Tekan anak panah untuk melompat! Bawa watak kamu ke trofi. Jangan jatuh ke dalam air!',
  'Jom jadi Pemburu Warna! Tekan Buka kamera.',
  'Sengetkan telefon untuk menggolek bola ke pintu penamat. Kutip syiling dan bintang!',
  'Bantu Si Bulat berjalan di atas titian. Senget sedikit sahaja, perlahan-lahan!',
  'Pegang telefon dengan selesa, seperti sedang membaca.', 'Pegang telefon dengan selesa, kemudian tekan Mula.',
  'Sengetkan telefon ke kiri.', 'Sengetkan telefon ke kanan.', 'Sengetkan telefon ke depan.', 'Sengetkan telefon ke belakang.',
  'Hebat! Kamu sudah pandai mengawal.',
].forEach((t) => add(t));
// 4) Salam ikut panggilan
group = 'Salam ikut panggilan';
for (const c of PANGGILAN) { const n = c.s || c.n; add(`Assalamualaikum, ${n}!`); add(`Hai ${n}!`, 'pujian'); add(`Selamat datang ke Bijaku, ${n}!`, 'pujian'); }
// 5) ayat huruf H (ejaan lama "eic" dahulu dilangkau)
group = 'Huruf H';
['Jom cari huruf H!', 'Mana satu lagi huruf H?', 'Cari gambar yang bermula dengan huruf H!', 'Jom surih huruf H guna jari.', 'Ini huruf H besar.', 'Ini huruf h kecil.', 'Huruf H.', 'H.'].forEach((t) => add(t));

// 6) Taman Akhlak: cerita ikut susunan dibuka (isi baki bajet)
group = 'Taman Akhlak (cerita)';
for (const st of STORIES) {
  st.lines.forEach((l) => add(l)); add(st.q);
  st.choices.forEach((c) => add(c.r, c.good ? 'pujian' : 'galakan'));
  add(st.lesson, 'pujian');
}
add('Selamat datang ke Taman Akhlak! Jom pilih kebaikan, dan kebun kamu akan mekar.');
const speakable = (t) => {
  let s = t.replace(/(^|[^A-Za-z'’-])([A-Za-z])(?=$|[^A-Za-z'’-])/g, (m, pre, ch) => pre + (LETTER[ch.toUpperCase()] || ch));
  s = cap(s); if (!/[.!?]$/.test(s)) s += '.';
  return s;
};
// pilih ikut bajet (aksara skrip termasuk tag)
const chosen = []; let used = 0; const skipped = {}; let prevMood = null;
for (const it of items.values()) {
  const line = speakable(it.text);
  const cost = line.length + 3 + (it.mood !== prevMood ? TAG[it.mood].length + 1 : 0);
  if (used + cost > BUDGET) { skipped[it.group] = (skipped[it.group] || 0) + 1; continue; }
  chosen.push({ ...it, line }); used += cost; prevMood = it.mood;
}
const parts = []; let cur = [], len = 0;
for (const it of chosen) {
  const cost = it.line.length + 3 + TAG[it.mood].length + 1;
  if (len + cost > PART && cur.length) { parts.push(cur); cur = []; len = 0; }
  cur.push(it); len += cost;
}
if (cur.length) parts.push(cur);
const dir = 'rakaman/kredit';
if (existsSync(dir)) rmSync(dir, { recursive: true });
mkdirSync(dir, { recursive: true });
parts.forEach((p, i) => {
  const id = String(i + 1).padStart(2, '0'); let prev = null;
  writeFileSync(`${dir}/${id}.txt`, p.map((it) => { const t = (it.mood !== prev ? TAG[it.mood] + ' ' : '') + it.line; prev = it.mood; return t; }).join('\n\n\n') + '\n');
  writeFileSync(`${dir}/${id}.kunci.txt`, p.map((it) => it.text).join('\n') + '\n');
});
const byGroup = {}; chosen.forEach((c) => { byGroup[c.group] = (byGroup[c.group] || 0) + 1; });
console.log(`${chosen.length} ayat, ${used} aksara, ${parts.length} bahagian`, byGroup, Object.keys(skipped).length ? { tidak_muat: skipped } : '');
execSync(`node tools/skrip-html.mjs ${dir} studio/skrip-kredit.html "Skrip VO keutamaan (bajet ${BUDGET.toLocaleString('ms')} kredit)"`, { stdio: 'inherit' });
