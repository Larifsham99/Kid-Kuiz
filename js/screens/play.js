// Skrin permainan: menjalankan pusingan level, maklum balas, bintang & ganjaran
import { h, emo, clear, sleep, toast, confetti, modal } from '../ui.js';
import { modeArt } from '../data/modeart.js';
import { go, onBack } from '../nav.js';
import { pauseMenu } from '../pause.js';
import { ENGINES } from '../engines/index.js';
import { MODES, generateLevel, makeRound, TIERS } from '../modes/index.js';
import { PRAISE, ENCOURAGE, ISLAMIC_PRAISE, ISLAMIC_ENCOURAGE } from '../data/content.js';
import { speak, stopSpeak, sfx, playSound, speakWord, haptic, voicePack, hasClip } from '../audio.js';
import { TALK, pick, echoable } from '../talk.js';
import { ribbon, selfieButton, praiseGate, breakStreak, getStreak, winBar } from '../cheer.js';
import { icon } from '../icons.js';
import { profile, settings, save, recordSkill, addActivity, modeProg, isUnlocked, callOf } from '../store.js';
import { awardLevel, addStars, checkBadges } from '../rewards.js';
import { guide, confirmBox } from './shared.js';
import { overLimit } from './timeout.js';
import { todayKey } from '../ui.js';
import { dailySet, DAILY_REWARD } from './daily.js';
import { demoLocked } from '../demo.js';
import { demoUpgrade } from './shared.js';
import { autoFit } from '../fit.js';

let active = null; // sesi aktif (untuk pembersihan dan ujian)
export function stopPlay() {
  if (active) { active.stop(); active = null; }
  stopSpeak();
}
export const currentSession = () => active;

const pickOf = (arr) => arr[Math.floor(Math.random() * arr.length)];
const later2 = (fn, ms) => setTimeout(() => { if (active) fn(); }, ms);
const islamic = () => settings().islamic !== false;
// Pujian & galakan: campuran ucapan biasa dan ucapan Islamik (jika dihidupkan)
const praiseText = () => (islamic() && Math.random() < 0.2 ? pick(ISLAMIC_PRAISE) : pick(PRAISE));
const encourageText = () => (islamic() && Math.random() < 0.35 ? pick(ISLAMIC_ENCOURAGE) : pick(ENCOURAGE));

