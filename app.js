const APP_VERSION = "v2.0";
console.log("Offline Survey", APP_VERSION);

// Offline Survey - full (v1.4)
// 追加:
// - 地点/調査項目: プルダウン(select)
// - CSV(地点,項目) を読み込んでリスト登録（端末内に保存）
// - 備考2 追加
// 既存:
// - Camera photo + GPS + memo
// - IndexedDB blob storage
// - ZIP export: records.csv (UTF-8 BOM) + photos/ images
// - Download 0KB対策: append + 遅延revoke

const $ = (id) => document.getElementById(id);

const els = {
  // list config
  listCsvInput: $("listCsvInput"),
  btnClearLists: $("btnClearLists"),
  listStatus: $("listStatus"),
  selLocation: $("selLocation"),
  selLocation2: $("selLocation2"),
  selItem: $("selItem"),

  // capture
  photoInput: $("photoInput"),
  btnGeo: $("btnGeo"),
  btnSave: $("btnSave"),
  btnExportZip: $("btnExportZip"),
  btnClear: $("btnClear"),
  lat: $("lat"),
  lng: $("lng"),
  acc: $("acc"),
  memo: $("memo"),
  memo2: $("memo2"),
  preview: $("preview"),
  autoName: $("autoName"),
  ts: $("ts"),
  list: $("list"),
  count: $("count"),
  exportStatus: $("exportStatus"),
  swState: $("swState"),
  btnInstall: $("btnInstall"),
};

let deferredPrompt = null;

// ---- Install prompt ----
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (els.btnInstall) els.btnInstall.style.display = "inline-block";
});
if (els.btnInstall) els.btnInstall.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  els.btnInstall.style.display = "none";
});

// ---- SW ----
(async function initSW(){
  if (!("serviceWorker" in navigator)) return;
  try{
    const reg = await navigator.serviceWorker.register("./sw.js");
    els.swState.textContent = "SW: registered";
    if (reg && reg.update) reg.update();
  }catch(e){
    els.swState.textContent = "SW: failed";
  }
})();

// ---- Helpers ----
function pad2(n){ return String(n).padStart(2,"0"); }
function formatTs(d){
  return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}
