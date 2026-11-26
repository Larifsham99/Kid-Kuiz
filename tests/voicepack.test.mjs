// Ujian pakej suara: ayat yang ada klip dimainkan daripada fail audio,
// ayat lain jatuh balik ke suara peranti; tetapan "Suara peranti" mematikan klip.
// Memerlukan sekurang-kurangnya satu klip dalam audio/ms-MY/manifest.json.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const man = JSON.parse(readFileSync('audio/ms-MY/manifest.json', 'utf8'));
const keys = Object.keys(man.clips || {});
if (!keys.length) { console.log('(langkau) tiada klip dalam pakej suara'); process.exit(0); }
const srv = spawn('python3', ['-m', 'http.server', '8811'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const b = await chromium.launch();
const pg = await (await b.newContext()).newPage();
let fails = 0; const ok = (c, m) => { console.log(c ? '✓' : '✗', m); if (!c) fails++; };
const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
await pg.addInitScript(() => {
  window.__log = [];
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { getVoices: () => [{ name: 'Malay', lang: 'ms-MY', voiceURI: 'm' }], cancel() {}, resume() {}, addEventListener() {}, speak(u) { window.__log.push('tts:' + u.text); setTimeout(() => u.onend && u.onend(), 5); } } });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  HTMLMediaElement.prototype.play = function () { window.__log.push('klip:' + this.src.slice(0, 5)); setTimeout(() => this.onended && this.onended(), 5); return Promise.resolve(); };
});
await pg.goto('http://localhost:8811/index.html');
await pg.fill('input[aria-label="Nama pemain"]', 'Ali');
await pg.click('text=Seterusnya'); await pg.click('text=Seterusnya'); await pg.click('text=Jom Mula!');
await pg.waitForSelector('.mode-card');
const sentence = man.clips[keys[0]] && keys[0];
const run = async (text) => pg.evaluate(async (t) => { window.__log = []; await window.__dc.speak(t); return window.__log; }, text);
let log = await run(`${sentence} Ini ayat tanpa rakaman.`);
ok(log[0] === 'klip:blob:', `ayat berklip dimainkan daripada fail audio (${sentence})`);
ok(log.length === 1, 'lalai "rakaman sahaja": ayat tanpa klip senyap (tiada suara peranti)');
await pg.evaluate(() => { window.__dc.getState().settings.voiceEngine = 'peranti'; });
log = await run(sentence);
ok(log.length === 1 && log[0].startsWith('tts:'), 'tetapan "Suara peranti" menggunakan suara telefon');
ok(errs.length === 0, 'tiada ralat JavaScript ' + errs.join(' | '));
await b.close(); srv.kill();
console.log(fails ? `\n✗ ${fails} kegagalan` : '\n✓ Ujian pakej suara lulus');
process.exit(fails ? 1 : 0);