// Animasi bintang terbang dari tengah pentas ke kaunter bintang
function flyStar(from, to, done) {
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const s = icon('star', 'fly-star');
  s.style.left = `${a.left + a.width / 2 - 23}px`;
  s.style.top = `${a.top + Math.min(a.height / 2, 200) - 23}px`;
  document.body.appendChild(s);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    s.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + Math.min(a.height / 2, 200))}px) scale(.55) rotate(360deg)`;
    s.style.opacity = '0.4';
  }));
  setTimeout(() => { s.remove(); done(); }, 780);
}

// Enjin sesi umum: menjalankan senarai pusingan dalam satu skrin
function session({ title, charId, color, rounds, onComplete, exitTo, tag }) {
  const p = profile();
  const st = settings();
  const scr = h('div', { class: 'screen play-fit' });
  const progress = h('div', { class: 'progress' }, rounds.map(() => h('i')));
  const replay = h('button', { class: 'btn-round rb-sky', type: 'button', 'aria-label': 'Dengar arahan semula' }, icon('sound'));
  const exitBtn = h('button', { class: 'btn-round rb-pause', type: 'button', 'aria-label': 'Jeda' }, icon('pause'));
  const starPill = h('span', { class: 'pill star-pill' }, icon('star'), h('b', {}, '0'));
  scr.appendChild(h('div', { class: 'play-head' }, exitBtn, h('div', { class: 'ph-mid' }, h('div', { class: 'play-title' }, title), progress), starPill, replay));
  const g = guide(charId, '');
  scr.appendChild(g.el);
  const stage = h('div', { class: 'stage' });
  if (color) stage.style.setProperty('--mc', color);
  scr.appendChild(stage);
  const unfit = autoFit(stage);

  let idx = 0, stars = 0, stopped = false, engine = null;
  let roundStart = 0, mistakes = 0, attempts = 0, totalMistakes = 0;
  let lastTick = Date.now();
  // kira masa bermain aktif setiap 5 saat
  const ticker = setInterval(() => {
    const now = Date.now();
    if (document.visibilityState === 'visible') {
      const dt = Math.min(10, (now - lastTick) / 1000);
      addActivity(p, { time: dt });
      if (tag) modeProg(p, tag).time += dt;
      save();
    }
    lastTick = now;
  }, 5000);

  const results = [];
  const api = {
    get dual() { return settings().lang === 'dual'; },
    sfx, playSound, speakWord,
    speak: (t) => speak(t),
    say: (t) => g.say(t),
    good(el, { quiet = false, silent = false, echo } = {}) {
      haptic(12);
      if (!silent) sfx.pick();
      if (!quiet) toast(praiseText(), 'good', '😊');
      // sebut semula pilihan yang betul (cth. jawapan berbilang): "Kucing!"
      const e = echoable(echo);
      if (e) speak(`${e}!`, { mood: 'pujian' });
    },
    bad(el, { soft = false, echo, hint = false } = {}) {
      mistakes++; attempts++; totalMistakes++;
      if (soft) { sfx.bump(); return mistakes; }
      haptic([30, 40, 30]);
      breakStreak();
      // salah kali pertama: bunyi "boing" lembut + goyang sahaja (tanpa ucapan);
      // salah berulang: pujukan ringkas atau petunjuk dengan suara
      sfx.boing();
      const tail = hint ? pick(TALK.hint) : pick(TALK.retry);
      if (mistakes < 2 && !hint) { toast(tail, 'try', '🤗'); return mistakes; }
      const msg = hint ? `${encourageText()} ${pick(TALK.hint)}` : encourageText();
      toast(msg, 'try', '🤗');
      g.say(msg, '', { voice: true, mood: 'galakan' });
      return mistakes;
    },
    finish({ echo } = {}) {
      if (stopped || api._done) return;
      clearTimeout(idleTimer);
      api._done = true;
      attempts++;
      const r = rounds[idx];
      const firstTry = mistakes === 0;
      const time = (Date.now() - roundStart) / 1000;
      results.push({ firstTry, mistakes, time, skill: r.skill });
      recordSkill(p, r.skill, { firstTry, attempts, time });
      addActivity(p, { rounds: 1 });
      stars++;
      addStars(p, 1);
      flyStar(stage, starPill, () => { starPill.querySelector('b').textContent = stars; starPill.classList.remove('bump'); void starPill.offsetWidth; starPill.classList.add('bump'); });
      haptic(25);
      progress.children[idx].className = 'ok';
      sfx.correct(); later2(() => sfx.zip(), 120);
      const praise = praiseText();
      toast(praise, 'good', '⭐');
      // sebut semula jawapan yang betul (pengukuhan isi pelajaran: "Kucing!");
      // suara pujian hanya sekali-sekala, selebihnya bunyi "yeay" (lihat praiseGate)
      const e = echoable(echo);
      const talk = praiseGate();
      if (!talk) { later2(() => sfx.yay(), 260); if (getStreak() >= 3) later2(() => sfx.streak(getStreak()), 620); }
      const line = talk ? (e ? `${e}! ${praise}` : praise) : e ? `${e}!` : '';
      if (talk && settings().voiceEngine !== 'peranti' && !hasClip(line)) later2(() => sfx.yay(), 260); // pujian belum dirakam
      const spoken = line ? speak(line, { mood: 'pujian' }) : Promise.resolve();
      confetti(12, ['⭐', '✨', '🌟']);
      save();
      // tunggu pujian habis (maksimum ~4 saat) supaya soalan seterusnya tidak memotongnya
      Promise.all([sleep(1300), Promise.race([spoken, sleep(4000)])]).then(() => { if (!stopped) next(); });
    },
    _done: false,
  };

  function runRound() {
    clear(stage);
    if (engine?.cleanup) engine.cleanup();
    const r = rounds[idx];
    [...progress.children].forEach((d, i) => { d.className = i < idx ? 'ok' : i === idx ? 'now' : ''; });
    mistakes = 0; attempts = 0; api._done = false;
    roundStart = Date.now();
    const isLast = idx === rounds.length - 1 && rounds.length > 1;
    const sub = isLast ? 'Pusingan terakhir!' : `Pusingan ${idx + 1} / ${rounds.length}`;
    // doa & kandungan agama dibaca dengan nada tenang
    const mood = String(r.skill || '').startsWith('soleh.') ? 'tenang' : 'arahan';
    // penyambung semula jadi antara soalan; mulakan level dengan Bismillah
    // penyambung antara soalan kini bunyi (desiran / gendang pusingan akhir), bukan ayat berulang
    let lead = '';
    if (idx === 0 && islamic()) { toast('Bismillah', 'good', '🤲'); lead = 'Bismillah.'; }
    else if (isLast) { sfx.lastRound(); toast('Pusingan terakhir!', 'good', '🥁'); }
    else if (idx > 0) sfx.whoosh();
    g.say(lead ? `${lead} ${r.say}` : r.say, sub, { mood });
    armIdle();
    const fn = ENGINES[r.type];
    try {
      engine = fn(stage, r, api) || {};
    } catch (e) {
      console.error(e);
      stage.appendChild(h('div', { class: 'center muted' }, 'Maaf, aktiviti ini tidak dapat dimuatkan. Mari teruskan!'));
      engine = {};
      setTimeout(() => api.finish(), 1200);
    }
  }
  // Pujukan lembut jika anak tidak menyentuh skrin terlalu lama (maksimum 2 kali setiap soalan)
  let idleTimer = null, idleCount = 0;
  function armIdle(reset = true) {
    clearTimeout(idleTimer);
    if (reset) idleCount = 0;
    idleTimer = setTimeout(() => {
      if (stopped || api._done || idleCount >= 2 || document.visibilityState !== 'visible') return;
      idleCount++;
      // kali pertama: ting-ting + ulang arahan sahaja; kali kedua: pujukan lembut
      sfx.ping();
      later2(() => g.say(idleCount === 1 ? rounds[idx].say : `${pick(TALK.idle)} ${rounds[idx].say}`, '', { mood: 'galakan' }), 450);
      armIdle(false);
    }, 16000);
  }
  stage.addEventListener('pointerdown', () => { if (!api._done) armIdle(false); });

  function next() {
    idx++;
    if (idx >= rounds.length) { finishAll(); return; }
    if (overLimit(p)) { go('/'); return; }
    runRound();
  }
  function finishAll() {
    clearInterval(ticker);
    if (engine?.cleanup) engine.cleanup();
    onComplete({ stars, results, totalMistakes, scr });
  }
  replay.addEventListener('click', () => { sfx.tap(); g.repeat(); });
  // jeda: butang ⏸ atau butang kembali telefon -> Sambung / Rumah / Peta / Mula semula
  const openPause = () => {
    if (stopped || api._done && idx >= rounds.length - 1) return false;
    clearTimeout(idleTimer);
    pauseMenu({ onResume: () => { if (!stopped && !api._done) armIdle(false); }, map: exitTo, restart: location.hash.slice(1) || null });
    return true;
  };
  exitBtn.addEventListener('click', () => { sfx.tap(); openPause(); });
  const unBack = onBack(openPause);
  const ses = {
    el: scr,
    stop() { stopped = true; unfit(); unBack(); clearInterval(ticker); clearTimeout(idleTimer); if (engine?.cleanup) engine.cleanup(); },
    // digunakan oleh ujian automatik untuk menyelesaikan pusingan
    async solveRound() { if (engine?.solve) await engine.solve(); },
    // jalan keluar jika berlaku ralat tidak dijangka dalam satu pusingan
    skip() { if (!stopped && !api._done) api.finish(); },
    get index() { return idx; },
    get rounds() { return rounds; },
  };
  active = ses;
  requestAnimationFrame(() => runRound());
  return ses;
}

// ------------------- LEVEL BIASA -------------------
export function playScreen(modeId, level) {
  const p = profile();
  const mode = MODES[modeId];
  if (demoLocked(level)) {
    setTimeout(() => { go('/mod/' + modeId); setTimeout(() => demoUpgrade(), 50); }, 0);
    return h('div', { class: 'screen' });
  }
  if (!isUnlocked(p, modeId, level) || settings().disabledModes.includes(modeId)) {
    setTimeout(() => go('/mod/' + modeId), 0);
    return h('div', { class: 'screen' });
  }
  const lvl = generateLevel(modeId, level);
  const tierInfo = TIERS[lvl.tier - 1];
  const title = [modeArt(mode, 'xs'), ` ${mode.n} · Level ${level}${lvl.special ? ' 🎁' : ''}`];
  const ses = session({
    title, charId: mode.char, color: mode.c, rounds: lvl.rounds, exitTo: '/mod/' + modeId, tag: modeId,
    onComplete: ({ stars, totalMistakes }) => {
      addActivity(p, { levels: 1 });
      const rewards = awardLevel(p, modeId, level, stars);
      showLevelDone({ p, mode, level, stars, rewards, totalMistakes, tierInfo, special: lvl.special });
    },
  });
  if (lvl.special) setTimeout(() => toast('Cabaran Khas! 🎁', 'good', '🌟'), 300);
  return ses.el;
}

function showLevelDone({ p, mode, level, stars, rewards, totalMistakes, special }) {
  sfx.win();
  confetti(40);
  const big = rewards.filter((r) => r.big);
  if (big.length) setTimeout(() => sfx.reward(), 900);
  // ucapan penutup yang ringkas & mesra; sekali-sekala sebut nama anak (hanya dengan suara peranti,
  // supaya suara kekal konsisten apabila pakej suara rakaman digunakan)
  const alh = settings().islamic !== false;
  const msg = totalMistakes === 0 ? pick(TALK.doneAll) : pick(TALK.done);
  const nl = pick(TALK.doneName(callOf(p)));
  const nameLine = (settings().voiceEngine === 'peranti' || hasClip(nl)) && Math.random() < 0.35 ? ` ${nl}` : '';
  speak(`${alh ? 'Alhamdulillah! ' : ''}${msg}${nameLine}`, { mood: 'pujian' });
  const content = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', alignItems: 'center' } },
    h('div', { class: 'win-head' },
      h('span', { class: 'emo float' }, special ? '🎁' : '🎉'),
      alh ? h('div', { class: 'win-alh' }, 'Alhamdulillah!') : null,
      ribbon(totalMistakes === 0 ? 'Hebat!' : pick(['Tahniah!', 'Syabas!', 'Bagus!', 'Terbaik!']), { sub: `Level ${level} Selesai!`, stars: totalMistakes === 0 ? 3 : totalMistakes <= 2 ? 2 : 1 })),
    h('p', {}, msg),
    selfieButton(`${mode.n} · Level ${level}`),
    h('div', { class: 'reward-list' }, rewards.map((r) => h('span', { class: 'pill', style: r.big ? { background: '#fff3c4' } : null }, r.e === '🪙' ? icon('coin') : emo(r.e), r.n))),
    rewards.find((r) => r.cert) ? h('button', { class: 'btn purple', type: 'button', onclick: () => { m.close(); go('/sijil/' + mode.id); } }, emo('📜'), 'Lihat sijil') : null,
    winBar({
      next: level < 50 ? () => { m.close(); go(`/main/${mode.id}/${level + 1}`); } : null,
      replay: () => { m.close(); go(`/main/${mode.id}/${level}`); },
      map: () => { m.close(); go('/mod/' + mode.id); },
    }));
  const m = modal(content, { dismissable: false });
}

// ------------------- CABARAN HARIAN -------------------
export function dailyPlayScreen(i) {
  const p = profile();
  const set = dailySet(p);
  const item = set.items[i];
  if (!item) { setTimeout(() => go('/harian'), 0); return h('div', { class: 'screen' }); }
  const mode = MODES[item.mode];
  const round = makeRound(item.mode, item.level, item.seed, item.gens);
  const ses = session({
    title: [modeArt(mode, 'xs'), ` Cabaran Harian ${i + 1}/5`], charId: mode.char, color: mode.c, rounds: [round], exitTo: '/harian', tag: null,
    onComplete: () => {
      const d = p.daily[todayKey()] || (p.daily[todayKey()] = { done: [], rewarded: false });
      if (!d.done.includes(i)) d.done.push(i);
      p.coins += 5;
      const all = d.done.length >= 5 && !d.rewarded;
      if (all) {
        d.rewarded = true;
        p.coins += DAILY_REWARD.coins;
        if (!p.stickers.includes(DAILY_REWARD.sticker(todayKey()))) p.stickers.push(DAILY_REWARD.sticker(todayKey()));
      }
      const badges = checkBadges(p);
      save();
      if (all) {
        sfx.reward(); confetti(50);
        speak(`${settings().islamic !== false ? 'Alhamdulillah! ' : 'Hebat! '}Semua cabaran hari ini selesai! Ini hadiah khas untuk kamu!`, { mood: 'pujian' });
        const m = modal(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' } },
          h('div', { class: 'emo float', style: { fontSize: '80px' } }, '🏅'),
          h('h2', {}, 'Cabaran Harian Selesai!'),
          h('div', { class: 'reward-list' }, h('span', { class: 'pill' }, emo('🪙'), `+${DAILY_REWARD.coins + 5} syiling`), h('span', { class: 'pill' }, emo(DAILY_REWARD.sticker(todayKey())), 'Pelekat khas'), badges.map((b) => h('span', { class: 'pill' }, emo(b.e), b.n))),
          h('button', { class: 'btn green big', type: 'button', onclick: () => { m.close(); go('/harian'); } }, 'Yeay!')), { dismissable: false });
      } else {
        sfx.win(); confetti(20);
        const here = location.hash;
        sleep(1200).then(() => { if (location.hash === here) go('/harian'); });
      }
    },
  });
  return ses.el;
}
