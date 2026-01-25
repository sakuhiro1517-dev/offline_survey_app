// Offline Survey (minimal) - ZIP export fixed (v1.2)
// - 音声入力なし
// - ZIPダウンロードが 0KB になりやすい端末向けに、a要素append + 遅延revoke を実施
// - ZIP内: records.csv(UTF-8 BOM) + photos/ に画像
// 依存: なし（自前ZIP: store方式）

const logEl = document.getElementById("log");
const photoEl = document.getElementById("photo");
const btnSave = document.getElementById("save");
const btnExport = document.getElementById("export");

function log(s){
  logEl.textContent += s + "\n";
}

const records = []; // {name, blob, ts}

function pad2(n){ return String(n).padStart(2,"0"); }
function tsName(d){
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

btnSave.onclick = async () => {
  const f = photoEl.files && photoEl.files[0];
  if (!f) { alert("写真を選んでください"); return; }
  const d = new Date();
  const name = tsName(d) + ".jpg";
  records.push({name, blob: f, ts: d.toISOString()});
  photoEl.value = "";
  log("saved: " + name + " (records=" + records.length + ")");
};

// --------- ZIP (store) ----------
function u32(n){ return new Uint8Array([n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255]); }
function u16(n){ return new Uint8Array([n&255,(n>>8)&255]); }
function strU8(s){ return new TextEncoder().encode(s); }
function concatU8(parts){
  const len = parts.reduce((a,b)=>a+b.length,0);
  const out = new Uint8Array(len);
  let off=0;
  for (const p of parts){ out.set(p, off); off += p.length; }
  return out;
}

function makeZip(files){
  // files: [{name, data(Uint8Array)}]
  let offset = 0;
  const locals = [];
  const centrals = [];

  for (const f of files){
    const nameU8 = strU8(f.name);
    const data = f.data;

    const lh = concatU8([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(data.length), u32(data.length),
      u16(nameU8.length), u16(0), nameU8
    ]);
    locals.push(lh, data);

    const ch = concatU8([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(data.length), u32(data.length),
      u16(nameU8.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameU8
    ]);
    centrals.push(ch);

    offset += lh.length + data.length;
  }

  const central = concatU8(centrals);
  const end = concatU8([
    u32(0x06054b50), u16(0), u16(0),
    u16(files.length), u16(files.length),
    u32(central.length), u32(offset), u16(0)
  ]);

  return concatU8([...locals, central, end]);
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);

  // iOS対策: DOMに入れてから遅延クリック
  requestAnimationFrame(() => {
    setTimeout(() => {
      a.click();
      // revokeを急ぐと0KBになりやすい端末があるので遅らせる
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 5000);
    }, 50);
  });
}

btnExport.onclick = async () => {
  if (records.length === 0) { alert("0件"); return; }

  // CSV (UTF-8 BOM) : photo, ts
  const header = "photo,ts";
  const lines = [header, ...records.map(r => `${r.name},${r.ts}`)];
  const csvText = "\uFEFF" + lines.join("\r\n");
  const csvU8 = strU8(csvText);

  const files = [];
  files.push({ name: "records.csv", data: csvU8 });

  for (const r of records){
    const ab = new Uint8Array(await r.blob.arrayBuffer());
    files.push({ name: "photos/" + r.name, data: ab });
  }

  const zipU8 = makeZip(files);
  const blob = new Blob([zipU8], { type: "application/zip" });

  log("ZIP size: " + blob.size + " bytes");
  if (blob.size < 200) {
    alert("ZIPが小さすぎます（失敗の可能性）。端末/ブラウザを変えて再試行してください。");
  }

  const fname = "export_" + new Date().toISOString().slice(0,10) + ".zip";
  downloadBlob(blob, fname);
};
