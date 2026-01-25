// FieldLog Mini (GitHub Pages / PWA / Offline-first)
// 写真(Blob) + GPS + 備考(text) を IndexedDB に保存し、CSV と「CSV+写真ZIP」を生成します。
// 依存: jszip.min.js（window.JSZip がある前提）

const $ = (id) => document.getElementById(id);

const state = {
  lat: null,
  lon: null,
  acc: null,
  ts: null,
  photoBlob: null,
  photoExt: null,
  photoMime: null,
  voice: { active: false, recognizer: null }
};

// ---------- IndexedDB ----------
const DB_NAME = "fieldlog-mini-db";
const DB_VER  = 1;
const STORE   = "records";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("by_ts", "ts");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClear() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- GPS ----------
function nowIsoNoMs() {
  const d = new Date();
  d.setMilliseconds(0);
  return d.toISOString();
}

function setGpsUI() {
  $("lat").textContent = state.lat ?? "-";
  $("lon").textContent = state.lon ?? "-";
  $("acc").textContent = state.acc ?? "-";
  $("ts").textContent  = state.ts  ?? "-";
}

async function getGps() {
  if (!("geolocation" in navigator)) {
    alert("このブラウザはGPS(Geolocation)に非対応です。");
    return;
  }
  $("btnGps").disabled = true;
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      });
    });
    state.lat = pos.coords.latitude.toFixed(7);
    state.lon = pos.coords.longitude.toFixed(7);
    state.acc = Math.round(pos.coords.accuracy);
    state.ts  = nowIsoNoMs();
    setGpsUI();
  } catch (e) {
    alert("GPS取得に失敗: " + (e?.message ?? e));
  } finally {
    $("btnGps").disabled = false;
  }
}

// ---------- Photo ----------
function detectExtFromMime(mime) {
  if (!mime) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

async function onPickPhoto(file) {
  if (!file) return;
  state.photoBlob = file;
  state.photoMime = file.type || "image/jpeg";
  state.photoExt  = detectExtFromMime(file.type);

  const url = URL.createObjectURL(file);
  const img = $("preview");
  img.src = url;
  img.style.display = "block";
}

// ---------- Voice (optional) ----------
function setupVoiceWarn() { $("voiceWarn").hidden = false; }

function startVoice() {
  const SR = window.// SpeechRecognition disabled || window.webkit// SpeechRecognition disabled;
  if (!SR) {
    setupVoiceWarn();
    alert("このブラウザはWeb Speech音声認識に非対応です。");
    return;
  }
  setupVoiceWarn();

  const rec = new SR();
  rec.lang = "ja-JP";
  rec.interimResults = true;
  rec.continuous = true;

  rec.onresult = (ev) => {
    let finalText = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript;
    }
    if (finalText) {
      const ta = $("note");
      ta.value = (ta.value + (ta.value ? "\n" : "") + finalText).trim();
    }
  };

  rec.onerror = () => stopVoice();
  rec.onend = () => { if (state.voice.active) stopVoice(); };

  state.voice.recognizer = rec;
  state.voice.active = true;
  $("btnVoice").textContent = "⏹ 音声入力停止";
  rec.start();
}

function stopVoice() {
  const rec = state.voice.recognizer;
  state.voice.active = false;
  state.voice.recognizer = null;
  $("btnVoice").textContent = "🎙 音声入力開始";
  try { rec?.stop(); } catch {}
}

// ---------- Save / List ----------
function pad2(n){ return String(n).padStart(2,"0"); }

function makeId() {
  const d = new Date();
  return [
    d.getFullYear(),
    pad2(d.getMonth()+1),
    pad2(d.getDate()),
    "_",
    pad2(d.getHours()),
    pad2(d.getMinutes()),
    pad2(d.getSeconds()),
    "_",
    Math.random().toString(16).slice(2,8)
  ].join("");
}

