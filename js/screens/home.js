// Halaman utama, pendaftaran profil pertama & pemilihan profil
import { h, emo, later } from '../ui.js';
import { modeArt } from '../data/modeart.js';
import { go } from '../nav.js';
import { profile, getState, settings, addProfile, switchProfile, levelsDone, highestUnlocked, playerLevel, todayPlaySeconds, PANGGILAN, callOf } from '../store.js';
import { MODE_LIST, MODES } from '../modes/index.js';
import { AVATARS, CHARACTERS, DOA } from '../data/content.js';
import { icon } from '../icons.js';
import { avatarEl, statPills, guide, parentGate } from './shared.js';
import { dailySet } from './daily.js';
import { speak, sfx, voicePack, hasClip } from '../audio.js';
import { limitSeconds } from './timeout.js';
import { DEMO, DEMO_MAX, SALES_URL } from '../demo.js';
import { BRAND, brandLogo, shade } from '../brand.js';
import { EXTRAS, SHELVES, ALL_IDS, gameInfo, openGame, gameArt, isOff, lockIc } from './catalog.js';
import { recommend, REASONS } from '../recommend.js';
import { pathHeroInfo, startNode, DOMAINS } from './path.js';

const greet = (name) => {
  const hr = new Date().getHours();
  const t = hr < 12 ? 'Selamat pagi' : hr < 15 ? 'Selamat tengah hari' : hr < 19 ? 'Selamat petang' : 'Selamat malam';
  const nm = name ? `, ${name}` : '';
  if (settings().islamic !== false) return `Assalamualaikum${nm}! ${t}. Jom belajar sambil bermain!`;
  return `${t}${nm}! Jom belajar sambil bermain!`;
};

// Logo BIJAKU
function logoH1() {
  return h('h1', { class: 'bj-h1' }, brandLogo({ size: 'lg' }));
}

// Doa Hari Ini: bertukar setiap hari, hanya doa sahih daripada senarai DOA (dengan sumber)
function doaCard() {
  const list = DOA.filter((d) => !d.dupOf);
  const day = Math.floor(Date.now() / 86400000);
  const d = list[day % list.length];
  return h('button', { class: 'doa-card', type: 'button', 'aria-label': `Doa hari ini: ${d.sit}`, onclick: () => { sfx.tap(); speak(`Doa ${d.sit.toLowerCase()}. Maksudnya, ${d.makna}.`, { mood: 'tenang' }); } },
    h('div', { class: 'doa-top' }, h('span', { class: 'emo' }, '🤲'), h('b', {}, 'Doa Hari Ini'), h('span', { class: 'doa-sit' }, d.sit)),
    h('div', { class: 'doa-ar', dir: 'rtl', lang: 'ar' }, d.ar),
    h('div', { class: 'doa-rumi' }, d.rumi),
    h('div', { class: 'doa-makna' }, `“${d.makna}”`),
    h('div', { class: 'doa-src' }, `Sumber: ${d.src} · tekan untuk dengar maksud`));
}

// Cadangan permainan seterusnya: mod terakhir dimainkan atau mod pertama yang belum selesai
export function nextPlay(p) {
  const enabled = MODE_LIST.filter((m) => !settings().disabledModes.includes(m.id));
  const recent = Object.entries(p.modes).filter(([id]) => enabled.find((m) => m.id === id)).sort((a, b) => (b[1].plays || 0) - (a[1].plays || 0));
  const m = recent.length ? MODES[recent[0][0]] : enabled[0];
  if (!m) return null;
  let L = Math.min(highestUnlocked(p, m.id), DEMO ? DEMO_MAX : 50);
  if (levelsDone(p, m.id) >= 50) {
    const other = enabled.find((x) => levelsDone(p, x.id) < 50);
    if (other) return { m: other, L: highestUnlocked(p, other.id) };
    L = 50;
  }
  return { m, L };
}

