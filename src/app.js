// app.js — the editor: pages, shared asset library, canvas transforms, layer panel,
// undo/redo, autosave, preview, import/export, cross-window sync.
import { initGalaxy } from './galaxy.js';
import { initFlowers } from './flowers.js';
import { DB } from './db.js';

const CANVAS_W = 1600, CANVAS_H = 900;
const $ = (s) => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

// ---------------- state ----------------
let project = null;                 // { version, pages:[{id,name,layers:[]}], activePageId }
const assets = new Map();           // id -> { id, name, type, width, height, blob, url }
let selectedId = null;
let history = [], future = [];
let gesture = null;
let saveTimer = null;
let bg = null;          // current background effect handle { hasAudio, dispose, toggleSound? }
let bgType = null;      // 'flowers' | 'galaxy'

// DOM
const canvasEl = $('#canvas');
const layerListEl = $('#layerList');
const assetGridEl = $('#assetGrid');
const pageTabsEl = $('#pageTabs');
const toastEl = $('#toast');

// ---------------- helpers ----------------
function activePage() {
  return project.pages.find(p => p.id === project.activePageId) || project.pages[0];
}
function layerById(id) { return activePage().layers.find(l => l.id === id); }
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// ---------------- persistence ----------------
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await DB.saveProject(project);
    DB.broadcast('project');
  }, 250);
}
function pushHistory() {
  history.push(JSON.stringify(project));
  if (history.length > 120) history.shift();
  future = [];
  updateHistoryButtons();
}
function updateHistoryButtons() {
  $('#undoBtn').disabled = history.length === 0;
  $('#redoBtn').disabled = future.length === 0;
}
function undo() {
  if (!history.length) return;
  future.push(JSON.stringify(project));
  project = JSON.parse(history.pop());
  afterStateReplace();
}
function redo() {
  if (!future.length) return;
  history.push(JSON.stringify(project));
  project = JSON.parse(future.pop());
  afterStateReplace();
}
function afterStateReplace() {
  if (!project.pages.find(p => p.id === project.activePageId)) project.activePageId = project.pages[0].id;
  if (!layerById(selectedId)) selectedId = null;
  renderAll();
  scheduleSave();
  updateHistoryButtons();
}