function setGeoUI(pos){
  els.lat.textContent = (pos && pos.coords && typeof pos.coords.latitude==="number") ? pos.coords.latitude.toFixed(7) : "-";
  els.lng.textContent = (pos && pos.coords && typeof pos.coords.longitude==="number") ? pos.coords.longitude.toFixed(7) : "-";
  els.acc.textContent = (pos && pos.coords && typeof pos.coords.accuracy==="number") ? Math.round(pos.coords.accuracy) : "-";
}
function setPreviewFromFile(file){
  if (!file) { els.preview.src = ""; return; }
  const url = URL.createObjectURL(file);
  els.preview.src = url;
  setTimeout(()=>URL.revokeObjectURL(url), 60000);
}
function escCsv(v){
  const s = String((v === undefined || v === null) ? "" : v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}
function escapeHtml(s){
  return String((s === undefined || s === null) ? "" : s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}
function uniq(arr){
  return Array.from(new Set(arr.filter(v => String(v).trim() !== "").map(v => String(v).trim())));
}

function makeId(){
  // Android 9 / 古いChromeでも動くID
  if (window.crypto && crypto.getRandomValues){
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    let s = "";
    for (let i=0;i<buf.length;i++){ s += ("0" + buf[i].toString(16)).slice(-2); }
    return s;
  }
  return "id_" + Date.now() + "_" + Math.floor(Math.random()*1e9);
}

// ---- List storage (localStorage) ----
const LIST_KEY = "fieldlog_lists_v1"; // {locations:[], items:[]}

function loadLists(){
  try{
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return { locations: [], locations2: [], items: [] };
    const obj = JSON.parse(raw);
    return {
      locations: Array.isArray(obj.locations) ? obj.locations : [],
      locations2: Array.isArray(obj.locations2) ? obj.locations2 : [],
      items: Array.isArray(obj.items) ? obj.items : []
    };
  }catch(_){
    return { locations: [], locations2: [], items: [] };
  }
}
function saveLists(lists){
  localStorage.setItem(LIST_KEY, JSON.stringify({
    locations: lists.locations || [],
    locations2: lists.locations2 || [],
    items: lists.items || []
  }));
}
function setStatus(msg){
  if (els.listStatus) els.listStatus.textContent = msg || "";
}

function fillSelect(selectEl, values, placeholder){
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder;
  selectEl.appendChild(ph);

  for (const v of values){
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  }
}

function refreshListUI(){
  const lists = loadLists();
  fillSelect(els.selLocation, lists.locations, "地点を選択");
  fillSelect(els.selLocation2, lists.locations2, "地点2を選択");
  fillSelect(els.selItem, lists.items, "調査項目を選択");
  setStatus(`登録済み: 地点 ${lists.locations.length} / 地点2 ${lists.locations2.length} / 項目 ${lists.items.length}`);
}



async function parseListCsv(file){
  // CSV列ルール（列位置固定）:
  // A列 = 地点, B列 = 地点2, C列 = 項目
  // 文字コード: UTF-8/UTF-8(BOM)/Shift-JIS を自動で吸収（可能な範囲）
  const ab = await file.arrayBuffer();
  const u8 = new Uint8Array(ab);

  function decodeWith(enc){
    try{
      const dec = new TextDecoder(enc, { fatal:false });
      return dec.decode(u8);
    }catch(_){
      return null;
    }
  }

  // 1) UTF-8優先
  let text = decodeWith("utf-8") || "";
  // 文字化けっぽい場合はShift-JISも試す（� が多い/区切りが見えない等）
  const bad = (text.match(/\uFFFD/g) || []).length;
  if (bad > 5 || (!text.includes(",") && !text.includes("，"))) {
    const sjis = decodeWith("shift-jis");
    if (sjis) text = sjis;
  }

  // 行分割
  const lines = text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n").filter(l => l.trim() !== "");
  if (lines.length === 0) throw new Error("CSVが空です");

  // 先頭行がヘッダっぽいなら飛ばす
  const first = splitCsvLine(lines[0]).map(s => String(s || "").trim());
  const isHeader =
    (first[0] === "地点" || first[0] === "location") ||
    (first[1] === "地点2" || first[1] === "location2") ||
    (first[2] === "項目" || first[2] === "item");

  const start = isHeader ? 1 : 0;

  const locs = [];
  const locs2 = [];
  const items = [];

  for (let i=start;i<lines.length;i++){
    const row = splitCsvLine(lines[i]);
    if (row[0]) locs.push(row[0]);      // A列: 地点
    if (row[1]) locs2.push(row[1]);     // B列: 地点2
    if (row[2]) items.push(row[2]);     // C列: 項目
  }

  return { locations: uniq(locs), locations2: uniq(locs2), items: uniq(items) };
}



function splitCsvLine(line){
  // minimal CSV splitter with quotes
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i=0;i<line.length;i++){
    const ch = line[i];
    if (ch === '"'){
      if (inQ && line[i+1] === '"'){ cur += '"'; i++; }
      else inQ = !inQ;
    }else if (ch === ',' && !inQ){
      out.push(cur);
      cur = "";
    }else{
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => String((s === undefined || s === null) ? "" : s).trim());
}

if (els.listCsvInput) els.listCsvInput.addEventListener("change", async () => {
  const f = (els.listCsvInput.files && els.listCsvInput.files[0]);
  if (!f) return;
  try{
    setStatus("CSV読込中...");
    const lists = await parseListCsv(f);
    saveLists(lists);
    refreshListUI();
    setStatus("CSVを読み込みました ✅");
  }catch(e){
    console.error(e);
    setStatus("");
    alert("CSV読み込みに失敗: " + ((e && e.message) ? e.message : e));
  }finally{
    els.listCsvInput.value = "";
  }
});

if (els.btnClearLists) els.btnClearLists.addEventListener("click", () => {
  if (!confirm("地点/項目リストを削除します。よろしいですか？")) return;
  saveLists({locations:[], items:[]});
  refreshListUI();
  setStatus("リストを削除しました");
});

// ---- IndexedDB ----
const DB_NAME = "offline_survey_pwa_db";
const DB_VER = 1;
const STORE = "records";

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("createdAt", "createdAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbPut(record){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const e = tx.error; db.close(); reject(e); };
  });
}
async function dbGetAll(){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => { const v = req.result || []; db.close(); resolve(v); };
    req.onerror = () => { const e = req.error; db.close(); reject(e); };
  });
}
async function dbClear(){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const e = tx.error; db.close(); reject(e); };
  });
}

// ---- State ----
let currentFile = null;
let currentGeo = null;
let currentTs = null;

function updateAutoName(){
  if (!currentTs) { els.autoName.textContent = "-"; els.ts.textContent = "-"; return; }
  const base = formatTs(currentTs);
  els.autoName.textContent = `${base}-01.jpg`; // 表示用
  els.ts.textContent = currentTs.toLocaleString();
}