export function homeScreen() {
  const p = profile();
  if (!p) { setTimeout(() => go('/profil'), 0); return h('div'); }
  const lv = playerLevel(p);
  const d = dailySet(p);
  const scr = h('div', { class: 'screen bj-home' }, h('div', { class: 'bj-stage', 'aria-hidden': 'true' }));
  later(() => { const g = greet(callOf(p)); speak(settings().voiceEngine === 'peranti' || hasClip(g) ? g : greet('')); }, 400);
  if (!pathHeroInfo(p).st.cur) later(() => speak('Tekan butang Mula untuk memulakan Laluan Bijak!'), 3200);

  // ---- kepala: logo, bintang, pemain ----
  scr.appendChild(h('header', { class: 'bj-top' },
    brandLogo({ size: 'md' }),
    h('div', { class: 'bj-top-r' },
      h('span', { class: 'bj-pill', title: 'Bintang' }, icon('star'), h('b', {}, p.stars)),
      h('span', { class: 'bj-pill hide-xs', title: 'Syiling' }, icon('coin'), h('b', {}, p.coins)),
      h('button', { class: 'player-card bj-me', type: 'button', 'aria-label': 'Tukar profil', onclick: () => { sfx.tap(); go('/profil'); } },
        avatarEl(p),
        h('span', { class: 'bj-me-txt' }, h('b', { class: 'player-name' }, p.name), h('span', { class: 'lvl-bar' }, h('i', { style: { width: `${Math.round((lv.into / lv.need) * 100)}%` } })), h('small', {}, `Level ${lv.lvl}`))))));
  if (DEMO) scr.appendChild(h('div', { class: 'bj-demo' },
    h('b', {}, `Versi Demo · ${DEMO_MAX} level pertama setiap permainan`),
    h('a', { class: 'btn small green', href: SALES_URL, target: '_top', style: { textDecoration: 'none' } }, 'Dapatkan versi penuh')));

  // ---- banner bergerak: sambung bermain + permainan istimewa ----
  // Laluan Bijak: satu butang "Mula" yang jelas — jawapan kepada "nak mula dari mana?"
  const lp = pathHeroInfo(p);
  const slides = [];
  if (lp.node) {
    const nd = lp.node, dc = DOMAINS[nd.dom].c;
    const art = MODES[nd.g] ? (() => { const a = modeArt(MODES[nd.g]); a.classList.add('bj-slide-art'); return a; })() : h('img', { class: 'bj-slide-art', src: EXTRAS[nd.g]?.img || '', alt: '' });
    slides.push(h('button', { class: 'bj-slide bj-cont bj-lpslide', type: 'button', style: `--a:${shade(dc, 0.2)};--b:${shade(dc, -0.1)};--d:${shade(dc, -0.42)}`, 'aria-label': `Laluan Bijak langkah ${lp.step}: ${lp.name}`, onclick: () => { sfx.tap(); startNode(nd); } },
      h('span', { class: 'bj-slide-txt' },
        h('small', {}, `LALUAN BIJAK · LANGKAH ${lp.step}`),
        h('b', {}, lp.st.todayCount >= lp.st.goal ? `Hebat, ${p.name}!` : `Jom belajar, ${p.name}!`),
        h('span', { class: 'bj-sub' }, `${lp.name} · ${DOMAINS[nd.dom].n}`),
        h('span', { class: 'bj-go' }, icon('play'), 'Mula')),
      art));
  }
  ['akhlak', 'lumba', 'silang'].forEach((id) => {
    const g = EXTRAS[id];
    const off = isOff(id);
    slides.push(h('button', { class: `bj-slide rc-entry ${g.cls} ${off ? 'locked' : ''}`, type: 'button', 'aria-label': g.n, style: `--a:${g.bg[0]};--b:${g.bg[1]};--d:${g.bg[2]}`, onclick: () => openGame({ ...g, extra: true }) },
      h('span', { class: 'bj-slide-txt' },
        h('small', {}, off ? 'DIKUNCI' : 'BAHARU'),
        h('b', {}, g.n),
        h('span', { class: 'bj-sub' }, g.sub),
        h('span', { class: 'bj-go' }, icon('play'), 'Jom')),
      h('img', { class: 'bj-slide-art', src: g.img, alt: '' }),
      off ? lockIc() : null));
  });
  // permainan baharu Fasa 2+: satu slaid, bertukar setiap hari
  const newIds = Object.keys(EXTRAS).filter((id) => EXTRAS[id].isNew);
  if (newIds.length) {
    const g = EXTRAS[newIds[Math.floor(Date.now() / 86400000) % newIds.length]];
    const off = isOff(g.id);
    slides.splice(1, 0, h('button', { class: `bj-slide bj-newgame ${off ? 'locked' : ''}`, type: 'button', 'aria-label': g.n, style: `--a:${g.bg[0]};--b:${g.bg[1]};--d:${g.bg[2]}`, onclick: () => openGame({ ...g, extra: true }) },
      h('span', { class: 'bj-slide-txt' }, h('small', {}, off ? 'DIKUNCI' : `BAHARU · ${newIds.length} permainan`), h('b', {}, g.n), h('span', { class: 'bj-sub' }, g.sub), h('span', { class: 'bj-go' }, icon('play'), 'Jom')),
      h('img', { class: 'bj-slide-art', src: g.img, alt: '' }), off ? lockIc() : null));
  }
  const track = h('div', { class: 'bj-track' }, slides);
  const dots = h('div', { class: 'bj-dots', 'aria-hidden': 'true' }, slides.map((_, i) => h('i', { class: i ? '' : 'on' })));
  scr.appendChild(h('section', { class: 'bj-hero' }, track, dots));
  let cur = 0, touched = false;
  const setDot = () => { cur = Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); [...dots.children].forEach((x, i) => x.classList.toggle('on', i === cur)); };
  track.addEventListener('scroll', setDot, { passive: true });
  ['pointerdown', 'wheel', 'touchstart'].forEach((ev) => track.addEventListener(ev, () => { touched = true; }, { passive: true }));
  if (!navigator.webdriver) {
    const timer = setInterval(() => {
      if (!track.isConnected) { clearInterval(timer); return; }
      if (touched || document.hidden) return;
      track.scrollTo({ left: ((cur + 1) % slides.length) * track.clientWidth, behavior: 'smooth' });
    }, 5000);
  }

  // ---- matlamat harian ----
  {
    const st = lp.st, done = st.todayCount >= st.goal;
    scr.appendChild(h('button', { class: `bj-goal ${done ? 'done' : ''}`, type: 'button', onclick: () => { sfx.tap(); go('/laluan'); } },
      h('span', { class: 'bj-goal-ic' }, done ? '🏆' : '🎯'),
      h('span', { class: 'bj-goal-t' }, h('b', {}, done ? 'Matlamat hari ini tercapai!' : `Matlamat hari ini: ${st.todayCount}/${st.goal} langkah`), h('small', {}, done ? 'Bebas main apa sahaja!' : 'Ikut Laluan Bijak · 10–15 minit')),
      h('span', { class: 'bj-goal-dots' }, ...Array.from({ length: st.goal }, (_, i) => h('i', { class: i < st.todayCount ? 'on' : '' }))),
      h('span', { class: 'bj-goal-fire' }, '🔥', h('b', {}, p.streak?.count || 0))));
  }
  // ---- butang pantas ----
  const dailyLeft = 5 - d.done.length;
  const quick = (cls, ic, label, onclick, badge = null) => h('button', { class: `bj-quick ${cls}`, type: 'button', onclick: () => { sfx.tap(); onclick(); } }, h('span', { class: 'bj-q-ic' }, icon(ic), badge), h('span', {}, label));
  scr.appendChild(h('nav', { class: 'bj-quicks', 'aria-label': 'Pintasan' },
    quick('q-orange', 'calendar', 'Cabaran Harian', () => go('/harian'), dailyLeft ? h('span', { class: 'badge' }, dailyLeft) : h('span', { class: 'badge ok' }, '✓')),
    quick('q-blue', 'map', 'Laluan', () => go('/laluan')),
    quick('q-yellow', 'trophy', 'Trofi', () => go('/trofi')),
    quick('q-pink', 'kain', 'Kostum', () => go('/kedai')),
    quick('q-green', 'wau', 'Main Bebas', () => go('/bebas'))));

  // ---- cadangan bercahaya (ikut rekod permainan anak) ----
  const recs = recommend(p, ALL_IDS.filter((id) => !isOff(id)));
  const recIds = new Set(recs.map((r) => r.id));
  if (recs.length) {
    scr.appendChild(h('section', { class: 'bj-recs', 'aria-label': 'Cadangan untuk kamu' },
      h('h2', { class: 'bj-recs-t' }, h('span', { class: 'bj-recs-spark', 'aria-hidden': 'true' }, '✨'), 'Cadangan untuk kamu'),
      h('div', { class: 'bj-recs-row' }, ...recs.map(({ id, why }, i) => {
        const g = gameInfo(id, p);
        const style = `--c:${g.c};--a:${shade(g.c, 0.22)};--b:${shade(g.c, -0.08)};--d:${shade(g.c, -0.4)};--i:${i}`;
        return h('button', { class: `bj-rec why-${why}`, type: 'button', style, 'aria-label': `${REASONS[why].t}: ${g.n}`, onclick: () => openGame(g) },
          h('span', { class: 'bj-rec-why' }, h('span', { class: 'emo' }, REASONS[why].e), REASONS[why].t),
          h('span', { class: 'bj-tile-art' }, gameArt(g)),
          h('span', { class: 'name' }, g.n));
      }))));
  }

  // ---- rak kategori ----
  SHELVES.forEach((s) => {
    const row = h('div', { class: 'bj-shelf-row' });
    s.ids.forEach((id) => {
      const g = gameInfo(id, p);
      const off = isOff(id);
      const style = `--c:${g.c};--a:${shade(g.c, 0.22)};--b:${shade(g.c, -0.08)};--d:${shade(g.c, -0.4)}`;
      if (g.extra) {
        row.appendChild(h('button', { class: `bj-tile bj-xtile ${off ? 'locked' : ''} ${recIds.has(id) ? 'bj-glow' : ''}`, type: 'button', style, 'aria-label': g.n, onclick: () => openGame(g) },
          h('span', { class: 'bj-new' }, off ? 'DIKUNCI' : 'BAHARU'),
          h('span', { class: 'bj-tile-art' }, gameArt(g)), h('span', { class: 'name' }, g.n), h('span', { class: 'meta' }, icon('play'), 'Jom main'), off ? lockIc() : null));
        return;
      }
      row.appendChild(h('button', { class: `bj-tile mode-card ${off ? 'locked' : ''} ${recIds.has(id) ? 'bj-glow' : ''}`, type: 'button', style: `${style};--p:${Math.round((g.done / 50) * 100)}`, 'aria-label': `${g.n}, ${g.done} daripada 50 level`, onclick: () => openGame(g) },
        g.done >= 50 ? h('span', { class: 'done-badge' }, icon('medal')) : null,
        h('span', { class: 'bj-tile-art' }, gameArt(g)),
        h('span', { class: 'name' }, g.n),
        h('span', { class: 'meta' }, h('span', { class: 'bj-prog' }, h('i', { style: { width: `${Math.round((g.done / 50) * 100)}%` } })), `${g.done}/50`),
        off ? lockIc() : null));
    });
    scr.appendChild(h('section', { class: 'bj-shelf' }, h('h2', { class: 'bj-shelf-t' }, s.t, h('small', {}, `${s.ids.length} permainan`)), row));
  });

  if (settings().islamic !== false) scr.appendChild(doaCard());
  const lim = limitSeconds(p);
  scr.appendChild(h('div', { class: 'parent-row bj-parent' },
    lim !== Infinity ? h('span', { class: 'time-chip' }, '⏰', `Baki masa hari ini: ${Math.max(0, Math.round((lim - todayPlaySeconds(p)) / 60))} minit`) : null,
    h('button', { class: 'tile-btn parent-link', type: 'button', onclick: () => { sfx.tap(); parentGate(() => go('/ibubapa/ringkasan')); } }, h('span', { class: 'tb-ico' }, icon('parent')), 'Ruang Ibu Bapa')));
  scr.appendChild(h('footer', { class: 'bj-foot' }, brandLogo({ size: 'sm' }), h('p', {}, `${BRAND.tagline}`), h('p', {}, 'Tiada iklan · tiada sembang · data disimpan dalam peranti ini sahaja')));
  scr.appendChild(tabBar('main'));
  return scr;
}