// ---------------- assets ----------------
function imageSize(blob) {
  return new Promise((res) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { res({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { res({ w: 300, h: 300 }); URL.revokeObjectURL(url); };
    img.src = url;
  });
}
async function addAssetsFromFiles(files) {
  let last = null;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const { w, h } = await imageSize(file);
    const asset = { id: uid(), name: file.name.replace(/\.[^.]+$/, ''), type: file.type, width: w, height: h, blob: file };
    await DB.putAsset(asset);
    asset.url = URL.createObjectURL(file);
    assets.set(asset.id, asset);
    last = asset;
  }
  renderAssets();
  DB.broadcast('assets');
  if (last) toast('已添加素材到资产库');
}
async function reloadAssets() {
  for (const a of assets.values()) if (a.url) URL.revokeObjectURL(a.url);
  assets.clear();
  const all = await DB.getAllAssets();
  for (const a of all) { a.url = URL.createObjectURL(a.blob); assets.set(a.id, a); }
}
async function deleteAsset(id) {
  const used = project.pages.reduce((n, pg) => n + pg.layers.filter(l => l.assetId === id).length, 0);
  const msg = used > 0
    ? `该素材被 ${used} 个图层使用。删除后这些图层也会被移除。确定？`
    : '从资产库删除该素材？';
  if (!confirm(msg)) return;
  pushHistory();
  for (const pg of project.pages) pg.layers = pg.layers.filter(l => l.assetId !== id);
  await DB.deleteAsset(id);
  const a = assets.get(id); if (a?.url) URL.revokeObjectURL(a.url);
  assets.delete(id);
  if (selectedId && !layerById(selectedId)) selectedId = null;
  renderAll();
  scheduleSave();
  DB.broadcast('assets');
}

// ---------------- layers ----------------
function addLayer(assetId) {
  const a = assets.get(assetId);
  if (!a) return;
  pushHistory();
  const maxDim = Math.max(a.width, a.height);
  const scale = clamp(360 / maxDim, 0.05, 2);
  const layer = {
    id: uid(), assetId, name: a.name,
    x: CANVAS_W / 2 + rand(-50, 50), y: CANVAS_H / 2 + rand(-50, 50),
    scale, rotation: 0, opacity: 1, visible: true, locked: false,
  };
  activePage().layers.push(layer);
  selectedId = layer.id;
  renderCanvas(); renderLayers();
  scheduleSave();
}
function deleteLayer(id) {
  const pg = activePage();
  const i = pg.layers.findIndex(l => l.id === id);
  if (i < 0) return;
  pushHistory();
  pg.layers.splice(i, 1);
  if (selectedId === id) selectedId = null;
  renderCanvas(); renderLayers();
  scheduleSave();
}
function toggleProp(id, prop) {
  const l = layerById(id); if (!l) return;
  pushHistory();
  l[prop] = !l[prop];
  if (prop === 'locked' && l.locked && selectedId === id) { /* keep selected but no transform */ }
  renderCanvas(); renderLayers();
  scheduleSave();
}
function renameLayer(id, name) {
  const l = layerById(id); if (!l) return;
  pushHistory();
  l.name = name || '图层';
  renderLayers();
  scheduleSave();
}
function reorderLayers(fromDisplay, toDisplay) {
  // panel is shown front-to-back (reverse of array); convert to array indices
  const pg = activePage();
  const n = pg.layers.length;
  const from = n - 1 - fromDisplay;
  let to = n - 1 - toDisplay;
  if (from === to) return;
  pushHistory();
  const [m] = pg.layers.splice(from, 1);
  pg.layers.splice(to, 0, m);
  renderCanvas(); renderLayers();
  scheduleSave();
}

// ---------------- canvas rendering ----------------
const elMap = new Map();
function renderCanvas() {
  const pg = activePage();
  // remove stale
  for (const [id, el] of elMap) {
    if (!pg.layers.find(l => l.id === id)) { el.remove(); elMap.delete(id); }
  }
  pg.layers.forEach((layer, i) => {
    let el = elMap.get(layer.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'layer';
      el.dataset.id = layer.id;
      const img = document.createElement('img');
      img.draggable = false;
      el.appendChild(img);
      el.addEventListener('pointerdown', onLayerPointerDown);
      canvasEl.appendChild(el);
      elMap.set(layer.id, el);
    }
    const a = assets.get(layer.assetId);
    const img = el.firstChild;
    if (a && img.src !== a.url) img.src = a.url;
    el.style.width = (a ? a.width : 100) + 'px';
    el.style.height = (a ? a.height : 100) + 'px';
    el.style.zIndex = i + 1;
    applyLayerTransform(layer, el);
  });
  updateSelectionBox();
}
function applyLayerTransform(layer, el) {
  el = el || elMap.get(layer.id);
  if (!el) return;
  el.style.left = layer.x + 'px';
  el.style.top = layer.y + 'px';
  el.style.transform = `translate(-50%,-50%) rotate(${layer.rotation}deg) scale(${layer.scale})`;
  el.style.opacity = layer.opacity;
  el.style.display = layer.visible ? 'block' : 'none';
  el.classList.toggle('locked', layer.locked);
  el.classList.toggle('selected', layer.id === selectedId);
}

// selection box with handles
let selBox = null;
function ensureSelBox() {
  if (selBox) return selBox;
  selBox = document.createElement('div');
  selBox.id = 'selBox';
  selBox.innerHTML = `
    <div class="s-handle rot" data-role="rotate"></div>
    <div class="s-line"></div>
    <div class="s-handle" data-role="scale" data-c="tl"></div>
    <div class="s-handle" data-role="scale" data-c="tr"></div>
    <div class="s-handle" data-role="scale" data-c="br"></div>
    <div class="s-handle" data-role="scale" data-c="bl"></div>`;
  selBox.querySelectorAll('.s-handle').forEach(h =>
    h.addEventListener('pointerdown', (e) => onHandlePointerDown(e, h.dataset.role)));
  canvasEl.appendChild(selBox);
  return selBox;
}
function updateSelectionBox() {
  const layer = selectedId ? layerById(selectedId) : null;
  ensureSelBox();
  if (!layer || !layer.visible || document.body.classList.contains('preview')) {
    selBox.style.display = 'none';
    return;
  }
  const a = assets.get(layer.assetId);
  const w = (a ? a.width : 100) * layer.scale;
  const h = (a ? a.height : 100) * layer.scale;
  selBox.style.display = 'block';
  selBox.style.width = w + 'px';
  selBox.style.height = h + 'px';
  selBox.style.left = layer.x + 'px';
  selBox.style.top = layer.y + 'px';
  selBox.style.transform = `translate(-50%,-50%) rotate(${layer.rotation}deg)`;
  selBox.classList.toggle('locked', layer.locked);
}

// ---------------- pointer interactions ----------------
function canvasPoint(e) {
  const r = canvasEl.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (CANVAS_W / r.width), y: (e.clientY - r.top) * (CANVAS_H / r.height) };
}
function onLayerPointerDown(e) {
  if (document.body.classList.contains('preview')) return;
  const id = e.currentTarget.dataset.id;
  const layer = layerById(id);
  if (!layer || layer.locked) return;
  select(id);
  e.preventDefault();
  const p0 = canvasPoint(e);
  pushHistory();
  gesture = { mode: 'move', id, p0, startX: layer.x, startY: layer.y };
  addGestureListeners();
}
function onHandlePointerDown(e, role) {
  e.stopPropagation();
  e.preventDefault();
  const layer = layerById(selectedId);
  if (!layer || layer.locked) return;
  const p0 = canvasPoint(e);
  const cx = layer.x, cy = layer.y;
  pushHistory();
  if (role === 'scale') {
    gesture = { mode: 'scale', id: selectedId, startScale: layer.scale, startDist: Math.hypot(p0.x - cx, p0.y - cy) || 1 };
  } else {
    gesture = { mode: 'rotate', id: selectedId, startRot: layer.rotation, startAng: Math.atan2(p0.y - cy, p0.x - cx) };
  }
  addGestureListeners();
}
function onPointerMove(e) {
  if (!gesture) return;
  const layer = layerById(gesture.id);
  if (!layer) return;
  const p = canvasPoint(e);
  if (gesture.mode === 'move') {
    layer.x = gesture.startX + (p.x - gesture.p0.x);
    layer.y = gesture.startY + (p.y - gesture.p0.y);
  } else if (gesture.mode === 'scale') {
    const d = Math.hypot(p.x - layer.x, p.y - layer.y);
    layer.scale = clamp(gesture.startScale * (d / gesture.startDist), 0.03, 12);
  } else if (gesture.mode === 'rotate') {
    const ang = Math.atan2(p.y - layer.y, p.x - layer.x);
    let deg = gesture.startRot + (ang - gesture.startAng) * 180 / Math.PI;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    layer.rotation = deg;
  }
  applyLayerTransform(layer);
  updateSelectionBox();
}
function onPointerUp() {
  if (!gesture) return;
  gesture = null;
  removeGestureListeners();
  scheduleSave();
}
function addGestureListeners() {
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}
function removeGestureListeners() {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
}
function select(id) {
  selectedId = id;
  renderCanvas();
  renderLayers();
}