function csvEscape(s) {
  const t = String(s ?? "");
  if (/[,"\n\r]/.test(t)) return '"' + t.replace(/"/g,'""') + '"';
  return t;
}

async function saveCurrent() {
  if (!state.lat || !state.lon) {
    alert("先にGPS取得してください。");
    return;
  }
  if (!state.photoBlob) {
    alert("先に写真を選択/撮影してください。");
    return;
  }
  const id = makeId();
  const ts = state.ts ?? nowIsoNoMs();
  const photoName = `${id}.${state.photoExt ?? "jpg"}`;

  const record = {
    id,
    ts,
    lat: Number(state.lat),
    lon: Number(state.lon),
    acc: state.acc != null ? Number(state.acc) : null,
    note: $("note").value ?? "",
    photoName,
    photoMime: state.photoMime ?? "image/jpeg",
    photoBlob: state.photoBlob
  };

  await dbPut(record);

  $("note").value = "";
  state.photoBlob = null;
  const img = $("preview");
  img.removeAttribute("src");
  img.style.display = "none";

  await renderList();
}

function human(ts){
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

async function downloadPhoto(rec) {
  const blob = rec.photoBlob;
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = rec.photoName || "photo.jpg";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function renderList() {
  const list = $("list");
  list.innerHTML = "";
  const items = await dbGetAll();
  items.sort((a,b) => (b.ts||"").localeCompare(a.ts||""));

  if (items.length === 0) {
    list.innerHTML = `<div class="item"><small>まだ0件です。</small></div>`;
    return;
  }

  for (const rec of items) {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="itemTop">
        <div>
          <div><b>${csvEscape(human(rec.ts))}</b></div>
          <small>lat ${rec.lat} / lon ${rec.lon} / acc ${rec.acc ?? "-"}m</small>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button data-act="photo" data-id="${rec.id}">写真DL</button>
          <button data-act="del" data-id="${rec.id}">削除</button>
        </div>
      </div>
      <div style="margin-top:8px;white-space:pre-wrap;color:#ddd">${(rec.note ?? "").slice(0,500)}</div>
      <small>photo: ${rec.photoName ?? "-"}</small>
    `;
    list.appendChild(el);
  }

  list.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const act = btn.getAttribute("data-act");
      const all = await dbGetAll();
      const rec = all.find(x => x.id === id);
      if (!rec) return;

      if (act === "del") {
        if (!confirm("この1件を削除しますか？")) return;
        await dbDelete(id);
        await renderList();
      } else if (act === "photo") {
        await downloadPhoto(rec);
      }
    });
  });
}

// ---------- CSV Export ----------
async function exportCsvBlob(items) {
  const header = ["id","timestamp","lat","lon","accuracy_m","note","photoName"].join(",");
  const lines = [header];

  // oldest first
  items.sort((a,b) => (a.ts||"").localeCompare(b.ts||""));

  for (const r of items) {
    lines.push([
      csvEscape(r.id),
      csvEscape(r.ts),
      csvEscape(r.lat),
      csvEscape(r.lon),
      csvEscape(r.acc ?? ""),
      csvEscape(r.note ?? ""),
      csvEscape(r.photoName ?? "")
    ].join(","));
  }
  const csv = lines.join("\r\n");
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}

async function exportCsv() {
  const items = await dbGetAll();
  if (items.length === 0) { alert("データが0件です。"); return; }

  const blob = await exportCsvBlob(items);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fieldlog_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- ZIP Export (CSV + photos) ----------
async function exportZip() {
  const JSZip = window.JSZip;
  if (!JSZip) {
    alert("JSZip が読み込めていません。index.html に <script src='./jszip.min.js'></script> を追加してください。");
    return;
  }
  const items = await dbGetAll();
  if (items.length === 0) { alert("データが0件です。"); return; }

  const zip = new JSZip();
  const csvBlob = await exportCsvBlob(items);
  
  // CSVの追加も待機する
  await zip.file("data.csv", csvBlob);

  const folder = zip.folder("photos");
  for (const r of items) {
    if (r.photoBlob) {
      // ★ここが重要：非同期処理の完了を待機するように修正
      await folder.file(r.photoName || `${r.id}.jpg`, r.photoBlob);
    }
  }

  const outBlob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(outBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fieldlog_${new Date().toISOString().slice(0,10)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
// ---------- Service Worker ----------
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
  } catch (e) {
    console.warn("SW register failed", e);
  }
}

// ---------- UI wiring ----------
$("btnGps")?.addEventListener("click", getGps);

$("photo")?.addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  onPickPhoto(f);
});

$("btnVoice")?.addEventListener("click", () => {
  if (state.voice.active) stopVoice();
  else startVoice();
});

$("btnSave")?.addEventListener("click", async () => {
  $("btnSave").disabled = true;
  try { await saveCurrent(); }
  finally { $("btnSave").disabled = false; }
});

$("btnExportCsv")?.addEventListener("click", exportCsv);
$("btnExportZip")?.addEventListener("click", exportZip);

$("btnClear")?.addEventListener("click", async () => {
  if (!confirm("全データを削除しますか？")) return;
  await dbClear();
  await renderList();
});

window.addEventListener("load", async () => {
  setGpsUI();
  await renderList();
  await registerSW();
});