// Bar tab bawah (Utama · Dunia · Trofi · Ibu Bapa)
export function tabBar(on) {
  const t = (id, ic, label, fn) => h('button', { class: `bj-tab ${on === id ? 'on' : ''}`, type: 'button', 'aria-current': on === id ? 'page' : null, onclick: () => { sfx.tap(); fn(); } }, h('span', { class: 'bj-tab-ic' }, icon(ic)), h('span', {}, label));
  return h('nav', { class: 'bj-tabs', 'aria-label': 'Menu utama' },
    t('main', 'home', 'Utama', () => go('/')),
    t('laluan', 'map', 'Laluan', () => go('/laluan')),
    t('dunia', 'grid', 'Dunia', () => go('/dunia')),
    t('trofi', 'trophy', 'Koleksi', () => go('/trofi')),
    t('ibubapa', 'parent', 'Ibu Bapa', () => parentGate(() => go('/ibubapa/ringkasan'))));
}

// ---------------- PENDAFTARAN PERTAMA ----------------
export function onboardingScreen({ addMode = false } = {}) {
  let step = 0, name = '', age = 4, avatar = 'mimi', call = 'adik';
  const scr = h('div', { class: 'screen' });
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px', alignItems: 'center', textAlign: 'center' } });
  if (DEMO) scr.appendChild(h('div', { class: 'panel', style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'center', textAlign: 'center' } },
    h('b', {}, `🎮 Versi Demo · ${DEMO_MAX} level pertama setiap permainan`),
    h('a', { class: 'btn small green', href: SALES_URL, target: '_top', style: { textDecoration: 'none' } }, 'Dapatkan versi penuh')));
  scr.appendChild(h('div', { class: 'logo' }, logoH1(), h('p', {}, 'Belajar Sambil Bermain, Bijak Sambil Meneroka.')));
  scr.appendChild(body);
  const render = () => {
    body.replaceChildren();
    if (step === 0) {
      body.append(
        h('div', { style: { fontSize: '64px' } }, CHARACTERS.map((c) => h('span', { class: 'emo float', 'data-avatar': c.id, style: { display: 'inline-block', animationDelay: Math.random() + 's' } }, c.e))),
        h('div', { class: 'guide', style: { maxWidth: '560px' } }, h('div', { class: 'bubble' }, 'Hai! Kami Mimi, Bobo, Coco, Dino dan Lala. Siapa nama kamu?', h('small', {}, 'Ibu bapa boleh bantu menaip nama anak.'))),
        (() => {
          const inp = h('input', { type: 'text', maxlength: '16', placeholder: 'Nama', 'aria-label': 'Nama pemain', value: name, style: { fontSize: '30px', textAlign: 'center', padding: '14px', borderRadius: '22px', border: '4px solid #e1d8ef', width: 'min(360px, 90vw)', fontWeight: 900 } });
          inp.addEventListener('input', () => { name = inp.value.trim(); nextBtn.disabled = !name; });
          setTimeout(() => inp.focus(), 50);
          return inp;
        })(),
        nextBtn,
        addMode ? null : h('button', { class: 'btn small ghost', type: 'button', style: { marginTop: '6px' }, onclick: () => parentGate(() => go('/ibubapa/tetapan'), { reason: 'Pindah kemajuan dari peranti lain melalui fail sandaran.' }) }, '📲 Pindah dari peranti lain? Pulihkan sandaran'));
      nextBtn.disabled = !name;
      speak('Hai! Siapa nama kamu?');
    } else if (step === 1) {
      body.append(
        h('div', { class: 'guide' }, h('div', { class: 'bubble' }, `Hai ${name}! Berapa umur kamu?`)),
        h('div', { class: 'row-wrap' }, [3, 4, 5, 6].map((a) => h('button', { class: `btn big ${a === age ? 'green' : 'ghost'}`, type: 'button', onclick: () => { age = a; sfx.tap(); render(); } }, `${a} tahun`))),
        h('div', { class: 'guide' }, h('div', { class: 'bubble' }, 'Kamu suka dipanggil apa?', h('small', {}, 'Aplikasi akan memanggil anak dengan panggilan ini (nama tidak disebut).'))),
        h('div', { class: 'row-wrap call-pick' }, PANGGILAN.map((c) => h('button', { class: `btn ${c.id === call ? 'green' : 'ghost'}`, type: 'button', 'data-call': c.id, onclick: () => { call = c.id; sfx.tap(); speak(`Hai ${c.s || c.n}!`); render(); } }, emo(c.e), c.n))),
        nextBtn);
      nextBtn.disabled = false;
      speak('Berapa umur kamu? Kamu suka dipanggil apa?');
    } else {
      body.append(
        h('div', { class: 'guide' }, h('div', { class: 'bubble' }, 'Pilih kawan bermain kamu!')),
        h('div', { class: 'grid-coll', style: { width: '100%', maxWidth: '640px' } }, AVATARS.filter((a) => a.cost === 0).map((a) => h('button', { class: `coll-item ${a.id === avatar ? 'on' : ''}`, type: 'button', onclick: () => { avatar = a.id; sfx.tap(); speak(CHARACTERS.find((c) => c.id === a.id)?.n || a.n); render(); } }, h('span', { class: 'emo', 'data-avatar': a.id }, a.e), h('span', { class: 'lbl' }, CHARACTERS.find((c) => c.id === a.id)?.n || a.n)))),
        h('button', { class: 'btn big green', type: 'button', onclick: () => {
          const np = addProfile({ name, age, avatar, call });
          sfx.win();
          speak(`Selamat datang ke ${BRAND.say}, ${callOf(np)}!`);
          go('/');
        } }, emo('🚀'), 'Jom Mula!'));
      if (!addMode) speak('Pilih kawan bermain kamu!');
    }
  };
  const nextBtn = h('button', { class: 'btn big', type: 'button', onclick: () => { step++; sfx.tap(); render(); } }, 'Seterusnya ➜');
  render();
  return scr;
}