// ---------------- panels render ----------------
function renderAssets() {
  assetGridEl.innerHTML = '';
  for (const a of assets.values()) {
    const cell = document.createElement('div');
    cell.className = 'asset';
    cell.title = a.name + ' — 点击添加到画布';
    cell.innerHTML = `<img src="${a.url}" draggable="false"><span class="asset-name">${escapeHtml(a.name)}</span><button class="asset-del" title="从资产库删除">✕</button>`;
    cell.addEventListener('click', (e) => {
      if (e.target.classList.contains('asset-del')) { deleteAsset(a.id); return; }
      addLayer(a.id);
    });
    assetGridEl.appendChild(cell);
  }
  $('#assetDrop').style.display = assets.size ? 'none' : 'block';
}
function renderLayers() {
  layerListEl.innerHTML = '';
  const layers = activePage().layers;
  if (!layers.length) {
    layerListEl.innerHTML = '<div class="empty">暂无图层。点击左侧素材即可添加。</div>';
    return;
  }
  // front-to-back: last array item on top
  for (let d = 0; d < layers.length; d++) {
    const layer = layers[layers.length - 1 - d];
    const a = assets.get(layer.assetId);
    const row = document.createElement('div');
    row.className = 'layer-row' + (layer.id === selectedId ? ' active' : '');
    row.draggable = true;
    row.dataset.display = d;
    row.innerHTML = `
      <span class="grip">⋮⋮</span>
      <img class="thumb" src="${a ? a.url : ''}" draggable="false">
      <span class="lname">${escapeHtml(layer.name)}</span>
      <button class="row-btn ${layer.visible ? '' : 'off'}" data-act="vis" title="显示/隐藏">${layer.visible ? '◉' : '○'}</button>
      <button class="row-btn ${layer.locked ? 'on' : ''}" data-act="lock" title="锁定">${layer.locked ? '🔒' : '🔓'}</button>
      <button class="row-btn" data-act="del" title="删除图层">🗑</button>`;
    row.addEventListener('click', (e) => {
      const act = e.target.dataset.act;
      if (act === 'vis') return toggleProp(layer.id, 'visible');
      if (act === 'lock') return toggleProp(layer.id, 'locked');
      if (act === 'del') return deleteLayer(layer.id);
      select(layer.id);
    });
    const name = row.querySelector('.lname');
    name.addEventListener('dblclick', () => editInline(name, layer.name, (v) => renameLayer(layer.id, v)));
    // drag reorder
    row.addEventListener('dragstart', (e) => { row.classList.add('dragging'); e.dataTransfer.setData('text', d); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop-target'); });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
      e.preventDefault(); row.classList.remove('drop-target');
      reorderLayers(parseInt(e.dataTransfer.getData('text'), 10), d);
    });
    layerListEl.appendChild(row);
  }
}
function renderPages() {
  pageTabsEl.innerHTML = '';
  for (const pg of project.pages) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (pg.id === project.activePageId ? ' active' : '');
    tab.innerHTML = `<span class="tname">${escapeHtml(pg.name)}</span>` +
      (project.pages.length > 1 ? `<button class="tab-x" title="删除页面">✕</button>` : '');
    tab.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-x')) return deletePage(pg.id);
      switchPage(pg.id);
    });
    tab.querySelector('.tname').addEventListener('dblclick', (e) => {
      editInline(e.target, pg.name, (v) => renamePage(pg.id, v));
    });
    pageTabsEl.appendChild(tab);
  }
}
function renderAll() {
  renderPages(); renderAssets(); renderCanvas(); renderLayers(); updateHistoryButtons();
}