// ---- Events ----
if (els.photoInput) els.photoInput.addEventListener("change", () => {
  currentFile = ((els.photoInput.files && els.photoInput.files[0]) ? els.photoInput.files[0] : null);
  currentTs = new Date();
  updateAutoName();
  setPreviewFromFile(currentFile);
});

if (els.btnGeo) els.btnGeo.addEventListener("click", async () => {
  els.btnGeo.disabled = true;
  els.btnGeo.textContent = "GPS取得中...";
  try {
    currentGeo = await new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("no geolocation"));
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      });
    });
    setGeoUI(currentGeo);
  } catch (e) {
    alert("GPS取得に失敗しました。位置情報(許可/精度)を確認して再試行してください。");
  } finally {
    els.btnGeo.disabled = false;
    els.btnGeo.textContent = "GPS取得";
  }
});

if (els.btnSave) els.btnSave.addEventListener("click", async () => {
  if (!currentFile) { alert("写真を選択/撮影してください"); return; }
  if (!currentGeo) { alert("GPSを取得してください"); return; }

  const location = ((els.selLocation && els.selLocation.value) ? els.selLocation.value : "").trim();
  const location2 = ((els.selLocation2 && els.selLocation2.value) ? els.selLocation2.value : "").trim();
  const item = ((els.selItem && els.selItem.value) ? els.selItem.value : "").trim();
  if (!location) { alert("地点を選択してください"); return; }
  if (!item) { alert("調査項目を選択してください"); return; }

  const ts = (currentTs ? currentTs : new Date());
  const base = formatTs(ts);

  // 枝番：同秒の既存件数+1
  const all = await dbGetAll();
  const sameSec = all.filter(r => (r.photoName || "").startsWith(base + "-")).length;
  const seq = sameSec + 1;
  const photoName = `${base}-${pad2(seq)}.jpg`;

  const blob = (currentFile.type && currentFile.type.indexOf("image/") === 0) ? currentFile : new Blob([await currentFile.arrayBuffer()], { type: "image/jpeg" });

  const rec = {
    id: makeId(),
    createdAt: ts.toISOString(),
    lat: currentGeo.coords.latitude,
    lng: currentGeo.coords.longitude,
    acc: currentGeo.coords.accuracy,
    location,
    location2,
    item,
    memo: (els.memo.value || "").trim(),
    memo2: (els.memo2.value || "").trim(),
    photoName,
    photoType: blob.type || "image/jpeg",
    photoBlob: blob
  };

  try {
    await dbPut(rec);
    // reset
    els.memo.value = "";
    els.memo2.value = "";
    els.photoInput.value = "";
    if (els.selItem) els.selItem.value = "";
    // locationは連続入力しやすいように残す
    currentFile = null;
    currentGeo = null;
    currentTs = null;
    setGeoUI(null);
    els.preview.src = "";
    updateAutoName();
    await renderList();
    alert("保存しました");
  } catch (e) {
    console.error(e);
    alert("保存に失敗しました。容量不足の可能性があります。");
  }
});

// ---- List ----
async function renderList(){
  const all = await dbGetAll();
  all.sort((a,b) => (a.createdAt < b.createdAt ? 1 : -1));
  els.count.textContent = String(all.length);
  els.list.innerHTML = "";

  for (const r of all.slice(0, 50)) {
    const wrap = document.createElement("div");
    wrap.className = "item";

    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = "photo";
    try{
      const url = URL.createObjectURL(r.photoBlob);
      img.src = url;
      img.onload = () => setTimeout(()=>URL.revokeObjectURL(url), 60000);
    }catch(_){}

    const right = document.createElement("div");
    right.className = "kv";
    const d = new Date(r.createdAt);

    right.innerHTML = `
      <div><b>${r.photoName}</b></div>
      <div class="small mono">${d.toLocaleString()}</div>
      <div class="small">地点: ${escapeHtml(r.location || "")} / 地点2: ${escapeHtml(r.location2 || "")} / 項目: ${escapeHtml(r.item || "")}</div>
      <div class="small">lat: ${Number(r.lat).toFixed(7)} / lng: ${Number(r.lng).toFixed(7)} / acc: ${Math.round(r.acc)}m</div>
      <div class="small">備考: ${escapeHtml(r.memo || "")}</div>
      <div class="small">備考2: ${escapeHtml(r.memo2 || "")}</div>
    `;

    wrap.appendChild(img);
    wrap.appendChild(right);
    els.list.appendChild(wrap);
  }
}