// ---------------- PILIH PROFIL ----------------
export function profilesScreen() {
  const st = getState();
  const scr = h('div', { class: 'screen' });
  scr.appendChild(h('div', { class: 'topbar' }, h('button', { class: 'btn-round', type: 'button', 'aria-label': 'Kembali', onclick: () => go('/') }, '⬅️'), h('div', { class: 'title' }, 'Siapa yang bermain?'), h('div', { class: 'spacer' })));
  scr.appendChild(h('div', { class: 'grid-coll' }, st.profiles.map((p) => h('button', { class: `coll-item ${p.id === st.currentId ? 'on' : ''}`, type: 'button', style: { padding: '18px 8px' }, onclick: () => { switchProfile(p.id); sfx.tap(); speak(`Hai ${callOf(p)}!`); go('/'); } },
    avatarEl(p), h('span', { class: 'lbl', style: { fontSize: '18px' } }, p.name), h('span', { class: 'lbl muted' }, `⭐ ${p.stars}`)))));
  scr.appendChild(h('div', { class: 'row-wrap' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => parentGate(() => go('/ibubapa/profil'), { reason: 'Profil baharu ditambah melalui Ruang Ibu Bapa.' }) }, emo('➕'), 'Tambah profil (ibu bapa)')));
  return scr;
}