// ---------------- pages ----------------
function addPage() {
  pushHistory();
  const n = project.pages.length + 1;
  const pg = { id: uid(), name: '页面 ' + n, layers: [] };
  project.pages.push(pg);
  project.activePageId = pg.id;
  selectedId = null;
  renderAll(); scheduleSave();
}
function switchPage(id) {
  if (project.activePageId === id) return;
  project.activePageId = id;
  selectedId = null;
  renderAll(); scheduleSave();
}
function renamePage(id, name) {
  const pg = project.pages.find(p => p.id === id); if (!pg) return;
  pushHistory();
  pg.name = name || '页面';
  renderPages(); scheduleSave();
}
function deletePage(id) {
  if (project.pages.length <= 1) return;
  if (!confirm('删除该页面？页面内的图层布局会被移除（素材保留在资产库）。')) return;
  pushHistory();
  const i = project.pages.findIndex(p => p.id === id);
  project.pages.splice(i, 1);
  if (project.activePageId === id) project.activePageId = project.pages[Math.max(0, i - 1)].id;
  selectedId = null;
  renderAll(); scheduleSave();
}

// ---------------- inline edit ----------------
function editInline(span, value, commit) {
  const input = document.createElement('input');
  input.className = 'inline-edit';
  input.value = value;
  span.replaceWith(input);
  input.focus(); input.select();
  const done = (save) => {
    input.replaceWith(span);
    if (save) commit(input.value.trim());
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => done(true));
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---------------- preview ----------------
function togglePreview(force) {
  const on = force !== undefined ? force : !document.body.classList.contains('preview');
  document.body.classList.toggle('preview', on);
  $('#previewBtn').classList.toggle('active', on);
  if (on) selectedId = selectedId; // keep data, just hide chrome
  updateSelectionBox();
  renderCanvas();
}

// ---------------- import / export ----------------
async function exportProject() {
  const text = await DB.exportProject(project);
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `portfolio-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('项目已导出');
}
async function importProjectFile(file) {
  try {
    const text = await file.text();
    const imported = await DB.importProject(text);
    history = []; future = [];
    project = imported;
    await reloadAssets();
    if (!project.pages.find(p => p.id === project.activePageId)) project.activePageId = project.pages[0].id;
    selectedId = null;
    renderAll();
    DB.broadcast('all');
    toast('项目已导入');
  } catch (err) {
    alert('导入失败：' + err.message);
  }
}

// ---------------- keyboard ----------------
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  const meta = e.ctrlKey || e.metaKey;
  if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (e.key === 'Escape') {
    if (document.body.classList.contains('preview')) return togglePreview(false);
    selectedId = null; renderCanvas(); renderLayers(); return;
  }
  if (e.key.toLowerCase() === 'p') { togglePreview(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteLayer(selectedId); return; }
  if (selectedId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    const l = layerById(selectedId); if (!l) return;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowUp') l.y -= step;
    if (e.key === 'ArrowDown') l.y += step;
    if (e.key === 'ArrowLeft') l.x -= step;
    if (e.key === 'ArrowRight') l.x += step;
    applyLayerTransform(l); updateSelectionBox(); scheduleSave();
  }
});

// deselect on empty canvas click
canvasEl.addEventListener('pointerdown', (e) => {
  if (e.target === canvasEl) { selectedId = null; renderCanvas(); renderLayers(); }
});

// ---------------- fit canvas to viewport ----------------
function fitCanvas() {
  const wrap = $('#canvasWrap');
  const pad = document.body.classList.contains('preview') ? 0 : 40;
  const fit = Math.min((wrap.clientWidth - pad) / CANVAS_W, (wrap.clientHeight - pad) / CANVAS_H);
  canvasEl.style.transform = `scale(${fit})`;
  canvasEl.style.setProperty('--fit', fit);
}
window.addEventListener('resize', fitCanvas);

// ---------------- background effect (galaxy / flower valley) ----------------
function mountBackground(type) {
  if (type !== 'flowers' && type !== 'galaxy') type = 'flowers';
  if (bg && bgType === type) return;
  if (bg) { bg.dispose(); bg = null; }
  const old = document.getElementById('galaxy');
  const fresh = document.createElement('canvas');   // clean WebGL context per effect
  fresh.id = 'galaxy';
  old.replaceWith(fresh);
  bg = type === 'galaxy' ? initGalaxy(fresh) : initFlowers(fresh);
  bgType = type;
  const sb = $('#soundBtn');
  sb.style.display = bg.hasAudio ? '' : 'none';
  sb.setAttribute('aria-pressed', 'false');
  sb.textContent = '🔇';
  const sel = $('#bgSelect');
  if (sel.value !== type) sel.value = type;
}

// ---------------- wire toolbar ----------------
$('#bgSelect').addEventListener('change', (e) => {
  project.background = e.target.value;
  mountBackground(project.background);
  scheduleSave();
});
$('#soundBtn').addEventListener('click', () => {
  if (!bg || !bg.hasAudio || !bg.toggleSound) return;
  const playing = bg.toggleSound();
  const sb = $('#soundBtn');
  sb.setAttribute('aria-pressed', String(playing));
  sb.textContent = playing ? '🔊' : '🔇';
});
$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);
$('#previewBtn').addEventListener('click', () => togglePreview());
$('#addPageBtn').addEventListener('click', addPage);
$('#exportBtn').addEventListener('click', exportProject);
$('#importBtn').addEventListener('click', () => $('#projectInput').click());
$('#projectInput').addEventListener('change', (e) => { if (e.target.files[0]) importProjectFile(e.target.files[0]); e.target.value = ''; });
$('#uploadBtn').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', (e) => { addAssetsFromFiles([...e.target.files]); e.target.value = ''; });
$('#previewExit').addEventListener('click', () => togglePreview(false));

// drag & drop images onto the assets panel (or canvas)
['#assetsPanel', '#stage'].forEach(sel => {
  const node = $(sel);
  node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('dragover'); });
  node.addEventListener('dragleave', () => node.classList.remove('dragover'));
  node.addEventListener('drop', (e) => {
    e.preventDefault(); node.classList.remove('dragover');
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    if (files.length) addAssetsFromFiles(files);
  });
});

// cross-window sync
DB.onSync(async (type) => {
  if (gesture) return;
  if (type === 'assets' || type === 'all') await reloadAssets();
  const p = await DB.loadProject();
  if (p) { project = p; if (!project.pages.find(pg => pg.id === project.activePageId)) project.activePageId = project.pages[0].id; }
  if (!layerById(selectedId)) selectedId = null;
  if (project.background && project.background !== bgType) {
    $('#bgSelect').value = project.background;
    mountBackground(project.background);
  }
  renderAll();
  toast('已同步其他窗口的更改');
});

window.addEventListener('beforeunload', () => { DB.saveProject(project); });

// ---------------- boot ----------------
async function boot() {
  await reloadAssets();
  project = await DB.loadProject();
  if (!project || !project.pages?.length) {
    project = { version: 1, background: 'flowers', pages: [{ id: uid(), name: '首页', layers: [] }], activePageId: null };
    project.activePageId = project.pages[0].id;
    await DB.saveProject(project);
  }
  if (!project.background) { project.background = 'flowers'; scheduleSave(); }
  if (!project.pages.find(p => p.id === project.activePageId)) project.activePageId = project.pages[0].id;
  $('#bgSelect').value = project.background;
  mountBackground(project.background);
  renderAll();
  fitCanvas();
}
boot();
