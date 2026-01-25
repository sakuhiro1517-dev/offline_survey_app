// FieldLog Mini (Fixed ZIP Version)
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
const STORE   = \"records\";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: \"id\" });
        os.createIndex(\"by_ts\", \"ts\");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, \"readwrite\");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, \"readonly\");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a,b) => b.ts - a.ts));
    req.onerror = () => reject(req.error);
  });
}

async function dbClear() {
  if (!confirm(\"すべてのデータを削除しますか？\")) return;
  const db = await openDb();
  const tx = db.transaction(STORE, \"readwrite\");
  tx.objectStore(STORE).clear();
  tx.oncomplete = () => { alert(\"削除しました\"); renderList(); };
}

// ---------- GPS ----------
function getGps() {
  if (!navigator.geolocation) return alert(\"GPS非対応です\");
  $(\"btnGps\").innerText = \"取得中...\";
  navigator.geolocation.getCurrentPosition(
    (p) => {
      state.lat = p.coords.latitude.toFixed(7);
      state.lon = p.coords.longitude.toFixed(7);
      state.acc = p.coords.accuracy.toFixed(1);
      state.ts  = p.timestamp;
      $(\"lat\").innerText = state.lat;
      $(\"lon\").innerText = state.lon;
      $(\"acc\").innerText = state.acc;
      $(\"ts\").innerText = new Date(state.ts).toLocaleString();
      $(\"btnGps\").innerText = \"GPS再取得\";
    },
    (e) => {
      alert(\"GPS取得失敗: \" + e.message);
      $(\"btnGps\").innerText = \"GPS取得\";
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ---------- Photo ----------
async function onPickPhoto(file) {
  if (!file) return;
  state.photoMime = file.type;
  state.photoExt = file.type === \"image/png\" ? \"png\" : \"jpg\";
  state.photoBlob = file;
  const url = URL.createObjectURL(file);
  $(\"preview\").src = url;
}

// ---------- Voice ----------
function startVoice() {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Rec) return alert(\"このブラウザは音声入力非対応です\");
  state.voice.recognizer = new Rec();
  state.voice.recognizer.lang = \"ja-JP\";
  state.voice.recognizer.interimResults = true;
  state.voice.recognizer.onstart = () => {
    state.voice.active = true;
    $(\"btnVoice\").innerText = \"🛑 音声入力中...\";
    $(\"voiceWarn\").hidden = false;
  };
  state.voice.recognizer.onresult = (e) => {
    let final = \"\";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
    }
    if (final) $(\"note\").value += final;
  };
  state.voice.recognizer.onend = () => stopVoice();
  state.voice.recognizer.start();
}
function stopVoice() {
  state.voice.active = false;
  $(\"btnVoice\").innerText = \"🎙 音声入力開始\";
  $(\"voiceWarn\").hidden = true;
  if (state.voice.recognizer) state.voice.recognizer.stop();
}

// ---------- Save ----------
async function saveCurrent() {
  if (!state.lat) { alert(\"GPSを取得してください\"); return; }
  const id = Date.now();
  const record = {
    id,
    ts: state.ts || id,
    lat: state.lat,
    lon: state.lon,
    acc: state.acc,
    note: $(\"note\").value,
    photoBlob: state.photoBlob,
    photoName: state.photoBlob ? `img_${id}.${state.photoExt}` : null
  };
  await dbPut(record);
  // Clear UI
  state.photoBlob = null;
  $(\"preview\").src = \"\";
  $(\"photo\").value = \"\";
  $(\"note\").value = \"\";
  renderList();
  alert(\"保存しました\");
}

// ---------- UI List ----------
async function renderList() {
  const items = await dbGetAll();
  const container = $(\"list\");
  container.innerHTML = \"\";
  items.forEach(r => {
    const div = document.createElement(\"div\");
    div.className = \"list-item\";
    div.innerHTML = `
      <div style=\"font-size:11px; color:#888\">${new Date(r.ts).toLocaleString()}</div>
      <div>${r.lat}, ${r.lon} (±${r.acc}m)</div>
      <div style=\"margin-top:4px\">${r.note || \"(備考なし)\"}</div>
    `;
    if (r.photoBlob) {
      const img = document.createElement(\"img\");
      img.src = URL.createObjectURL(r.photoBlob);
      img.className = \"list-thumb\";
      div.appendChild(img);
    }
    container.appendChild(div);
  });
}

// ---------- CSV/ZIP Export ----------
function exportCsvBlob(items) {
  const header = \"id,time,lat,lon,acc,note,photo\\n\";
  const rows = items.map(r => {
    const timeStr = new Date(r.ts).toISOString();
    const noteEsc = (r.note||\"\").replace(/\\n/g,\" \").replace(/\"/g,'\"\"');
    return `${r.id},\"${timeStr}\",${r.lat},${r.lon},${r.acc},\"${noteEsc}\",\"${r.photoName||\"\"}\"`;
  }).join(\"\\n\");
  return new Blob([\"\\ufeff\" + header + rows], { type: \"text/csv;charset=utf-8\" });
}

async function exportCsv() {
  const items = await dbGetAll();
  if (items.length === 0) return alert(\"データがありません\");
  const blob = exportCsvBlob(items);
  const url = URL.createObjectURL(blob);
  const a = document.createElement(\"a\");
  a.href = url;
  a.download = `fieldlog_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

async function exportZip() {
  const JSZip = window.JSZip;
  if (!JSZip) return alert(\"JSZip読み込みエラー\");
  
  const items = await dbGetAll();
  if (items.length === 0) return alert(\"データがありません\");

  const zip = new JSZip();
  // CSV追加
  const csvBlob = exportCsvBlob(items);
  zip.file(\"data.csv\", csvBlob);

  // 写真追加
  const folder = zip.folder(\"photos\");
  for (const r of items) {
    if (r.photoBlob) {
      // 修正の肝：awaitを追加
      await folder.file(r.photoName || `${r.id}.jpg`, r.photoBlob);
    }
  }

  // ZIP生成
  const outBlob = await zip.generateAsync({ type: \"blob\" });
  
  const url = URL.createObjectURL(outBlob);
  const a = document.createElement(\"a\");
  a.href = url;
  a.download = `fieldlog_${new Date().toISOString().slice(0,10)}.zip`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 100);
}

// ---------- Setup ----------
$(\"btnGps\").addEventListener(\"click\", getGps);
$(\"photo\").addEventListener(\"change\", (e) => onPickPhoto(e.target.files[0]));
$(\"btnVoice\").addEventListener(\"click\", () => state.voice.active ? stopVoice() : startVoice());
$(\"btnSave\").addEventListener(\"click\", saveCurrent);
$(\"btnExportCsv\").addEventListener(\"click\", exportCsv);
$(\"btnExportZip\").addEventListener(\"click\", exportZip);
$(\"btnClear\").addEventListener(\"click\", dbClear);

window.addEventListener(\"DOMContentLoaded\", () => {
  renderList();
  if (\"serviceWorker\" in navigator) navigator.serviceWorker.register(\"./sw.js\");
});