// ---- ZIP (store) + CRC32 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i=0;i<256;i++){
    let c = i;
    for (let k=0;k<8;k++){
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(u8){
  let c = 0xFFFFFFFF;
  for (let i=0;i<u8.length;i++){
    c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function u16(n){ return new Uint8Array([n & 255, (n>>>8) & 255]); }
function u32(n){ return new Uint8Array([n & 255, (n>>>8) & 255, (n>>>16) & 255, (n>>>24) & 255]); }
function strU8(s){ return new TextEncoder().encode(s); }
function concatU8(parts){
  const len = parts.reduce((a,b)=>a+b.length,0);
  const out = new Uint8Array(len);
  let off=0;
  for (const p of parts){ out.set(p, off); off += p.length; }
  return out;
}
function dosTime(date){
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const mon = d.getMonth()+1;
  const day = d.getDate();
  const hr = d.getHours();
  const min = d.getMinutes();
  const sec = Math.floor(d.getSeconds()/2);
  const dt = ((year-1980) << 9) | (mon << 5) | day;
  const tm = (hr << 11) | (min << 5) | sec;
  return {dt, tm};
}
function makeZip(files){
  let localParts = [];
  let centralParts = [];
  let offset = 0;

  for (const f of files){
    const nameU8 = strU8(f.name);
    const dataU8 = f.data;
    const c = crc32(dataU8);
    const {dt, tm} = dosTime(f.mtime || new Date());

    const localHeader = concatU8([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(tm),
      u16(dt),
      u32(c),
      u32(dataU8.length),
      u32(dataU8.length),
      u16(nameU8.length),
      u16(0),
      nameU8
    ]);
    localParts.push(localHeader, dataU8);

    const centralHeader = concatU8([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(tm),
      u16(dt),
      u32(c),
      u32(dataU8.length),
      u32(dataU8.length),
      u16(nameU8.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameU8
    ]);
    centralParts.push(centralHeader);

    offset += localHeader.length + dataU8.length;
  }

  const centralDir = concatU8(centralParts);
  const centralOffset = offset;
  const centralSize = centralDir.length;

  const end = concatU8([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(centralOffset),
    u16(0)
  ]);

  return concatU8([...localParts, centralDir, end]);
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);

  requestAnimationFrame(() => {
    setTimeout(() => {
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 5000);
    }, 50);
  });
}

if (els.btnExportZip) els.btnExportZip.addEventListener("click", async () => {
  els.btnExportZip.disabled = true;
  els.exportStatus.textContent = "ZIP生成中...";
  try {
    const all = await dbGetAll();
    if (all.length === 0) { alert("保存データがありません"); return; }

    const header = ["photo","createdAt","location","location2","item","lat","lng","acc","memo","memo2"];
    const rows = [header.join(",")];
    for (const r of all){
      rows.push([
        escCsv(r.photoName),
        escCsv(r.createdAt),
        escCsv(r.location || ""),
        escCsv(r.location2 || ""),
        escCsv(r.item || ""),
        escCsv(r.lat),
        escCsv(r.lng),
        escCsv(Math.round(r.acc)),
        escCsv(r.memo || ""),
        escCsv(r.memo2 || "")
      ].join(","));
    }
    const csvText = "\uFEFF" + rows.join("\r\n");
    const csvU8 = strU8(csvText);

    const files = [];
    files.push({ name: "records.csv", data: csvU8, mtime: new Date() });

    for (const r of all){
      const ab = await r.photoBlob.arrayBuffer();
      const u8 = new Uint8Array(ab);
      files.push({ name: "photos/" + r.photoName, data: u8, mtime: new Date(r.createdAt) });
    }

    const zipU8 = makeZip(files);
    const zipBlob = new Blob([zipU8], { type: "application/zip" });

    const zipName = `survey_export_${formatTs(new Date())}.zip`;
    downloadBlob(zipBlob, zipName);
    els.exportStatus.textContent = "ZIPを書き出しました: " + zipName;
  } catch (e) {
    console.error(e);
    alert("ZIP書き出しに失敗しました。");
    els.exportStatus.textContent = "失敗しました";
  } finally {
    els.btnExportZip.disabled = false;
  }
});

if (els.btnClear) els.btnClear.addEventListener("click", async () => {
  if (!confirm("全データを削除します。よろしいですか？")) return;
  await dbClear();
  await renderList();
  alert("削除しました");
});

// First render
(async function(){
  refreshListUI();
  updateAutoName();
  await renderList();
  try { els.swState.textContent += " / " + location.origin; } catch(_){}
})();
