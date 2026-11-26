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

def norm(s):
    s = s.lower()
    s = re.sub(r'\d+', lambda m: ' ' + nombor(m.group()) + ' ', s)
    s = s.replace('-', ' ')
    s = re.sub(r"[^a-z\s]", ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

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
    res, p = [], 0
    for li, line in enumerate(lines):
        L = norm(line); n = max(1, len(L.split()))
        best = (0.0, None, None)
        for i in range(p, min(len(W), p + 45)):
            for m in range(max(1, n - 2), n + 4):
                if i + m > len(W): break
                c = ' '.join(wt[i:i + m])
                sc = SequenceMatcher(None, L, c).ratio() - (i - p) * 0.004
                if sc > best[0]: best = (sc, i, m)
        sc, i, m = best
        short = n <= 2
        ok = i is not None and (sc >= 0.62 or (short and sc >= 0.5))
        if ok:
            res.append({'k': li, 'ok': True, 'score': round(sc, 3), 'a': W[i][0], 'b': W[i + m - 1][1], 'heard': ' '.join(w[2].strip() for w in W[i:i + m]), 'i': i, 'm': m})
            p = i + m
        else:
            res.append({'k': li, 'ok': False, 'score': round(sc, 3), 'heard': ' '.join(w[2].strip() for w in W[i:i + m]) if i is not None else ''})
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
        words = list(range(wa, wb))
        if not words: continue
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
                lenok = abs(sum(wl[j0:j]) + (j - j0 - 1) - ln[t - 1]) / ln[t - 1] < 0.6
                if sim >= 0.3 or lenok:
                    r.update({'ok': True, 'filled': True, 'score': round(sim, 3), 'a': W[words[j0]][0], 'b': W[words[j - 1]][1], 'heard': ' '.join(W[words[q]][2].strip() for q in range(j0, j)), 'i': words[j0], 'm': j - j0})
            j = j0
    # titik potong akhir
    db = load_db(audio)
    good = [r for r in res if r['ok']]
    for q, r in enumerate(good):
        lo = good[q - 1]['b'] + 0.02 if q else 0
        hi = good[q + 1]['a'] - 0.02 if q + 1 < len(good) else len(db) / 100
        # jika ada perkataan Whisper (tidak dipadankan) di antara, jangan melepasinya
        a, b = snap(db, r['a'], r['b'], lo, hi)
        r['cut'] = [max(lo, a - 0.05), min(hi, b + 0.08)]
    nok = len(good)
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
