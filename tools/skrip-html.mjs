// Jana halaman salin (gaya studio/skrip.html) daripada folder skrip NN.txt
//   node tools/skrip-html.mjs rakaman/baki-30 studio/skrip-30.html "Skrip lama 30 bahagian"
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const [dir, out, label] = process.argv.slice(2);
const parts = readdirSync(dir).filter((f) => /^\d+\.txt$/.test(f)).sort().map((f) => {
  const txt = readFileSync(`${dir}/${f}`, 'utf8');
  const n = readFileSync(`${dir}/${f.replace('.txt', '.kunci.txt')}`, 'utf8').trim().split('\n').length;
  return { id: f.replace('.txt', ''), txt, n };
});
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const total = parts.reduce((s, p) => s + p.txt.length, 0);
const key = `dc-skrip-siap-${dir.replace(/\W+/g, '-')}`;
writeFileSync(out, `<!doctype html>
<html lang="ms"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${label}</title>
<style>
:root{--ink:#2b2350;--bg:#f3f0fa}*{box-sizing:border-box}body{margin:0;font-family:"Baloo 2","Nunito",system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{padding:14px 16px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.08);position:sticky;top:0;z-index:2}h1{margin:0;font-size:22px}p{margin:4px 0 0;color:#6b628c;font-size:14px}
main{max-width:900px;margin:0 auto;padding:12px 16px 60px;display:grid;gap:10px}
.part{background:#fff;border-radius:18px;padding:12px 14px;box-shadow:0 2px 0 rgba(43,35,80,.08);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.part.done{opacity:.55}.part b{font-size:20px;min-width:110px}.part span{flex:1;color:#6b628c;font-size:14px}
button{font:inherit;font-weight:700;border:0;border-radius:14px;padding:9px 14px;cursor:pointer}.copy{background:#7048e8;color:#fff}.see{background:#ece6fa;color:var(--ink)}.tick{background:#fff;border:2px solid #d9d3ea}
pre{width:100%;white-space:pre-wrap;background:#f8f6ff;border-radius:12px;padding:10px;max-height:260px;overflow:auto;display:none;margin:6px 0 0;font-size:13px}.part.open pre{display:block}
.warn{display:inline-block;background:#fff3bf;color:#8a5a00;font-weight:800;padding:4px 12px;border-radius:99px;margin-bottom:6px}
</style></head><body>
<header><div class="warn">ARKIB · untuk MP3 yang sudah dijana daripada set ini sahaja</div><h1>${label}: ${parts.length} bahagian</h1><p>${total.toLocaleString('ms')} aksara. Set terkini ialah studio/skrip.html. Import MP3 set ini dengan: python3 tools/potong-suara.py --auto --folder=${dir} 07.mp3 ...</p></header>
<main>${parts.map((p) => `<div class="part" data-id="${p.id}"><b>Bahagian ${p.id}</b><span>${p.n} ayat · ${p.txt.length} aksara</span><button class="copy" type="button">Salin</button><button class="see" type="button">Lihat</button><button class="tick" type="button">✓</button><pre>${esc(p.txt)}</pre></div>`).join('\n')}</main>
<script>
const K='${key}';const done=new Set(JSON.parse(localStorage.getItem(K)||'[]'));
document.querySelectorAll('.part').forEach((el)=>{const id=el.dataset.id;const txt=el.querySelector('pre').textContent;el.classList.toggle('done',done.has(id));
el.querySelector('.copy').onclick=async(e)=>{try{await navigator.clipboard.writeText(txt);e.target.textContent='Disalin ✓';}catch{el.classList.add('open');const r=document.createRange();r.selectNodeContents(el.querySelector('pre'));getSelection().removeAllRanges();getSelection().addRange(r);e.target.textContent='Pilih & salin';}setTimeout(()=>{e.target.textContent='Salin'},1600)};
el.querySelector('.see').onclick=()=>el.classList.toggle('open');
el.querySelector('.tick').onclick=()=>{done.has(id)?done.delete(id):done.add(id);el.classList.toggle('done',done.has(id));try{localStorage.setItem(K,JSON.stringify([...done]))}catch{}};});
</script></body></html>
`);
console.log(`${out}: ${parts.length} bahagian, ${total} aksara`);
