#!/usr/bin/env python3
# =====================================================================
#  PADAN TRANSKRIP: potong MP3 panjang ElevenLabs ikut transkrip sebenar
#  (Whisper, masa setiap perkataan), bukan anggaran tempoh.
#
#  1) Transkrip:  python asr-full.py AUDIO.mp3 asr.json   (faster-whisper 'small', language='ms')
#  2) Padan:      python3 tools/padan-transkrip.py SKRIP.txt AUDIO.mp3 asr.json [--tulis]
#
#  Setiap baris skrip dicari dalam transkrip (padanan kabur aksara, tetingkap bergerak).
#  Baris diterima hanya jika teks yang didengar sepadan dengan skrip (skor >= ambang);
#  baris salah sebut / tertinggal / berulang ditolak dan kekal dalam baki rakaman.
#  Titik potong: masa perkataan Whisper, dilaraskan ke tepi bunyi sebenar (tenaga audio).
#  Hasil laporan: rakaman/laporan-padanan.txt
# =====================================================================
import sys, re, json, os, hashlib, subprocess
from difflib import SequenceMatcher
import numpy as np

DIR = 'audio/ms-MY'
SATU = ['kosong', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'lapan', 'sembilan']

def nombor(n):
    n = int(n)
    if n < 10: return SATU[n]
    if n == 10: return 'sepuluh'
    if n == 11: return 'sebelas'
    if n < 20: return f'{SATU[n - 10]} belas'
    if n < 100: return f'{SATU[n // 10]} puluh' + (f' {SATU[n % 10]}' if n % 10 else '')
    if n < 1000: h = 'seratus' if n // 100 == 1 else f'{SATU[n // 100]} ratus'; return h + (f' {nombor(n % 100)}' if n % 100 else '')
    return str(n)

HURUF = {'a': 'ei', 'b': 'bi', 'c': 'si', 'd': 'di', 'e': 'i', 'f': 'ef', 'g': 'ji', 'h': 'heish', 'i': 'ai', 'j': 'jei', 'k': 'kei', 'l': 'el', 'm': 'em', 'n': 'en', 'o': 'o', 'p': 'pi', 'q': 'kiu', 'r': 'ar', 's': 'es', 't': 'ti', 'u': 'yu', 'v': 'vi', 'w': 'dabel yu', 'x': 'eks', 'y': 'wai', 'z': 'zed'}

def norm(s):
    s = s.lower()
    s = re.sub(r'\d+', lambda m: ' ' + nombor(m.group()) + ' ', s)
    s = s.replace('-', ' ')
    s = re.sub(r'\blv\b', 'level', s)
    s = re.sub(r"[^a-z\s]", ' ', s)
    s = ' '.join(HURUF.get(w, w) if len(w) == 1 else w for w in s.split())
    return re.sub(r'\s+', ' ', s).strip()

NUMW = {'kosong', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'lapan', 'sembilan', 'sepuluh', 'sebelas', 'belas', 'puluh', 'ratus', 'seratus', 'ribu', 'seribu'}
def numseq(s):
    return [w for w in s.split() if w in NUMW]
def same_num(line_norm, heard_norm):
    # nombor mesti sama persis (level, harga, kiraan); ayat tanpa nombor tidak terjejas
    return numseq(line_norm) == numseq(heard_norm)

def script_lines(path):
    out = []
    for raw in open(path, encoding='utf-8').read().split('\n'):
        l = raw.strip()
        if not l or re.fullmatch(r'\[[^\]]*pause[^\]]*\]', l, re.I): continue
        l = re.sub(r'\[[^\]]+\]\s*', '', l).strip()
        if l: out.append(l)
    return out

def clip_key(s):
    return re.sub(r'\s+', ' ', s.strip().lower())

def clip_id(key):
    return hashlib.sha1(key.encode('utf-8')).hexdigest()[:10]

def load_db(audio):
    x = np.frombuffer(subprocess.run(['ffmpeg', '-v', 'error', '-i', audio, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], capture_output=True, check=True).stdout, dtype=np.int16).astype(np.float32) / 32768
    hop = 160  # 10 ms
    n = len(x) // hop
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    return 20 * np.log10(rms + 1e-9)

def snap(db, a, b, lo, hi, thr=-42):
    # gerakan mula ke belakang & akhir ke hadapan ke tepi bunyi (tanpa melepasi jiran)
    fa, fb = int(a * 100), int(b * 100)
    lo_f, hi_f = int(lo * 100), int(hi * 100)
    i = fa
    while i > max(lo_f, fa - 30) and db[i - 1] > thr: i -= 1
    j = fb
    while j < min(hi_f, fb + 45, len(db) - 1) and db[j] > thr: j += 1
    return i / 100, j / 100

def main():
    script, audio, asrf = sys.argv[1:4]
    write = '--tulis' in sys.argv
    lines = script_lines(script)
    kunci = script[:-4] + '.kunci.txt'
    keys = [l.strip() for l in open(kunci, encoding='utf-8') if l.strip()] if os.path.exists(kunci) else lines
    assert len(keys) == len(lines), (len(keys), len(lines))
    W = json.load(open(asrf, encoding='utf-8'))['words']
    wt = [norm(w[2]) for w in W]
    # buang token kosong (tanda baca sahaja)
    idx = [k for k, t in enumerate(wt) if t]
    W = [W[k] for k in idx]; wt = [wt[k] for k in idx]
    from collections import defaultdict, Counter
    import bisect

    def place(LI, WI):
        """Padan senarai baris LI dengan perkataan WI (kedua-dua tersusun). Pulangkan {li: (i, m, skor)} dalam indeks global."""
        sw = [wt[j] for j in WI]
        tri = defaultdict(list)
        for j in range(len(sw) - 2): tri[(sw[j], sw[j + 1], sw[j + 2])].append(j)
        cand = []
        for q, li in enumerate(LI):
            T = norm(lines[li]).split()
            if len(T) < 3: continue
            votes = Counter()
            for o in range(len(T) - 2):
                for j in tri.get((T[o], T[o + 1], T[o + 2]), []): votes[j - o] += 1
            if not votes: continue
            st, v = votes.most_common(1)[0]
            if v >= max(1, (len(T) - 2) * 0.5) and list(votes.values()).count(v) == 1: cand.append((q, st, v))
        bw, pv = [0] * len(cand), [-1] * len(cand)
        for x in range(len(cand)):
            bw[x] = cand[x][2]
            for y in range(max(0, x - 400), x):
                if cand[y][0] < cand[x][0] and cand[y][1] < cand[x][1] and bw[y] + cand[x][2] > bw[x]: bw[x], pv[x] = bw[y] + cand[x][2], y
        anch = {}
        if cand:
            x = max(range(len(cand)), key=lambda z: bw[z])
            while x >= 0: anch[cand[x][0]] = cand[x][1]; x = pv[x]
        ak = sorted(anch)
        out, p = {}, 0
        for q, li in enumerate(LI):
            L = norm(lines[li]); n = max(1, len(L.split()))
            best = (0.0, None, None)
            nx = bisect.bisect_right(ak, q)
            limit = anch[ak[nx]] if nx < len(ak) else len(sw)
            rng = range(max(p, anch[q] - 3), min(len(sw), anch[q] + 4)) if q in anch else range(p, min(len(sw), limit, p + 60))
            for i in rng:
                for m in range(1, n + 4):
                    if i + m > len(sw): break
                    if WI[i + m - 1] - WI[i] != m - 1: break  # mesti perkataan bersebelahan dalam audio
                    c = ' '.join(sw[i:i + m])
                    # panjang ikut aksara ("23" = "dua puluh tiga"), bukan bilangan perkataan
                    if len(c) < 0.7 * len(L): continue
                    if len(c) > 1.45 * len(L) + 3: break
                    if not same_num(L, c): continue
                    sc = SequenceMatcher(None, L, c).ratio() - (i - p) * 0.004
                    if sc > best[0]: best = (sc, i, m)
            sc, i, m = best
            if i is not None and sc >= (0.82 if n <= 3 else 0.78):
                out[li] = (WI[i], m, sc); p = i + m
        return out

    # pusingan 1: semua baris; pusingan 2: baris yang belum diletakkan dalam audio yang belum digunakan
    # (susunan bahagian dalam audio mungkin berbeza daripada skrip)
    got = place(list(range(len(lines))), list(range(len(W))))
    print(f'pusingan 1: {len(got)} ayat')
    for rnd in (2, 3):
        used = set()
        for i, m, _ in got.values(): used.update(range(i, i + m))
        LI = [li for li in range(len(lines)) if li not in got]
        WI = [j for j in range(len(W)) if j not in used]
        more = place(LI, WI)
        got.update(more)
        print(f'pusingan {rnd}: +{len(more)} ayat')
        if not more: break
    # pusingan akhir: carian seluruh audio yang belum digunakan, hanya padanan yang sangat jelas & unik
    used = set()
    for i, m, _ in got.values(): used.update(range(i, i + m))
    added = 0
    for li in range(len(lines)):
        if li in got: continue
        L = norm(lines[li]); n = max(1, len(L.split()))
        if len(L) < 6: continue
        scores = []
        for i in range(len(W)):
            if i in used: continue
            for m in range(1, n + 3):
                if i + m > len(W) or any((i + q) in used for q in range(m)): break
                c = ' '.join(wt[i:i + m])
                if len(c) < 0.7 * len(L): continue
                if len(c) > 1.45 * len(L) + 3: break
                if not same_num(L, c): continue
                scores.append((SequenceMatcher(None, L, c).ratio(), i, m))
        if not scores: continue
        scores.sort(reverse=True)
        sc, i, m = scores[0]
        second = next((s2 for s2, i2, m2 in scores[1:] if abs(i2 - i) > 2), 0)
        if sc >= 0.85 and sc - second >= 0.04:
            got[li] = (i, m, sc); used.update(range(i, i + m)); added += 1
    print(f'pusingan akhir (carian penuh): +{added} ayat')
    res = []
    for li, line in enumerate(lines):
        if li in got:
            i, m, sc = got[li]
            res.append({'k': li, 'ok': True, 'score': round(sc, 3), 'a': W[i][0], 'b': W[i + m - 1][1], 'heard': ' '.join(w[2].strip() for w in W[i:i + m]), 'i': i, 'm': m})
        else:
            res.append({'k': li, 'ok': False, 'score': 0, 'heard': ''})
    # isi celah: ayat yang transkripnya kurang jelas (bunyi haiwan, nama huruf, sebutan lain)
    # diletakkan pada perkataan di antara dua ayat jiran yang sudah disahkan, ikut panjang ayat.
    k = 0
    while k < len(res):
        if res[k]['ok']: k += 1; continue
        s = k
        while k < len(res) and not res[k]['ok']: k += 1
        run = res[s:k]
        wa = res[s - 1]['i'] + res[s - 1]['m'] if s > 0 else 0
        wb = res[k]['i'] if k < len(res) else len(W)
        usedw = set()
        for r0 in res:
            if r0['ok']: usedw.update(range(r0['i'], r0['i'] + r0['m']))
        words = [j for j in range(wa, wb) if j not in usedw]
        if not words or wb - wa > 12 * (k - s) + 6: continue  # celah terlalu besar: susunan audio berbeza, jangan teka
        ln = [max(1, len(norm(lines[r['k']]))) for r in run]
        wl = [max(1, len(wt[j])) for j in words]
        nR, nW = len(run), len(words)
        # DP: bahagikan perkataan berturutan kepada nR kumpulan (boleh kosong), kos = beza panjang aksara
        INF = 1e9
        dp = [[INF] * (nW + 1) for _ in range(nR + 1)]; bk = [[0] * (nW + 1) for _ in range(nR + 1)]
        dp[0][0] = 0
        for t in range(1, nR + 1):
            for j in range(nW + 1):
                for j0 in range(max(0, j - 12), j + 1):
                    if dp[t - 1][j0] >= INF: continue
                    got = sum(wl[j0:j]) + max(0, j - j0 - 1)
                    c = dp[t - 1][j0] + (abs(got - ln[t - 1]) / ln[t - 1] if j > j0 else 3.0)
                    if c < dp[t][j]: dp[t][j], bk[t][j] = c, j0
        # perkataan berlebihan di hujung (bukan milik mana-mana ayat) dibenarkan dengan kos kecil
        jbest = min(range(nW + 1), key=lambda j: dp[nR][j] + (nW - j) * 0.4)
        j = jbest
        for t in range(nR, 0, -1):
            j0 = bk[t][j]; r = run[t - 1]
            if j > j0:
                cand = ' '.join(wt[words[q]] for q in range(j0, j))
                sim = SequenceMatcher(None, norm(lines[r['k']]), cand).ratio()
                onom = bool(re.search(r'(.)\1\1', lines[r['k']].lower())) and j - j0 <= 2  # bunyi: "Mooo!", "Aummm!"
                Ln = norm(lines[r['k']])
                full = len(cand) >= 0.75 * len(Ln)
                if (sim >= 0.75 and full and same_num(Ln, cand)) or onom:
                    r.update({'ok': True, 'filled': True, 'score': round(sim, 3), 'a': W[words[j0]][0], 'b': W[words[j - 1]][1], 'heard': ' '.join(W[words[q]][2].strip() for q in range(j0, j)), 'i': words[j0], 'm': j - j0})
            j = j0
    # titik potong akhir
    db = load_db(audio)
    good = sorted([r for r in res if r['ok']], key=lambda r: r['a'])  # jiran ikut masa dalam audio
    for q, r in enumerate(good):
        lo = good[q - 1]['b'] + 0.02 if q else 0
        hi = good[q + 1]['a'] - 0.02 if q + 1 < len(good) else len(db) / 100
        # jika ada perkataan Whisper (tidak dipadankan) di antara, jangan melepasinya
        a, b = snap(db, r['a'], r['b'], lo, hi)
        r['cut'] = [max(lo, a - 0.05), min(hi, b + 0.08)]
        if r['cut'][1] - r['cut'][0] < 0.15: r['ok'] = False; r['why'] = 'bertindih'  # tidak sah: jangan potong
    nok = sum(1 for r in res if r['ok'])
    nfill = sum(1 for r in res if r.get('filled'))
    rep = [f'{nok}/{len(lines)} ayat diletakkan ({nok - nfill} sepadan terus, {nfill} diisi antara jiran); {len(lines) - nok} tiada dalam audio\n']
    for r in res:
        if r.get('filled'): rep.append(f"ISI    {r['score']:.2f}  skrip: {lines[r['k']]}  |  didengar: {r['heard']}")
    for r in res:
        if not r['ok']: rep.append(f"TOLAK  {r['score']:.2f}  skrip: {lines[r['k']]}  |  didengar: {r['heard']}")
    open('rakaman/laporan-padanan.txt', 'w', encoding='utf-8').write('\n'.join(rep) + '\n')
    print(rep[0].strip())
    json.dump({'res': res, 'keys': keys, 'lines': lines}, open(asrf.replace('.json', '-padan.json'), 'w'), ensure_ascii=False)
    if not write: return
    cat = {}
    for it in json.load(open(f'{DIR}/catalog.json', encoding='utf-8'))['items']:
        cat[re.sub(r'[.!?]+$', '', it['key'])] = it['key']
    man = json.load(open(f'{DIR}/manifest.json', encoding='utf-8')); clips = man.get('clips') or {}
    total = 0
    for r in res:
        line = keys[r['k']]
        if re.search(r'\beic\b', lines[r['k']], re.I) or not r['ok']: continue
        base = re.sub(r'[.!?]+$', '', clip_key(line))
        key = cat.get(base, clip_key(line)); fid = clip_id(key)
        a, b = r['cut']
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{a:.3f}', '-to', f'{b:.3f}', '-i', audio, '-ac', '1', '-ar', '24000',
                        '-af', 'afade=t=in:d=0.02,areverse,afade=t=in:d=0.04,areverse,loudnorm=I=-16:TP=-1.5', '-b:a', '48k', f'{DIR}/{fid}.mp3'], check=True)
        clips[key] = f'{fid}.mp3'; total += 1
    man.update({'count': len(clips), 'clips': clips})
    json.dump(man, open(f'{DIR}/manifest.json', 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'{total} klip ditulis. Manifest: {len(clips)} ayat.')

if __name__ == '__main__':
    main()
