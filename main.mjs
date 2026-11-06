import {
  STATUSES, STEPS, TIMEZONE, HISTORY_DAYS, singaporeDate, singaporeTime,
  singaporeDateTimeInput, fromSingaporeInput, elapsed, duration, stageDuration,
  parseProjectText, validateArchivedEdit, validateProjectDefaults, PHOTO_STAGES, PREVIOUS_STEPS, formulaRate, computeMaterials, cycleMaterials, escapeHtml as esc
} from './domain.mjs?v=1.9';
import { demoRepository, supabaseRepository } from './repository.mjs?v=1.9';

const app = document.getElementById('app');
const conf = window.ICPH_CONFIG || {};
const configured = Boolean(conf.supabaseUrl?.trim() && conf.supabaseAnonKey?.trim());
const state = {
  repo: null, mode: configured ? 'live' : 'demo', session: null,
  beds: [], projects: [], cycles: [], photos: [], formulas: [], admin: false, role: 'none', viewerCode: '', viewerData: null, selectedBed: 1, tab: 'overview',
  busy: false, online: configured ? 'CONNECTING' : 'DEMO',
  modal: null, toast: null, projectText: '', height: '', strandPattern: '', castingLength: '', strength: '', totalBatchConcrete: '',
  eventTime: singaporeDateTimeInput(), manualTime: false,
  archiveDate: '', archiveSort: 'desc', archiveSearch: '', loadError: null,
  loadVersion: 0, modalCycle: null, lightbox: null
};
let unsubscribe = null;
let unsubscribeAuth = null;
let toastTimeout = null;

const icons = {
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  layers: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 3v18M16 3v18"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  history: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M20 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  log: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/>',
  logout: '<path d="M14 7l5 5-5 5M19 12H9"/><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  camera: '<path d="M14 4h-4l-2 3H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4l-2-3Z"/><circle cx="12" cy="13" r="4"/>',
  sparkle: '<path d="m12 3 1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9L12 3Z"/>',
  wrench: '<path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18a2 2 0 0 0 3 3l5.3-5.3a5 5 0 0 0 6.4-6.4l-3.2 3.2-3.4-.7-.7-3.4 3.3-3.1Z"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7V2Z"/>'
};
const ico = (name, size = 18) => `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
const bedByNumber = n => state.beds.find(b => b.bed_no === Number(n));
const cycleForBed = b => state.cycles.find(c => c.id === b?.active_cycle_id);
const signedIn = () => state.mode === 'demo' || (Boolean(state.session?.user) && ['admin','supervisor'].includes(state.role));
const viewerActive = () => state.mode === 'live' && !signedIn() && Boolean(state.viewerCode);
const cyclePhotos = (id, stage) => state.photos.filter(p => p.cycle_id === id && (!stage || p.stage === stage));
const today = () => singaporeDate();
const allArchived = () => state.cycles.filter(c => c.cut_end && !c.deleted_at).filter(c => +new Date(c.cut_end) > Date.now() - HISTORY_DAYS * 86400000);
const castToday = () => state.cycles.filter(c => c.casting_start && singaporeDate(c.casting_start) === today());
const statValue = (count, title, detail, icon, style) => `<article class="kpi-card ${style}"><div class="kpi-top"><span>${esc(title)}</span><span class="kpi-icon">${ico(icon, 19)}</span></div><div class="kpi-number">${count}<small> ${detail}</small></div></article>`;

function num(value, decimals=2) { return value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-SG',{minimumFractionDigits:decimals,maximumFractionDigits:decimals}); }
function materialForInput() {
  const bedLen = formulaRate(state.formulas,'bed_length',state.selectedBed);
  const vol = formulaRate(state.formulas,'volume',state.height);
  const steel = formulaRate(state.formulas,'steel',state.strandPattern);
  const len = Number(state.castingLength);
  try {
    const numbers = state.castingLength && len > 0 ? computeMaterials({castingLengthM:len,bedLengthM:bedLen,volumePerM:vol,steelPerM:steel}) : null;
    return { numbers, bedLen, vol, steel, error:null };
  } catch(e) { return { numbers:null,bedLen,vol,steel,error:e.message }; }
}
function materialsMini(c) {
  const m = cycleMaterials(c);
  return m ? `<div class="material-mini"><span>Cast ${num(m.casting_length_m,2)} m</span><span>Steel waste ${num(m.steel_wastage_m,2)} m · ${num(m.steel_wastage_kg,2)} kg</span><span>Cast concrete ${num(m.concrete_volume_m3,3)} m³</span><span>Used steel ${num(m.steel_weight_kg,2)} kg</span><span>Batch concrete ${num(m.total_batch_concrete_m3,3)} m³</span><span>Concrete waste ${num(m.concrete_wastage_m3,3)} m³ / ${m.concrete_wastage_ratio == null ? '—' : num(m.concrete_wastage_ratio*100,2)+'%'}</span></div>` : '';
}
function materialsPreview() {
  const { numbers:m, bedLen, vol, steel, error } = materialForInput();
  return `<div class="material-preview-head"><strong>Automatic Material Calculation</strong>${state.admin ? `<button type="button" data-action="tab-formula" class="text-button">Formula Settings</button>` : ''}</div>
    <div class="material-preview-grid">
      <div><span>Default Bed Length</span><strong>${num(bedLen,2)} m</strong></div>
      <div><span>Steel Wastage</span><strong>${num(m?.steel_wastage_m,2)} m / ${num(m?.steel_wastage_kg,2)} kg</strong></div>
      <div><span>Steel Wastage Ratio</span><strong>${m?.steel_wastage_ratio == null ? '—' : num(m.steel_wastage_ratio*100,2)+'%'}</strong></div>
      <div><span>Concrete Volume</span><strong>${num(m?.concrete_volume_m3,3)} m³</strong></div>
      <div><span>Steel Weight</span><strong>${num(m?.steel_weight_kg,2)} kg</strong></div>
    </div>
    ${error ? `<p class="formula-warning">${esc(error)}</p>` : ''}
    ${!bedLen || !vol || !steel ? `<p class="formula-warning">Missing formula: ${[!bedLen?'Bed length':null,!vol?'Height volume factor':null,!steel?'Strand steel factor':null].filter(Boolean).join(', ')}. Missing results appear as —, not estimated.</p>` : ''}`;
}
function materialCells(c) {
  const m=cycleMaterials(c);
  return `<td>${num(m?.casting_length_m,2)}</td>
    <td>${num(m?.steel_wastage_m,2)} m <span class="muted-line">${m?.steel_wastage_ratio == null ? '—' : num(m.steel_wastage_ratio*100,2)+'%'}</span></td>
    <td>${num(m?.steel_wastage_kg,2)}</td>
    <td>${num(m?.concrete_volume_m3,3)}</td>
    <td>${num(m?.steel_weight_kg,2)}</td>
    <td>${num(m?.total_batch_concrete_m3,3)}</td>
    <td>${num(m?.concrete_wastage_m3,3)}</td>
    <td>${m?.concrete_wastage_ratio == null ? '—' : num(m.concrete_wastage_ratio*100,2)+'%'}</td>`;
}
function storedBatchPreview(c, input = '') {
  if (!c) return '';
  try {
    const m=computeMaterials({castingLengthM:c.casting_length_m,bedLengthM:c.bed_length_m,
      volumePerM:c.concrete_m3_per_m,steelPerM:c.steel_kg_per_m,
      totalBatchConcreteM3:input});
    return `<div class="batch-preview"><span>Expected casting volume: <strong>${num(m.concrete_volume_m3,3)} m³</strong></span>
      <span>Concrete wastage: <strong>${num(m.concrete_wastage_m3,3)} m³</strong></span>
      <span>Concrete wastage ratio: <strong>${m.concrete_wastage_ratio == null ? '—' : num(m.concrete_wastage_ratio*100,2)+'%'}</strong></span>
      ${m.concrete_wastage_m3 != null && m.concrete_wastage_m3 < -0.001 ? '<small class="formula-warning">Warning: total batch is less than calculated casting volume. Check both quantities.</small>' : ''}
    </div>`;
  } catch (error) { return `<p class="formula-warning">${esc(error.message)}</p>`; }
}
function selectionOptions(kind) {
  const values = new Set(state.formulas.filter(f=>f.kind===kind).map(f=>String(f.key).trim()));
  for (const row of state.projects) {
    const value = kind === 'volume' ? row.default_height_mm : row.default_strand_pattern;
    if (value != null && String(value).trim()) values.add(String(value).trim());
  }
  return [...values].sort((a,b)=>kind === 'volume' ? Number(a)-Number(b) : a.localeCompare(b))
    .map(v=>`<option value="${esc(v)}"></option>`).join('');
}
function applySelectedProjectPreset() {
  const selection = state.projectText.trim().toLowerCase();
  const project = state.projects.find(p=>[p.code, p.name, `${p.code} - ${p.name}`, `${p.code} — ${p.name}`]
    .some(label=>label.toLowerCase()===selection));
  if (!project || !project.is_default) return;
  if (project.default_height_mm != null) state.height=String(project.default_height_mm);
  if (project.default_strand_pattern) state.strandPattern=String(project.default_strand_pattern);
  const h=document.getElementById('height-field'); if (h) h.value=state.height;
  const strand=document.getElementById('strand-field'); if (strand) strand.value=state.strandPattern;
  const preview=document.getElementById('material-preview'); if (preview) preview.innerHTML=materialsPreview();
}
function header() {
  return `<header class="topbar"><div class="topbar-content">
    <div class="brand"><div class="brand-mark">${ico('layers', 25)}</div><div><div class="brand-name">ICPH<span class="brand-pipe"> / </span><span class="brand-app">PRODUCTION</span></div><div class="brand-subtitle">Production Management System</div></div></div>
    <div class="topbar-actions">
      <span class="date-display">${ico('calendar', 15)} <span id="sg-date">${esc(today())}</span></span>
      <span class="live-indicator ${state.mode === 'demo' ? 'demo' : state.online === 'SUBSCRIBED' ? 'connected' : 'offline'}"><i></i>${state.mode === 'demo' ? 'LOCAL DEMO' : viewerActive() ? 'VIEW ONLY' : state.online === 'SUBSCRIBED' ? 'LIVE SYNC' : 'SYNC ' + esc(state.online)}</span>
      <span class="topbar-time" id="sg-clock">${esc(singaporeTime(new Date(), false))} SGT</span>
      ${signedIn() ? `<button class="head-user" data-action="${state.mode === 'demo' ? 'noop' : 'sign-out'}" title="${state.mode === 'demo' ? 'Local demonstration account' : 'Sign out'}">${ico('users', 16)} <span>${esc(state.session?.user?.email || 'Demo administrator')}</span>${state.mode === 'live' ? ico('logout', 14) : ''}</button>` : viewerActive() ? `<button class="head-user" data-action="lock-viewer" title="Lock today's casting view">${ico('shield',16)} <span>VIEW ONLY · Lock</span></button><button class="head-login" data-action="show-login">Staff login</button>` : `<button class="head-login" data-action="show-login">${ico('log', 16)} Staff login</button>`}
    </div></div></header>`;
}
function nav() {
  return `<nav class="main-nav" aria-label="Production areas"><div class="product-nav">
    <button class="product-pill active">${ico('layers', 17)} HCS <span>Hollow-core Slab</span></button>
    <span class="product-pill later" title="LPS module will be added in phase two">LPS <span>Coming next</span></span>
  </div><div class="view-nav">
    <button class="view-tab ${state.tab === 'overview' ? 'active' : ''}" data-action="tab-overview">${ico('grid', 17)} Live Production</button>
    <button class="view-tab ${state.tab === 'archive' ? 'active' : ''}" data-action="tab-archive">${ico('history', 17)} Daily Production Summary <span class="tab-count">${allArchived().length}</span></button>
    ${state.admin ? `<button class="view-tab ${state.tab === 'formula' ? 'active' : ''}" data-action="tab-formula">${ico('wrench', 17)} Formula Settings</button>` : ''}
  </div></nav>`;
}
function timeline(b, c) {
  const step = STATUSES[b.status]?.step ?? -1;
  const active = b.status === 'ready_casting' ? -1 : step;
  return `<div class="stage-strip" aria-label="Production stages">${STEPS.map((name, i) => {
    const complete = (c && i === 0 && Boolean(c.prep_end)) || (c && i === 1 && Boolean(c.casting_end)) ||
      (c && i === 2 && Boolean(c.cut_start)) || (c && i === 3 && Boolean(c.cut_end));
    const inProgress = b.status !== 'ready_casting' && active === i;
    return `<div class="stage-step ${complete ? 'done' : inProgress ? 'current' : ''}"><span class="stage-dot">${complete ? ico('check', 12) : i + 1}</span><span>${name}</span></div>`;
  }).join('')}</div>`;
}
function displayDuration(c, stage, status) {
  if (!c) return '—';
  const isActive = (stage === 'preparation' && status === 'preparation') ||
    (stage === 'casting' && status === 'casting') || (stage === 'curing' && status === 'curing') ||
    (stage === 'cutting' && status === 'cutting');
  const startKey = { preparation: 'prep_start', casting: 'casting_start', curing: 'curing_start', cutting: 'cut_start' }[stage];
  const start = c[startKey];
  if (!start) return '—';
  return `<span ${isActive ? `data-stage-start="${esc(start)}"` : ''}>${duration(stageDuration(c, stage))}${isActive ? ' · live' : ''}</span>`;
}
function photoThumb(photo) {
  if (!photo.url) return '';
  return `<button type="button" class="photo-thumb" data-action="open-photo" data-photo-id="${esc(photo.id)}" aria-label="View ${esc(photo.stage)} photo full screen"><img src="${esc(photo.url)}" loading="lazy" alt="${esc(photo.stage)} production evidence" /></button>`;
}
function photoEvidence(c, includeUpload = true) {
  if (!c) return '';
  if (!signedIn()) return '<p class="photo-locked">Production photos require staff login.</p>';
  return `<section class="photo-evidence"><div class="photo-evidence-heading"><h3>Production Photos</h3><span>Tap a thumbnail to enlarge</span></div>
    ${PHOTO_STAGES.map(([stage, label]) => {
      const list = cyclePhotos(c.id, stage);
      const inputId = `photo-${stage}-${c.id}`;
      const cameraId = `camera-${stage}-${c.id}`;
      return `<div class="photo-stage"><div class="photo-stage-head"><strong>${esc(label)}</strong><span>${list.length} photo${list.length === 1 ? '' : 's'}</span></div>
        <div class="photo-stage-content">
          ${list.map(photoThumb).join('')}
          ${includeUpload ? `<button type="button" class="photo-action" data-action="choose-photo" data-input="${esc(inputId)}">${ico('plus', 16)} Add Photo</button>
            <button type="button" class="photo-action camera-action" data-action="choose-photo" data-input="${esc(cameraId)}">${ico('camera', 16)} Camera</button>
            <input id="${esc(inputId)}" class="photo-file-input" type="file" accept="image/*" data-photo-cycle="${esc(c.id)}" data-photo-stage="${stage}" />
            <input id="${esc(cameraId)}" class="photo-file-input" type="file" accept="image/*" capture="environment" data-photo-cycle="${esc(c.id)}" data-photo-stage="${stage}" />` : ''}
        </div>
      </div>`;
    }).join('')}
    ${includeUpload ? '<p class="photo-footnote">JPEG photos are compressed for mobile upload. Cloud photos are accessible only to signed-in staff.</p>' : ''}
  </section>`;
}
function bedCard(b) {
  const c = cycleForBed(b);
  const status = STATUSES[b.status] || STATUSES.available;
  const selected = b.bed_no === state.selectedBed;
  return `<article class="bed-card bed-card-horizontal ${status.color} ${selected ? 'selected' : ''}" data-action="select-bed" data-bed="${b.bed_no}" tabindex="0" role="button" aria-label="Select Bed ${b.bed_no}">
    <div class="status-banner ${status.color}">${esc(status.short)}</div>
    <div class="bed-horizontal-head">
      <div class="bed-number-pill">BED ${b.bed_no}</div>
      <div class="bed-project-block">
        <div class="bed-project">${c ? esc(c.project_name) : 'Available for next casting'}</div>
        <div class="bed-subproject">${c ? `${esc(c.project_code)} · ${esc(c.height_mm)} mm · ${esc(c.strand_pattern)}` : 'No active production cycle'}</div>
      </div>
    </div>
    <div class="bed-status-row">
      <strong class="big-status ${status.color}">${esc(status.label)}</strong>
      <span class="edit-caption">Manage ${ico('chevron', 14)}</span>
    </div>
    <div class="bed-horizontal-steps">${timeline(b, c)}</div>
    <div class="bed-horizontal-metrics">
      <div><span>Preparation</span><strong>${displayDuration(c, 'preparation', b.status)}</strong></div>
      <div><span>Casting</span><strong>${displayDuration(c, 'casting', b.status)}</strong></div>
      <div><span>Curing</span><strong>${displayDuration(c, 'curing', b.status)}</strong></div>
      <div><span>Strength</span><strong>${c?.cube_strength_mpa != null ? esc(c.cube_strength_mpa) + ' MPa' : '—'}</strong></div>
    </div>
    ${c ? materialsMini(c) : ""}
    ${c && signedIn() && cyclePhotos(c.id).length ? `<div class="bed-photo-strip">${cyclePhotos(c.id).slice(0, 3).map(photoThumb).join('')}<small>${cyclePhotos(c.id).length} photo(s)</small></div>` : ""}
  </article>`;
}
function operatorPanel() {
  const b = bedByNumber(state.selectedBed) || { bed_no: state.selectedBed, status: 'available' };
  const c = cycleForBed(b);
  const status = STATUSES[b.status] || STATUSES.available;
  const locked = !signedIn();
  const current = state.manualTime ? state.eventTime : singaporeDateTimeInput();
  const button = (action, label, style = 'primary', disabled = false) => `<button class="btn ${style}" data-process="${action}" ${disabled || state.busy ? 'disabled' : ''}>${state.busy ? ico('refresh', 17) : ico('arrow', 17)} ${esc(label)}</button>`;
  return `<aside class="operator-panel"><div class="operator-head"><div class="mini-eyebrow">OPERATIONS CONSOLE</div><h2>Update Production</h2><p>Select a bed and record each production milestone.</p></div>
  <div class="operator-content">
    <label class="field-label" for="bed-select">Production Bed <span class="required">*</span></label>
    <div class="select-wrap"><select id="bed-select" data-field="selectedBed">${state.beds.map(row => `<option value="${row.bed_no}" ${b.bed_no === row.bed_no ? 'selected' : ''}>Bed ${row.bed_no} — ${STATUSES[row.status]?.short || row.status}</option>`).join('')}</select></div>
    <div class="current-status"><span>Current bed status</span><strong class="status-badge ${status.color}"><span class="status-circle"></span>${status.label}</strong></div>
    ${c ? `<div class="active-context"><div class="active-context-head">${ico('box', 16)} CURRENT PRODUCTION</div><strong>${esc(c.project_code)} — ${esc(c.project_name)}</strong><div>${esc(c.height_mm)} mm height · ${esc(c.strand_pattern)} · ${num(c.casting_length_m,2)} m casting length</div><div class="context-start">Started ${esc(singaporeTime(c.prep_start))} SGT</div>${materialsMini(c)}</div>` : ''}
    ${locked ? `<div class="login-gate">${ico('shield', 22)}<h3>View-only access</h3><p>All staff can view live bed statuses. A supervisor account is required to update production.</p><button class="btn primary" data-action="show-login">${ico('log', 16)} Supervisor login</button></div>` : `
      ${b.status === 'available' ? `<div class="editor-fields">
        <label class="field-label" for="project-field">Project <span class="required">*</span></label>
        <input id="project-field" list="project-options" data-field="projectText" placeholder="Select or enter code - name" value="${esc(state.projectText)}" autocomplete="off" />
        <datalist id="project-options">${state.projects.map(p => `<option value="${esc(p.code)} - ${esc(p.name)}"></option>`).join('')}</datalist>
        <div class="field-note">Choose an official project or enter <b>10200 - New Project</b> to save a new code. Existing project codes cannot be assigned a different title.</div>
        <div class="two-fields"><div><label class="field-label" for="height-field">Height (mm) <span class="required">*</span></label><input id="height-field" data-field="height" type="number" list="height-default-options" min="1" max="1000" step="0.1" placeholder="Select or key in height" value="${esc(state.height)}" /><datalist id="height-default-options">${selectionOptions('volume')}</datalist></div>
        <div><label class="field-label" for="strand-field">Strand Pattern <span class="required">*</span></label><input id="strand-field" data-field="strandPattern" type="text" list="strand-default-options" maxlength="150" placeholder="Select or key in strand" value="${esc(state.strandPattern)}" /><datalist id="strand-default-options">${selectionOptions('steel')}</datalist></div></div>
        <p class="field-note">Selecting a saved Default Project can fill Height and Strand Pattern automatically. You can also choose saved options or key in your own values.</p>
        <label class="field-label" for="casting-length-field" style="margin-top:15px">Casting Length (m) <span class="required">*</span></label>
        <input id="casting-length-field" data-field="castingLength" type="number" min="0.001" max="500" step="0.001" inputmode="decimal" placeholder="e.g. 115.50" value="${esc(state.castingLength)}" />
        <div class="material-preview" id="material-preview">${materialsPreview()}</div>
      </div>` : ''}
      <div class="editor-fields time-fields"><div class="timestamp-head"><label class="field-label" for="event-time">${ico('clock', 15)} Event Date & Time (SGT)</label><button class="text-button" data-action="reset-time">Use current time</button></div>
      <input id="event-time" type="datetime-local" data-field="eventTime" value="${esc(current)}" />
      <div class="field-note">${state.manualTime ? 'Manual time selected (Singapore UTC+8).' : 'Default: actual time when you click the action button. You may backdate an event.'}</div></div>
      <div class="action-area"><div class="action-head">NEXT ACTION <span>STEP ${Math.max(1, status.step + 1)} OF 4</span></div>
      ${b.status === 'available' ? button('start_preparation', 'Start Preparation') : ''}
      ${b.status === 'preparation' ? `${button('finish_preparation', 'Finish Preparation')}<p class="action-note">Preparation duration will be recorded.</p>` : ''}
      ${b.status === 'ready_casting' ? button('start_casting', 'Start Casting') : ''}
      ${b.status === 'casting' ? `${button('finish_casting', 'Finish Casting & Start Curing')}<p class="action-note">Curing will start automatically at casting completion time.</p>` : ''}
      ${b.status === 'curing' ? `<div class="strength-entry"><label class="field-label" for="strength-field">Cube Strength (MPa) <span class="required">*</span></label><div class="strength-group"><input id="strength-field" type="number" min="0.01" max="250" step="0.01" placeholder="e.g. 38.5" data-field="strength" value="${esc(state.strength)}" />${button('set_cube_strength', 'Save Strength', 'secondary')}</div><div class="field-note">Last recorded: ${c?.cube_strength_mpa == null ? 'Not recorded' : esc(c.cube_strength_mpa) + ' MPa · ' + esc(singaporeTime(c.cube_strength_updated_at)) + ' SGT'}</div>
        <div class="cube-photo-inline"><span>Cube Strength Photo</span><div class="cube-photo-items">${cyclePhotos(c.id,'cube_strength').map(photoThumb).join('')}
        <button type="button" class="photo-action" data-action="choose-photo" data-input="cube-inline-photo-${esc(c.id)}">${ico('camera', 16)} Insert Photo</button>
        <input id="cube-inline-photo-${esc(c.id)}" class="photo-file-input" type="file" accept="image/*" data-photo-cycle="${esc(c.id)}" data-photo-stage="cube_strength" /></div></div></div>
        <div class="total-batch-entry"><label class="field-label" for="total-batch-field">Total Batch Concrete (m³)</label>
        <div class="strength-group"><input id="total-batch-field" type="number" min="0.001" max="10000" step="0.001" inputmode="decimal" placeholder="e.g. 22.500" data-field="totalBatchConcrete" value="${esc(state.totalBatchConcrete)}" />
        <button class="btn secondary" type="button" data-action="save-total-batch">Save Total Batch</button></div>
        <div id="batch-waste-preview">${storedBatchPreview(c,state.totalBatchConcrete)}</div></div>
        ${button('start_cut', 'Start Cut & Demoulding', 'primary', c?.cube_strength_mpa == null)}<p class="action-note">Cube strength must be recorded first. No automatic strength approval threshold is imposed.</p>` : ''}
      ${b.status === 'cutting' ? `<div class="total-batch-entry"><label class="field-label" for="total-batch-field">Total Batch Concrete (m³)</label>
        <div class="strength-group"><input id="total-batch-field" type="number" min="0.001" max="10000" step="0.001" inputmode="decimal" data-field="totalBatchConcrete" value="${esc(state.totalBatchConcrete)}" placeholder="e.g. 22.500" /><button class="btn secondary" type="button" data-action="save-total-batch">Save Total Batch</button></div>
        <div id="batch-waste-preview">${storedBatchPreview(c,state.totalBatchConcrete)}</div></div>
        ${button('finish_cut', 'Finish & Archive Production')}<p class="action-note">This will release Bed ${b.bed_no} and move the batch into the 30-day archive.</p>` : ''}
      ${b.status !== 'available' ? `<button class="btn back-step" type="button" data-action="back-step" ${state.busy ? 'disabled' : ''}>${ico('history', 16)} Back to Last Step · ${esc(PREVIOUS_STEPS[b.status])}</button>` : ''}
      </div>`}
  ${c ? photoEvidence(c, b.status !== 'available' && signedIn()) : ''}
  <div class="panel-footer">${ico('shield', 16)} ${state.mode === 'demo' ? 'Demo changes stay on this browser only' : 'Changes are stored securely and synced to all viewers'}</div>
  </div></aside>`;
}
function todayTable() {
  const rows = castToday().sort((a, b) => +new Date(b.casting_start) - +new Date(a.casting_start));
  return `<section class="section-card today-summary"><div class="section-card-head"><div><div class="mini-eyebrow">LIVE DAILY TRACKING</div><h2>Today's Casting Summary</h2><p>Every HCS batch with a Casting start time on ${esc(today())} (Singapore).</p></div><span class="count-chip">${rows.length} batches</span></div>
    <div class="table-scroll"><table><thead><tr><th>BED</th><th>PROJECT</th><th>HEIGHT</th><th>STRAND PATTERN</th><th>CAST START (SGT)</th><th>CAST DURATION</th><th>LENGTH (m)</th><th>STEEL WASTE (m / %)</th><th>STEEL WASTE (kg)</th><th>CASTING VOLUME (m³)</th><th>STEEL USED (kg)</th><th>TOTAL BATCH CONCRETE (m³)</th><th>CONCRETE WASTE (m³)</th><th>CONCRETE WASTE (%)</th><th>STATUS</th></tr></thead><tbody>
    ${rows.length ? rows.map(c => {
      const b = bedByNumber(c.bed_no);
      const curStatus = b?.active_cycle_id === c.id ? b.status : 'available';
      const label = c.cut_end ? 'Completed' : STATUSES[curStatus]?.short || 'In production';
      const dur = c.casting_end ? duration(elapsed(c.casting_start, c.casting_end)) : duration(elapsed(c.casting_start));
      return `<tr><td><strong>Bed ${c.bed_no}</strong></td><td><strong>${esc(c.project_code)}</strong><span class="muted-line">${esc(c.project_name)}</span></td><td>${esc(c.height_mm)} mm</td><td>${esc(c.strand_pattern)}</td><td>${esc(singaporeTime(c.casting_start))}</td><td>${dur}${c.casting_end ? '' : ' · live'}</td>${materialCells(c)}<td><span class="table-status ${c.cut_end ? 'complete' : STATUSES[curStatus]?.color || 'blue'}">${esc(label)}</span></td></tr>`;
    }).join('') : `<tr><td colspan="15" class="empty-row">${ico('box', 21)} No batches have started casting today.</td></tr>`}</tbody></table></div></section>`;
}
function overview() {
  const beds = state.beds;
  return `<div class="hero"><div><div class="eyebrow"><span class="eyebrow-line"></span> LIVE FACTORY OPERATIONS <span class="eyebrow-date">· ${esc(today())}</span></div><h1>HCS Production <span>Overview</span></h1><p>Real-time visibility across all five Hollow-core Slab production beds.</p></div>
   <button class="outline-btn" data-action="refresh">${ico('refresh', 17)} Refresh Data</button></div>
   ${state.mode === 'demo' ? `<div class="demo-banner">${ico('alert', 17)} <span><strong>Demo mode:</strong> Changes are saved in this browser only. To enable shared live data for all staff, connect Supabase using <code>config.js</code>.</span></div>` : ''}
   <div class="stats-grid">
      ${statValue(beds.filter(b => b.status !== 'available').length, 'Occupied Beds', `/ ${beds.length} total`, 'layers', 'blue-stat')}
      ${statValue(beds.filter(b => b.status === 'casting').length, 'Currently Casting', 'beds', 'activity', 'amber-stat')}
      ${statValue(beds.filter(b => b.status === 'curing').length, 'Under Curing', 'beds', 'clock', 'purple-stat')}
      ${statValue(castToday().length, 'Casting Today', 'batches', 'box', 'green-stat')}
   </div>
   <section class="horizontal-bed-section">
      <div class="section-title-row horizontal-title-row"><div><div class="mini-eyebrow">PRODUCTION FLOOR / HCS</div><h2>Bed Status Monitor <span class="muted-count">05 Lines</span></h2><p class="horizontal-section-note">Left to right overview for all beds. Click any bed to manage details.</p></div><div class="section-legend"><span><i class="key-dot free"></i> Available</span><span><i class="key-dot working"></i> In Process</span></div></div>
      <div class="bed-list bed-list-horizontal">${beds.map(bedCard).join('')}</div>
   </section>
   <div class="overview-detail-grid"><div class="summary-column">${todayTable()}</div>${operatorPanel()}</div>`;
}
function archiveRows() {
  const search = state.archiveSearch.trim().toLowerCase();
  return allArchived().filter(c => (!state.archiveDate || singaporeDate(c.casting_start || c.prep_start) === state.archiveDate) &&
    (!search || `${c.project_code} ${c.project_name} ${c.strand_pattern} bed ${c.bed_no}`.toLowerCase().includes(search)))
    .sort((a, b) => (state.archiveSort === 'asc' ? 1 : -1) * (+new Date(a.casting_start || a.prep_start) - +new Date(b.casting_start || b.prep_start)));
}
function archive() {
  const rows = archiveRows();
  const dates = new Set(allArchived().map(c => singaporeDate(c.casting_start || c.prep_start)));
  return `<div class="hero archive-hero"><div><div class="eyebrow"><span class="eyebrow-line"></span> PRODUCTION HISTORY</div><h1>Daily Production <span>Summary</span></h1><p>Completed & archived HCS production cycles from the past ${HISTORY_DAYS} days, organised by casting date (SGT).</p></div><button class="outline-btn" data-action="export-csv">${ico('download', 17)} Export CSV</button></div>
   <div class="archive-metrics"><div><span>ARCHIVED BATCHES</span><strong>${allArchived().length}</strong></div><div><span>PRODUCTION DAYS</span><strong>${dates.size}</strong></div><div><span>DATE RANGE</span><strong>Last ${HISTORY_DAYS} days</strong></div></div>
   <section class="section-card archive-section"><div class="section-card-head archive-card-head"><div><div class="mini-eyebrow">COMPLETED PRODUCTION</div><h2>Production Archive</h2><p>Records appear here only after Cut & Demoulding has finished.</p></div><span class="count-chip">${rows.length} records</span></div>
      <div class="archive-filters"><div class="filter-group"><label for="archive-date">Casting date</label><input id="archive-date" type="date" data-field="archiveDate" value="${esc(state.archiveDate)}" /></div>
        <div class="filter-group"><label for="archive-sort">Sort by date</label><select id="archive-sort" data-field="archiveSort"><option value="desc" ${state.archiveSort === 'desc' ? 'selected' : ''}>Newest first</option><option value="asc" ${state.archiveSort === 'asc' ? 'selected' : ''}>Oldest first</option></select></div>
        <div class="filter-group search-filter"><label for="archive-search">Search project / bed / strand</label><input id="archive-search" type="search" data-field="archiveSearch" placeholder="Search production records..." value="${esc(state.archiveSearch)}" /></div>
        <button class="reset-filter" data-action="clear-filters">Clear filters</button></div>
      <div class="table-scroll"><table class="archive-table"><thead><tr><th>CAST DATE</th><th>BED</th><th>PROJECT</th><th>HEIGHT</th><th>STRAND</th><th>PREPARATION</th><th>CASTING</th><th>CURING</th><th>CUBE (MPa)</th><th>CUT & DEMOULD</th><th>COMPLETED (SGT)</th><th>LENGTH (m)</th><th>STEEL WASTE (m / %)</th><th>STEEL WASTE (kg)</th><th>CASTING VOLUME (m³)</th><th>STEEL USED (kg)</th><th>TOTAL BATCH CONCRETE (m³)</th><th>CONCRETE WASTE (m³)</th><th>CONCRETE WASTE (%)</th><th>PHOTOS / ADMIN</th></tr></thead><tbody>
      ${rows.length ? rows.map(c => `<tr><td><strong>${esc(singaporeDate(c.casting_start || c.prep_start))}</strong></td><td>Bed ${c.bed_no}</td><td><strong>${esc(c.project_code)}</strong><span class="muted-line">${esc(c.project_name)}</span></td><td>${esc(c.height_mm)} mm</td><td>${esc(c.strand_pattern)}</td><td>${duration(stageDuration(c, 'preparation'))}</td><td>${duration(stageDuration(c, 'casting'))}</td><td>${duration(stageDuration(c, 'curing'), 'hours')}</td><td>${esc(c.cube_strength_mpa ?? '—')}</td><td>${duration(stageDuration(c, 'cutting'))}</td><td>${esc(singaporeTime(c.cut_end))}</td>${materialCells(c)}<td><div class="archive-actions"><button type="button" class="small-action" data-action="view-album" data-cycle-id="${esc(c.id)}">${signedIn() ? `Photos (${cyclePhotos(c.id).length})` : 'Photos (login)'}</button>${state.admin ? `<button type="button" class="small-action edit-action" data-action="edit-history" data-cycle-id="${esc(c.id)}">Edit</button><button type="button" class="small-action delete-summary-action" data-action="delete-history" data-cycle-id="${esc(c.id)}">Delete</button>` : ''}</div></td></tr>`).join('') : `<tr><td colspan="20" class="empty-row">${ico('history', 21)} No completed records match the selected filters.</td></tr>`}</tbody></table></div>
      <div class="archive-footnote">${ico('shield', 15)} Displayed archive: last 30 days by completion time · All times use Singapore Time (UTC+8) · Source: ${state.mode === 'live' ? 'Supabase production database' : 'local demo storage'}</div>
   </section>`;
}
function formulaPage() {
  const rates=state.formulas;
  const list=(kind)=>rates.filter(r=>r.kind===kind).sort((a,b)=>kind==='volume' ? Number(a.key)-Number(b.key) : a.key.localeCompare(b.key));
  const canEdit=state.admin;
  const rateInput=(kind,key,placeholder)=>`<form class="formula-inline" data-formula-kind="${kind}"><input type="hidden" name="key" value="${esc(key)}"/><input class="formula-number" type="number" name="rate" step="0.000001" min="0.000001" max="500" inputmode="decimal" placeholder="${placeholder}" value="${esc(formulaRate(rates,kind,key) ?? '')}" ${canEdit?'':'disabled'} required /><button class="btn primary formula-save" ${canEdit?'':'disabled'} type="submit">Save</button></form>`;
  const formatList=(kind,unit)=> list(kind).length ? `<div class="formula-rate-list">${list(kind).map(r=>`<div class="rate-row"><strong>${esc(r.key)}</strong><span>${num(r.rate,kind==='volume'?4:3)} ${unit}</span>${canEdit?`<button type="button" class="small-action" data-action="delete-formula" data-formula-kind="${kind}" data-formula-key="${esc(r.key)}">Remove</button>`:''}</div>`).join('')}</div>` : '<div class="formula-empty">No rates configured yet.</div>';
  return `<div class="hero formula-hero"><div><div class="eyebrow"><span class="eyebrow-line"></span> PRODUCTION CONFIGURATION</div><h1>HCS <span>Formula Settings</span></h1><p>Preset bed lengths, concrete volume per metre by HCS height, and steel weight per metre by strand pattern.</p></div></div>
    <div class="formula-help">${ico('shield',17)} ${canEdit ? 'Administrator mode: you may update these coefficients.' : 'View-only: an administrator must log in to edit coefficients.'} <b>Changes only apply to new production cycles.</b> Existing cycles retain their saved values.</div>
    <div class="formula-layout">
      <section class="formula-card"><div class="formula-card-top"><span>01 / BEDS</span><h2>Default Bed Length</h2><p>Set the maximum casting length separately for each HCS bed.</p></div>
        <div class="bed-formula-list">${[1,2,3,4,5].map(n=>`<div class="bed-formula-row"><strong>Bed ${n}</strong>${rateInput('bed_length',n,'Length (m)')}</div>`).join('')}</div>
      </section>
      <section class="formula-card"><div class="formula-card-top"><span>02 / CONCRETE</span><h2>Volume by Height</h2><p>Height (mm) → Concrete Volume (m³ per casting metre)</p></div>
        ${canEdit ? `<form class="formula-new" data-formula-kind="volume"><label>Height (mm)<input name="key" type="number" min="1" max="1000" step="0.1" placeholder="e.g. 200" required /></label><label>Volume (m³/m)<input name="rate" type="number" min="0.000001" max="500" step="0.000001" inputmode="decimal" placeholder="From approved section data" required /></label><button class="btn primary" type="submit">Save Height Formula</button></form>` : ''}
        ${formatList('volume','m³/m')}
      </section>
      <section class="formula-card"><div class="formula-card-top"><span>03 / STRANDS</span><h2>Steel by Strand Pattern</h2><p>Strand Pattern → Steel Weight (kg per casting metre)</p></div>
        ${canEdit ? `<form class="formula-new" data-formula-kind="steel"><label>Strand Pattern<input name="key" placeholder="e.g. 6T-9.53" maxlength="150" required /></label><label>Steel (kg/m)<input name="rate" type="number" min="0.000001" max="500" step="0.000001" inputmode="decimal" placeholder="From approved strand schedule" required /></label><button class="btn primary" type="submit">Save Strand Formula</button></form>` : ''}
        ${formatList('steel','kg/m')}
      </section>
    </div>
    <section class="formula-card formula-project-master">
      <div class="formula-card-top"><span>04 / PROJECT MASTER</span><h2>Default Project List</h2>
        <p>Admin-created codes and titles are the official dropdown entries. Supervisors can still manually add new codes but cannot replace an existing project title.</p>
      </div>
      ${canEdit ? `<form id="default-project-form" class="formula-new project-master-form">
        <label>Project Code<input type="text" name="code" pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,19}" maxlength="20" placeholder="e.g. 10200" required autocomplete="off" /></label>
        <label>Project Title<input type="text" name="name" minlength="2" maxlength="100" placeholder="e.g. New School Project" required autocomplete="off" /></label>
        <label>Default Height (mm)<input type="number" name="height_mm" min="0.1" max="1000" step="0.1" placeholder="e.g. 200" required /></label>
        <label>Default Strand Pattern<input type="text" name="strand_pattern" maxlength="150" placeholder="e.g. 6T-9.53" required /></label>
        <button class="btn primary" type="submit">${ico('plus',16)} Create Default Project</button>
      </form>` : ''}
      <div class="project-master-list" aria-label="Saved project codes and titles">
        ${[...state.projects].sort((a,b)=>a.code.localeCompare(b.code)).map(project => `<div class="project-master-row">
          <strong>${esc(project.code)}</strong><span class="project-master-title">${esc(project.name)}</span>
          <span class="project-master-tag ${project.is_default?'preset':'manual'}">${project.is_default?'DEFAULT · PROTECTED':'MANUAL'}</span>
          ${project.is_default ? `<div class="project-master-presets"><small>Height: ${project.default_height_mm == null ? 'Not set' : esc(project.default_height_mm)+' mm'} · Strand: ${project.default_strand_pattern ? esc(project.default_strand_pattern) : 'Not set'}</small>
            ${canEdit ? `<form class="project-preset-form" data-project-id="${esc(project.id)}">
              <label>Height (mm)<input type="number" name="height_mm" min="0.1" max="1000" step="0.1" value="${esc(project.default_height_mm ?? '')}" required /></label>
              <label>Strand Pattern<input type="text" name="strand_pattern" maxlength="150" value="${esc(project.default_strand_pattern ?? '')}" required /></label>
              <button class="small-action" type="submit">Save Presets</button></form>`:''}</div>`:''}
        </div>`).join('') || '<div class="formula-empty">No projects have been created.</div>'}
      </div>
      <p class="field-note">The same code cannot be created twice, even with a different letter case. Existing titles are never overwritten.</p>
    </section>
    <section class="formula-explanation"><h3>Calculation Method</h3><div class="explanation-grid"><div><b>Steel Wastage (m)</b><span>Default Bed Length − Casting Length</span></div><div><b>Steel Wastage (kg)</b><span>Steel Wastage Length × kg/m</span></div><div><b>Concrete Casting Volume (m³)</b><span>Casting Length × m³/m</span></div><div><b>Concrete Wastage (%)</b><span>(Total Batch Concrete − Casting Volume) ÷ Total Batch Concrete × 100%</span></div></div><p>Steel Wastage is estimated from the unused bed length and strand rate. Concrete Wastage uses the actual total batch entered under Cube Strength. Missing data displays —. Negative concrete waste indicates the reported batch is smaller than calculated casting volume and needs checking.</p></section>`;
}
function editHistoryModal() {
  const c = state.cycles.find(x => x.id === state.modalCycle);
  if (!c || !c.cut_end || !state.admin) return '';
  const dateInput = (name, label, value) => `<div><label class="field-label" for="h-${name}">${label}</label><input id="h-${name}" type="datetime-local" name="${name}" value="${esc(singaporeDateTimeInput(value))}" required /></div>`;
  return `<div class="modal-backdrop" data-action="close-modal-bg"><div class="modal-card history-editor" role="dialog" aria-modal="true" aria-label="Edit completed production history">
    <div class="modal-head"><div><div class="mini-eyebrow">ADMINISTRATOR ONLY</div><h2>Edit Production History</h2><p>Bed ${c.bed_no} · ${esc(c.project_code)} · Changes are audited.</p></div><button class="icon-button" data-action="close-modal" aria-label="Close">${ico('x', 21)}</button></div>
    <form id="history-form" data-cycle-id="${esc(c.id)}">
      <label class="field-label" for="h-project">Project</label>
      <select id="h-project" name="project_id" required>${state.projects.map(p => `<option value="${p.id}" ${Number(p.id) === Number(c.project_id) ? 'selected' : ''}>${esc(p.code)} - ${esc(p.name)}</option>`).join('')}</select>
      <div class="two-fields"><div><label class="field-label" for="h-height">Height (mm)</label><input id="h-height" name="height_mm" type="number" min="1" max="1000" step="0.1" value="${esc(c.height_mm)}" required /></div>
      <div><label class="field-label" for="h-strand">Strand Pattern</label><input id="h-strand" name="strand_pattern" value="${esc(c.strand_pattern)}" maxlength="150" required /></div></div>
      <label class="field-label" for="h-casting-length">Casting Length (m)</label>
      <input id="h-casting-length" name="casting_length_m" type="number" min="0.001" max="500" step="0.001" value="${esc(c.casting_length_m ?? '')}" placeholder="Older record: enter if available" />
      <label class="field-label" for="h-total-batch">Total Batch Concrete (m³)</label>
      <input id="h-total-batch" name="total_batch_concrete_m3" type="number" min="0.001" max="10000" step="0.001" value="${esc(c.total_batch_concrete_m3 ?? '')}" placeholder="Empty if not recorded" />
      <p class="field-note">Bed length is the snapshot at Preparation start: ${num(c.bed_length_m,2)} m. Steel wastage and concrete wastage recalculate using the batch's saved formula coefficients.</p>
      <div class="edit-time-grid">${dateInput('prep_start','Preparation Start',c.prep_start)}${dateInput('prep_end','Preparation End',c.prep_end)}${dateInput('casting_start','Casting Start',c.casting_start)}${dateInput('casting_end','Casting End / Curing Start',c.casting_end)}${dateInput('cube_strength_updated_at','Cube Test Time',c.cube_strength_updated_at)}${dateInput('cut_start','Cut Start',c.cut_start)}${dateInput('cut_end','Cut & Demould Finish',c.cut_end)}</div>
      <label class="field-label" for="h-strength">Cube Strength (MPa)</label><input id="h-strength" type="number" min="0.01" max="250" step="0.01" name="cube_strength_mpa" value="${esc(c.cube_strength_mpa)}" required />
      <p class="field-note">All times use Singapore time. The casting completion timestamp also determines curing start. Previous data will remain in the audit log.</p>
      <button class="btn primary" type="submit" ${state.busy ? 'disabled' : ''}>Save Historical Correction</button>
    </form>
    ${photoEvidence(c, true)}
  </div></div>`;
}
function deleteHistoryModal() {
  const c = state.cycles.find(x => x.id === state.modalCycle);
  if (!c || !state.admin) return '';
  return `<div class="modal-backdrop" data-action="close-modal-bg"><div class="modal-card" role="dialog" aria-modal="true" aria-label="Remove a production summary record">
    <div class="modal-head"><div><div class="mini-eyebrow">ADMINISTRATOR ONLY · AUDITED</div><h2>Delete Summary Record?</h2><p>Bed ${c.bed_no} · ${esc(c.project_code)}</p></div><button class="icon-button" data-action="close-modal">${ico('x',20)}</button></div>
    <p class="delete-explanation">This record will disappear from Daily Production Summary, but the original production information, photos and deletion audit will be retained in Supabase.</p>
    <form id="delete-history-form" data-cycle-id="${esc(c.id)}"><label class="field-label" for="delete-reason">Reason for deletion *</label><textarea id="delete-reason" name="reason" minlength="5" maxlength="300" rows="3" required placeholder="Explain why this summary record should be removed"></textarea>
    <button type="submit" class="btn danger" ${state.busy ? 'disabled' : ''}>Confirm Delete From Summary</button></form>
  </div></div>`;
}
function albumModal() {
  const c = state.cycles.find(x => x.id === state.modalCycle);
  if (!c) return '';
  return `<div class="modal-backdrop" data-action="close-modal-bg"><div class="modal-card album-modal" role="dialog" aria-modal="true" aria-label="Production photo gallery"><div class="modal-head"><div><div class="mini-eyebrow">PRODUCTION EVIDENCE</div><h2>Bed ${c.bed_no} · ${esc(c.project_code)}</h2></div><button class="icon-button" data-action="close-modal" aria-label="Close">${ico('x',21)}</button></div>${photoEvidence(c, state.admin)}</div></div>`;
}
function lightbox() {
  const p = state.photos.find(photo => photo.id === state.lightbox);
  if (!p?.url) return '';
  return `<div class="lightbox" role="dialog" aria-modal="true" aria-label="Full size production photo" data-action="close-photo-bg"><button type="button" class="lightbox-close" data-action="close-photo" aria-label="Close photo">${ico('x', 27)}</button><img src="${esc(p.url)}" alt="Enlarged ${esc(p.stage)} production photo"/><div class="lightbox-caption">${esc(PHOTO_STAGES.find(([s]) => s === p.stage)?.[1] || p.stage)} · ${esc(singaporeTime(p.created_at))}</div></div>`;
}
function modal() {
  if (!state.modal) return '';
  if (state.modal === 'edit') return editHistoryModal();
  if (state.modal === 'delete') return deleteHistoryModal();
  if (state.modal === 'album') return albumModal();
  const project = state.modal === 'project';
  return `<div class="modal-backdrop" data-action="close-modal-bg"><div class="modal-card" role="dialog" aria-modal="true" aria-label="${project ? 'Add project' : 'Supervisor login'}">
    <div class="modal-head"><div><div class="mini-eyebrow">${project ? 'PROJECT MANAGEMENT' : 'SECURE ACCESS'}</div><h2>${project ? 'Add New Project' : 'Supervisor Login'}</h2></div><button class="icon-button" data-action="close-modal" aria-label="Close">${ico('x', 21)}</button></div>
    ${project ? `<form id="project-form"><label class="field-label" for="new-code">Project Code</label><input id="new-code" name="code" placeholder="10200" maxlength="20" required />
      <label class="field-label" for="new-name">Project Name</label><input id="new-name" name="name" placeholder="New Project" maxlength="100" minlength="2" required />
      <p class="field-note">Manual entries create a NEW project only. You cannot overwrite any existing or admin-default Project Code + Title.</p>
      <button class="btn primary" type="submit" ${state.busy ? 'disabled' : ''}>${ico('plus', 17)} Add Project</button></form>` : `<form id="login-form"><label class="field-label" for="login-email">Email address</label><input id="login-email" name="email" type="email" autocomplete="username" required placeholder="supervisor@company.com" />
      <label class="field-label" for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" required placeholder="••••••••" />
      <button class="btn primary" type="submit" ${state.busy ? 'disabled' : ''}>${ico('log', 17)} Sign In</button><p class="field-note">Supervisor accounts are created by your Supabase administrator. Public self-registration is disabled.</p></form>`}
  </div></div>`;
}
function viewerGate() {
  return `<section class="verification-layout" aria-label="Verification code login">
    <div class="verification-card"><div class="verification-icon">${ico('shield',28)}</div><div class="mini-eyebrow">PCPL · HCS PRODUCTION</div><h1>Production Verification</h1>
      <p>Enter the verification code to view all five HCS beds live and today's casting summary. Visitor access is strictly read-only.</p>
      <form id="viewer-form"><label class="field-label" for="viewer-code">Verification Code</label><input id="viewer-code" type="password" name="code" required minlength="4" maxlength="128" autocomplete="off" placeholder="Enter verification code" />
      <button type="submit" class="btn primary" ${state.busy ? 'disabled' : ''}>${ico('shield',16)} Verify & View Live Beds</button></form>
      <button type="button" class="verification-staff-link" data-action="show-login">Admin / Supervisor email login</button>
    </div>
  </section>`;
}
function viewerToday() {
  const beds = state.viewerData?.beds || [];
  const rows = state.viewerData?.rows || [];
  const castDate = state.viewerData?.date || today();
  const checkedAt = state.viewerData?.checkedAt;
  const fmt = (v, d=2) => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(d);
  const time = v => v ? `${esc(singaporeTime(v, false))} SGT` : '—';
  const stageText = b => {
    const stage = b.status === 'preparation' ? 'preparation' :
      b.status === 'casting' ? 'casting' : b.status === 'curing' ? 'curing' :
      b.status === 'cutting' ? 'cutting' : null;
    if (stage) return `${esc(STATUSES[b.status]?.short || stage)} · ${duration(stageDuration(b, stage))}`;
    if (b.status === 'ready_casting') return 'Preparation completed · ready for casting';
    return b.status === 'available' ? 'Ready for next production cycle' : 'Production in progress';
  };
  return `<section class="viewer-dashboard">
    <div class="viewer-dashboard-head"><div class="mini-eyebrow">VIEW ONLY · VERIFIED VISITOR</div><h1>HCS Live Production Monitor</h1>
      <p>Bed 1–5 current status · Singapore time · Auto-refreshes every 15 seconds</p></div>
    <div class="viewer-count"><strong>${beds.length}</strong><span>HCS beds monitored · Last checked ${checkedAt ? esc(singaporeTime(checkedAt, false)) + ' SGT' : '—'}</span>
      <button type="button" class="outline-btn" data-action="refresh-viewer">${ico('refresh',16)} Refresh Now</button></div>
    <section class="viewer-live-section" aria-label="Five live HCS beds">
      <div class="viewer-section-heading"><h2>Bed Status Monitor</h2><span>READ ONLY · 5 BEDS</span></div>
      <div class="viewer-bed-grid">${beds.map(b => {
        const info = STATUSES[b.status] || STATUSES.available;
        return `<article class="viewer-live-bed ${info.color}">
          <div class="viewer-live-banner ${info.color}">BED ${esc(b.bed_no)} <span>${esc(info.label)}</span></div>
          <div class="viewer-live-body"><h3>${b.project_name ? esc(b.project_name) : 'Bed Available'}</h3>
            <p>${b.project_code ? 'Project ' + esc(b.project_code) : 'No active production cycle'}</p>
            <div class="viewer-live-stage">${ico('clock',15)} <span>${stageText(b)}</span></div>
            <dl>
              <div><dt>Height</dt><dd>${b.height_mm == null ? '—' : esc(b.height_mm) + ' mm'}</dd></div>
              <div><dt>Strand</dt><dd>${b.strand_pattern ? esc(b.strand_pattern) : '—'}</dd></div>
              <div><dt>Cast Length</dt><dd>${b.casting_length_m == null ? '—' : fmt(b.casting_length_m,2) + ' m'}</dd></div>
              <div><dt>Cube Strength</dt><dd>${b.cube_strength_mpa == null ? '—' : fmt(b.cube_strength_mpa,2) + ' MPa'}</dd></div>
            </dl>
          </div>
        </article>`;
      }).join('') || '<div class="viewer-empty">No bed data available. Try Refresh.</div>'}</div>
    </section>
    <section class="viewer-today-section" aria-label="Today casting summary">
      <div class="viewer-section-heading"><h2>Today’s Casting Summary</h2><span>${esc(castDate)} · ${rows.length} batches</span></div>
      <div class="viewer-tiles">${rows.map(c=>`<article class="viewer-tile"><div class="viewer-tile-head"><b>BED ${esc(c.bed_no)}</b><span>${esc(String(c.status||'').replaceAll('_',' ').toUpperCase())}</span></div><h3>${esc(c.project_name)}</h3><p>Project ${esc(c.project_code)}</p><dl>
        <div><dt>Height</dt><dd>${esc(c.height_mm)} mm</dd></div><div><dt>Strand Pattern</dt><dd>${esc(c.strand_pattern)}</dd></div>
        <div><dt>Casting Start</dt><dd>${time(c.casting_start)}</dd></div><div><dt>Casting Duration</dt><dd>${c.casting_start ? duration(elapsed(c.casting_start,c.casting_end||new Date())) : '—'}</dd></div>
        <div><dt>Casting Length</dt><dd>${fmt(c.casting_length_m,2)} m</dd></div><div><dt>Steel Wastage</dt><dd>${fmt(c.steel_wastage_m ?? c.wastage_m,2)} m / ${fmt(c.steel_wastage_kg,2)} kg</dd></div>
        <div><dt>Steel Wastage Ratio</dt><dd>${c.wastage_ratio == null ? '—' : fmt(Number(c.wastage_ratio)*100,2)+'%'}</dd></div>
        <div><dt>Concrete Volume</dt><dd>${fmt(c.concrete_volume_m3,3)} m³</dd></div>
        <div><dt>Steel Used</dt><dd>${fmt(c.steel_weight_kg,2)} kg</dd></div>
        <div><dt>Total Batch Concrete</dt><dd>${fmt(c.total_batch_concrete_m3,3)} m³</dd></div>
        <div><dt>Concrete Wastage</dt><dd>${fmt(c.concrete_wastage_m3,3)} m³</dd></div>
        <div><dt>Concrete Wastage Ratio</dt><dd>${c.concrete_wastage_ratio == null ? '—' : fmt(Number(c.concrete_wastage_ratio)*100,2)+'%'}</dd></div>
      </dl></article>`).join('') || '<div class="viewer-empty">No batches have started Casting today.</div>'}</div>
    </section>
    <p class="viewer-disclaimer">Viewer access is read-only. Editing production, photos, formula settings and production history requires staff login.</p>
  </section>`;
}
function render() {
  if (state.loadError) {
    app.innerHTML = `<div class="error-screen"><div class="error-panel">${ico('alert', 32)}<h1>Couldn't load production data</h1><p>${esc(state.loadError)}</p><p>Check your Supabase URL, publishable key and SQL setup in <code>README.md</code>.</p><button class="btn primary" data-action="retry">${ico('refresh', 17)} Retry connection</button></div></div>`;
    return;
  }
  const page = state.mode === 'live' && !signedIn() ? (viewerActive() ? viewerToday() : viewerGate()) :
    `${nav()}${state.tab === 'overview' ? overview() : state.tab === 'archive' ? archive() : state.admin ? formulaPage() : overview()}`;
  app.innerHTML = `<div class="app-shell">${header()}<main class="site-main">${page}
    <footer class="app-footer"><div><b>ICPH</b> / Production Control Center <span class="footer-divider">·</span> HCS Module v1.9</div><span>Timezone: ${TIMEZONE} · ${state.mode === 'demo' ? 'Local demonstration' : 'Cloud-connected'}</span></footer>
    ${signedIn() ? `<button class="floating-add" data-action="show-project" title="Add Project">${ico('plus', 19)}<span>Add Project</span></button>` : ''}</main>${modal()}${lightbox()}${state.toast ? `<div class="toast ${state.toast.type}">${ico(state.toast.type === 'error' ? 'alert' : 'check', 18)}<span>${esc(state.toast.text)}</span><button data-action="dismiss-toast">${ico('x', 16)}</button></div>` : ''}</div>`;
}
function showToast(text, type = 'success') {
  clearTimeout(toastTimeout);
  state.toast = { text, type }; render();
  toastTimeout = setTimeout(() => { state.toast = null; render(); }, type === 'error' ? 6500 : 3600);
}
async function refresh() {
  const version = ++state.loadVersion;
  if (state.mode === 'live' && !signedIn()) {
    if (viewerActive()) {
      const viewer = await state.repo.verifyViewerCode(state.viewerCode);
      if (version !== state.loadVersion) return;
      state.viewerData = viewer;
    }
    render(); return;
  }
  const data = await state.repo.getData();
  if (version !== state.loadVersion) return;
  state.beds = data.beds;
  state.projects = data.projects;
  state.cycles = data.cycles;
  state.photos = data.photos || [];
  state.formulas = data.formulas || [];
  if (document.activeElement?.id !== 'total-batch-field') {
    state.totalBatchConcrete = cycleForBed(bedByNumber(state.selectedBed))?.total_batch_concrete_m3 ?? '';
  }
  state.loadError = null;
  render();
}
async function runAction(action) {
  if (!signedIn()) return (state.modal = 'login', render());
  if (state.busy) return;
  const bed = bedByNumber(state.selectedBed);
  if (!bed) return;
  if (action === 'finish_cut' && !confirm(`Finish Cut & Demoulding for Bed ${bed.bed_no}?\n\nThe production cycle will be archived and the bed will become AVAILABLE.`)) return;
  let projectId = null;
  try {
    const p = { bedNo: bed.bed_no, action, at: state.manualTime ? fromSingaporeInput(state.eventTime) : new Date().toISOString() };
    state.busy = true; render();
    if (action === 'start_preparation') {
      if (!(Number(state.height) > 0 && Number(state.height) <= 1000)) throw new Error('Enter a valid height (0-1000 mm).');
      if (!state.strandPattern.trim()) throw new Error('Enter strand pattern.');
      if (!state.castingLength || !(Number(state.castingLength)>0)) throw new Error('Enter Casting Length in metres.');
      // Validate against configured bed capacity on the client too; database rechecks.
      computeMaterials({castingLengthM:Number(state.castingLength),bedLengthM:formulaRate(state.formulas,'bed_length',bed.bed_no),volumePerM:formulaRate(state.formulas,'volume',state.height),steelPerM:formulaRate(state.formulas,'steel',state.strandPattern)});
      const entry = parseProjectText(state.projectText, state.projects);
      let project = entry.project;
      if (entry.newProject) project = await state.repo.addProject(entry.newProject);
      projectId = project.id;
      p.projectId = projectId;
      p.heightMm = Number(state.height);
      p.strandPattern = state.strandPattern.trim();
      p.castingLengthM = Number(state.castingLength);
    }
    if (action === 'set_cube_strength') p.cubeStrengthMpa = Number(state.strength);
    await state.repo.applyAction(p);
    state.manualTime = false;
    state.eventTime = singaporeDateTimeInput();
    if (action === 'start_preparation') { state.projectText = ''; state.height = ''; state.strandPattern = ''; state.castingLength = ''; }
    if (action === 'set_cube_strength') state.strength = '';
    await refresh();
    const messages = {
      start_preparation: 'Preparation started', finish_preparation: 'Preparation finished & duration saved',
      start_casting: 'Casting started', finish_casting: 'Casting completed; Curing started automatically',
      set_cube_strength: 'Cube strength updated', start_cut: 'Cut & Demoulding started',
      finish_cut: 'Production archived and bed released'
    };
    showToast(`Bed ${bed.bed_no}: ${messages[action]}`);
  } catch (error) { showToast(error.message || 'Update failed', 'error'); }
  finally { state.busy = false; render(); }
}
async function addDefaultProject(code, name, heightMm, strandPattern) {
  if (!state.admin) return showToast('Administrator permission required to create default projects', 'error');
  try {
    state.busy = true;
    const preset=validateProjectDefaults(heightMm,strandPattern);
    await state.repo.addDefaultProject({ code: String(code).trim(), name: String(name).trim(),
      heightMm:preset.default_height_mm, strandPattern:preset.default_strand_pattern });
    await refresh();
    showToast(`Default project ${String(code).trim()} saved and added to the production dropdown`);
  } catch (error) { showToast(error.message || 'Could not save default project', 'error'); }
  finally { state.busy = false; render(); }
}
async function addProject(code, name) {
  try {
    state.busy = true;
    await state.repo.addProject({ code, name });
    state.modal = null;
    state.projectText = `${code.trim()} - ${name.trim()}`;
    await refresh();
    showToast(`Project ${code.trim()} added to the list`);
  } catch (error) { showToast(error.message || 'Unable to add project', 'error'); }
  finally { state.busy = false; render(); }
}
function exportCSV() {
  const rows = archiveRows();
  if (!rows.length) return showToast('No archived records to export', 'error');
  const headers = ['Casting Date (SGT)', 'Bed', 'Project Code', 'Project Name', 'Height mm', 'Strand Pattern', 'Casting Length m', 'Bed Length m', 'Steel Wastage m', 'Steel Wastage %', 'Steel Wastage kg', 'Concrete Casting Volume m3', 'Steel Used kg', 'Total Batch Concrete m3', 'Concrete Wastage m3', 'Concrete Wastage %', 'Preparation Start (SGT)', 'Preparation End (SGT)', 'Preparation Minutes', 'Casting Start (SGT)', 'Casting End (SGT)', 'Casting Minutes', 'Curing Start (SGT)', 'Curing Hours', 'Cube Strength MPa', 'Strength Updated (SGT)', 'Cut Start (SGT)', 'Cut End (SGT)', 'Demould Minutes'];
  const stamp = x => x ? `${singaporeDate(x)} ${singaporeTime(x, false)}` : '';
  const values = rows.map(c => [singaporeDate(c.casting_start || c.prep_start), c.bed_no, c.project_code, c.project_name, c.height_mm, c.strand_pattern, c.casting_length_m, c.bed_length_m,
    cycleMaterials(c)?.steel_wastage_m, cycleMaterials(c)?.steel_wastage_ratio == null ? '' : +(cycleMaterials(c).steel_wastage_ratio*100).toFixed(2),
    cycleMaterials(c)?.steel_wastage_kg, cycleMaterials(c)?.concrete_volume_m3, cycleMaterials(c)?.steel_weight_kg,
    cycleMaterials(c)?.total_batch_concrete_m3, cycleMaterials(c)?.concrete_wastage_m3,
    cycleMaterials(c)?.concrete_wastage_ratio == null ? '' : +(cycleMaterials(c).concrete_wastage_ratio*100).toFixed(2),
    stamp(c.prep_start), stamp(c.prep_end), Math.round(elapsed(c.prep_start, c.prep_end) / 60000),
    stamp(c.casting_start), stamp(c.casting_end), Math.round(elapsed(c.casting_start, c.casting_end) / 60000),
    stamp(c.curing_start), +(elapsed(c.curing_start, c.cut_start) / 3600000).toFixed(2),
    c.cube_strength_mpa, stamp(c.cube_strength_updated_at), stamp(c.cut_start), stamp(c.cut_end),
    Math.round(elapsed(c.cut_start, c.cut_end) / 60000)]);
  const csvValue = v => `"${String(v ?? '').replaceAll('"', '""').replace(/^[=+@\-\t\r]/, v => "'" + v)}"`;
  const contents = [headers, ...values].map(r => r.map(csvValue).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + contents], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `ICPH_HCS_Production_${today()}.csv`; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function compressPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a photo.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.');
  let bitmap, image, tempUrl;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Some iPhones decode camera photos in <img> but not via createImageBitmap.
    tempUrl = URL.createObjectURL(file);
    try {
      image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Unsupported image format. Try a JPEG or take a fresh photo.'));
        img.src = tempUrl;
      });
    } finally { URL.revokeObjectURL(tempUrl); }
  }
  const source = bitmap || image;
  const factor = Math.min(1, 1600 / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * factor));
  canvas.height = Math.max(1, Math.round(source.height * factor));
  const context = canvas.getContext('2d');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  bitmap?.close?.();
  const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  if (!jpeg || jpeg.size > 5 * 1024 * 1024) throw new Error('Unable to compress photo under 5 MB.');
  return new File([jpeg], `icph-${Date.now()}.jpg`, { type: 'image/jpeg' });
}
async function uploadPhotoInput(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (!signedIn()) throw new Error('Supervisor login required.');
    state.busy = true;
    // Preserve the file before rendering a loading state (input is destroyed).
    const cycleId = input.dataset.photoCycle;
    const stage = input.dataset.photoStage;
    render();
    const compressed = await compressPhoto(file);
    await state.repo.uploadPhoto(cycleId, stage, compressed);
    await refresh();
    showToast('Production photo uploaded successfully');
  } catch (error) { showToast(error.message || 'Photo upload failed', 'error'); }
  finally { state.busy = false; render(); }
}
async function backStep() {
  const b = bedByNumber(state.selectedBed);
  if (!b || !PREVIOUS_STEPS[b.status]) return;
  const extra = b.status === 'preparation' ? '\nThis will cancel the current production cycle (audit retained).' :
    b.status === 'curing' ? '\nCube strength will be cleared. Existing photos will remain as evidence.' : '';
  if (!confirm(`Move Bed ${b.bed_no} back from ${STATUSES[b.status].short} to ${PREVIOUS_STEPS[b.status]}?${extra}`)) return;
  try { state.busy = true; render(); await state.repo.backStep(b.bed_no); await refresh(); showToast(`Bed ${b.bed_no} moved to ${PREVIOUS_STEPS[b.status] || 'previous step'}`); }
  catch (error) { showToast(error.message || 'Unable to return to previous step', 'error'); }
  finally { state.busy = false; render(); }
}
app.addEventListener('click', async event => {
  const target = event.target.closest('[data-action], [data-process]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  if (target.dataset.process) return runAction(target.dataset.process);
  switch (action) {
    case 'choose-photo': document.getElementById(target.dataset.input)?.click(); break;
    case 'open-photo': state.lightbox = target.dataset.photoId; render(); break;
    case 'close-photo': state.lightbox = null; render(); break;
    case 'close-photo-bg': if (event.target === target) { state.lightbox = null; render(); } break;
    case 'back-step': await backStep(); break;
    case 'view-album': state.modalCycle = target.dataset.cycleId; state.modal = 'album'; render(); break;
    case 'delete-history': if (state.admin) { state.modalCycle=target.dataset.cycleId; state.modal='delete'; render(); } break;
    case 'edit-history': if (state.admin) { state.modalCycle = target.dataset.cycleId; state.modal = 'edit'; render(); } break;
    case 'select-bed': {
      state.selectedBed = Number(target.dataset.bed);
      state.manualTime = false; state.strength = cycleForBed(bedByNumber(state.selectedBed))?.cube_strength_mpa ?? '';
      state.totalBatchConcrete = cycleForBed(bedByNumber(state.selectedBed))?.total_batch_concrete_m3 ?? '';
      render(); break;
    }
    case 'tab-overview': state.tab = 'overview'; render(); break;
    case 'tab-archive': state.tab = 'archive'; render(); break;
    case 'tab-formula': if (state.admin) { state.tab = 'formula'; render(); } else showToast('Admin access required','error'); break;
    case 'save-total-batch': {
      const cycle=cycleForBed(bedByNumber(state.selectedBed));
      if (!cycle || !['curing','cutting'].includes(bedByNumber(state.selectedBed)?.status)) return showToast('Select a batch in Curing or Cutting','error');
      const amount=Number(state.totalBatchConcrete);
      if (!state.totalBatchConcrete || !(amount>0 && amount<=10000)) return showToast('Enter a valid Total Batch Concrete value (m³)','error');
      try { state.busy=true; await state.repo.setTotalBatchConcrete(cycle.id,amount); await refresh();
        showToast('Total Batch Concrete saved; wastage recalculated');
      } catch(error) { showToast(error.message,'error'); }
      finally {state.busy=false; render();}
      break;
    }
    case 'delete-formula': if (state.admin && confirm(`Remove formula ${target.dataset.formulaKey}? Previously saved cycles will not change.`)) { try {await state.repo.saveFormula(target.dataset.formulaKind,target.dataset.formulaKey,null); await refresh(); showToast('Formula removed');}catch(e){showToast(e.message,'error');} } break;
    case 'show-login': state.modal = 'login'; render(); break;
    case 'refresh-viewer': try { await refresh(); showToast('Today’s casting refreshed'); } catch(e) { showToast(e.message,'error'); } break;
    case 'lock-viewer': state.viewerCode=''; state.viewerData=null; render(); break;
    case 'show-project': state.modal = 'project'; render(); break;
    case 'close-modal': state.modal = null; render(); break;
    case 'close-modal-bg': if (event.target === target) { state.modal = null; render(); } break;
    case 'reset-time': state.manualTime = false; state.eventTime = singaporeDateTimeInput(); render(); break;
    case 'dismiss-toast': state.toast = null; render(); break;
    case 'clear-filters': state.archiveDate = ''; state.archiveSearch = ''; state.archiveSort = 'desc'; render(); break;
    case 'export-csv': exportCSV(); break;
    case 'refresh': try { await refresh(); showToast('Production data refreshed'); } catch (error) { showToast(error.message, 'error'); } break;
    case 'retry': state.loadError = null; render(); await bootstrap(); break;
    case 'sign-out': try { await state.repo.signOut(); state.session = null; state.role='none'; state.admin = false; state.photos = []; state.cycles=[]; state.projects=[]; state.beds=[]; state.formulas=[]; state.viewerCode=''; state.viewerData=null; render(); showToast('Signed out'); } catch (error) { showToast(error.message, 'error'); } break;
    default: break;
  }
});
app.addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.target.matches('.bed-card[data-action="select-bed"]')) {
    event.preventDefault(); event.target.click();
  }
  if (event.key === 'Escape' && state.lightbox) { state.lightbox = null; render(); }
  else if (event.key === 'Escape' && state.modal) { state.modal = null; render(); }
});
app.addEventListener('input', event => {
  const el = event.target;
  if (!el.dataset.field) return;
  if (el.dataset.field === 'eventTime') state.manualTime = true;
  if (el.dataset.field !== 'selectedBed') state[el.dataset.field] = el.value;
  if (['height','strandPattern','castingLength'].includes(el.dataset.field)) {
    const preview=document.getElementById('material-preview'); if (preview) preview.innerHTML=materialsPreview();
  }
  if (el.dataset.field === 'projectText') applySelectedProjectPreset();
  if (el.dataset.field === 'totalBatchConcrete') {
    const target=document.getElementById('batch-waste-preview');
    if (target) target.innerHTML=storedBatchPreview(cycleForBed(bedByNumber(state.selectedBed)),state.totalBatchConcrete);
  }
});
app.addEventListener('change', event => {
  const el = event.target;
  if (el.matches('input[data-photo-stage]')) { void uploadPhotoInput(el); return; }
  if (!el.dataset.field) return;
  if (el.dataset.field === 'projectText') {
    state.projectText=el.value; applySelectedProjectPreset();
  } else if (el.dataset.field === 'selectedBed') {
    state.selectedBed = Number(el.value);
    state.manualTime = false;
    state.strength = cycleForBed(bedByNumber(state.selectedBed))?.cube_strength_mpa ?? '';
    state.totalBatchConcrete = cycleForBed(bedByNumber(state.selectedBed))?.total_batch_concrete_m3 ?? '';
    render();
  } else if (['archiveDate', 'archiveSort', 'archiveSearch'].includes(el.dataset.field)) {
    state[el.dataset.field] = el.value; render();
  }
});
app.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const values = new FormData(form);
  if (form.id === 'viewer-form') {
    const code = String(values.get('code') || '');
    try {
      state.busy=true;
      const result=await state.repo.verifyViewerCode(code);
      state.viewerData=result; state.viewerCode=code;
      render();
    } catch(error) { showToast(error.message || 'Verification failed', 'error'); }
    finally { state.busy=false; render(); }
    return;
  }
  if (form.id === 'delete-history-form') {
    if (!state.admin) return showToast('Administrator permission required', 'error');
    const cycleId=form.dataset.cycleId;
    if (!confirm('Remove this completed batch from all production summaries? The audit record will be retained.')) return;
    try { state.busy=true; await state.repo.deleteHistory(cycleId, String(values.get('reason')||''));
      state.modal=null; state.modalCycle=null; await refresh(); showToast('Summary record removed; audit retained');
    } catch(error) { showToast(error.message || 'Delete failed','error'); }
    finally { state.busy=false; render(); }
    return;
  }
  if (form.id === 'default-project-form') return addDefaultProject(values.get('code'), values.get('name'), values.get('height_mm'), values.get('strand_pattern'));
  if (form.classList.contains('project-preset-form')) {
    if (!state.admin) return showToast('Administrator permission required','error');
    try { state.busy=true;
      await state.repo.updateProjectDefaults(Number(form.dataset.projectId),values.get('height_mm'),values.get('strand_pattern'));
      await refresh(); showToast('Project Height and Strand Pattern presets saved.');
    } catch(error) { showToast(error.message,'error'); }
    finally { state.busy=false; render(); }
    return;
  }
  if (form.id === 'project-form') return addProject(values.get('code'), values.get('name'));
  if (form.dataset.formulaKind) {
    if (!state.admin) return showToast('Administrator permission required','error');
    try { state.busy = true;
      await state.repo.saveFormula(form.dataset.formulaKind,String(values.get('key')),Number(values.get('rate')));
      await refresh(); showToast('Formula saved. New batches will use the updated rate.');
    } catch (error) { showToast(error.message || 'Save failed','error'); }
    finally {state.busy=false;}
    return;
  }
  if (form.id === 'history-form') {
    if (!state.admin) return showToast('Administrator login required', 'error');
    const c = state.cycles.find(row => row.id === form.dataset.cycleId);
    if (!c) return showToast('Archived production record not found', 'error');
    try {
      const data = {};
      for (const key of ['prep_start','prep_end','casting_start','casting_end','cube_strength_updated_at','cut_start','cut_end']) {
        const selected = String(values.get(key));
        data[key] = selected === singaporeDateTimeInput(c[key]) ? c[key] : fromSingaporeInput(selected);
      }
      for (const key of ['project_id','height_mm','strand_pattern','cube_strength_mpa','casting_length_m','total_batch_concrete_m3']) data[key] = values.get(key);
      if (data.total_batch_concrete_m3 !== '') data.total_batch_concrete_m3 = Number(data.total_batch_concrete_m3);
      if (data.casting_length_m !== '') data.casting_length_m = Number(data.casting_length_m);
      if (Number(data.height_mm) !== Number(c.height_mm)) data.concrete_m3_per_m = formulaRate(state.formulas,'volume',data.height_mm);
      if (String(data.strand_pattern).trim().toUpperCase() !== String(c.strand_pattern).trim().toUpperCase()) data.steel_kg_per_m = formulaRate(state.formulas,'steel',data.strand_pattern);
      validateArchivedEdit(c, data);
      if (!confirm('Save changes to archived production history? An audit entry will be created.')) return;
      state.busy = true; render();
      await state.repo.editHistory(c.id, data);
      state.modal = null; state.modalCycle = null;
      await refresh(); showToast('Archived production record corrected; audit saved');
    } catch (error) { showToast(error.message || 'Could not edit history', 'error'); }
    finally { state.busy = false; render(); }
    return;
  }
  if (form.id === 'login-form') {
    try {
      state.busy = true;
      const result = await state.repo.signIn(String(values.get('email')), String(values.get('password')));
      state.session = result.session || result;
      state.role = await state.repo.getRole();
      if (!['admin','supervisor'].includes(state.role)) {
        await state.repo.signOut(); state.session=null; state.role='none';
        throw new Error('Your account has not been assigned an ICPH staff role.');
      }
      state.admin = state.role === 'admin'; state.viewerCode=''; state.viewerData=null;
      state.modal = null;
      await refresh();
      showToast(`${state.admin ? 'Administrator' : 'Supervisor'} login successful`);
    } catch (error) { showToast(error.message || 'Login failed', 'error'); }
    finally { state.busy = false; render(); }
  }
});

async function bootstrap() {
  try {
    if (unsubscribe) unsubscribe();
    if (unsubscribeAuth) unsubscribeAuth();
    state.repo = configured ? await supabaseRepository(conf) : demoRepository();
    state.mode = state.repo.mode;
    const authState = await state.repo.getSession();
    state.session = state.mode === 'live' ? authState.session : authState;
    state.role = state.mode === 'demo' ? 'admin' : state.session?.user ? await state.repo.getRole() : 'none';
    if (state.mode === 'live' && state.session?.user && state.role === 'none') {
      await state.repo.signOut(); state.session = null;
    }
    state.admin = state.role === 'admin';
    unsubscribeAuth = state.repo.onAuthChange(session => {
      if (state.mode !== 'live') return;
      state.session = session;
      if (!session) {
        state.role='none'; state.admin=false;
        state.beds=[]; state.projects=[]; state.cycles=[]; state.photos=[]; state.formulas=[];
        render(); return;
      }
      Promise.resolve().then(async () => {
        const role=await state.repo.getRole();
        if (!['admin','supervisor'].includes(role)) { await state.repo.signOut(); return; }
        state.role=role; state.admin=role==='admin'; state.viewerCode=''; state.viewerData=null;
        await refresh();
      }).catch(error => showToast(error.message, 'error'));
    });
    await refresh();
    unsubscribe = state.repo.subscribe(() => {
      if (signedIn()) refresh().catch(error => showToast(error.message,'error'));
    }, status => {
      state.online = status;
      const badge = document.querySelector('.live-indicator');
      if (badge && signedIn()) {
        badge.className = `live-indicator ${status === 'SUBSCRIBED' ? 'connected' : 'offline'}`;
        badge.innerHTML = `<i></i>${status === 'SUBSCRIBED' ? 'LIVE SYNC' : 'SYNC ' + esc(status)}`;
      }
    });
  } catch (error) { state.loadError = error.message || String(error); render(); }
}
setInterval(() => {
  const clock = document.getElementById('sg-clock');
  if (clock) clock.textContent = `${singaporeTime(new Date(), false)} SGT`;
  const date = document.getElementById('sg-date');
  if (date) date.textContent = today();
  document.querySelectorAll('[data-stage-start]').forEach(node => {
    node.textContent = duration(elapsed(node.dataset.stageStart)) + ' · live';
  });
  if (!state.manualTime) {
    const input = document.getElementById('event-time');
    if (input && document.activeElement !== input) input.value = singaporeDateTimeInput();
  }
}, 15000);
setInterval(() => {
  if (state.repo && viewerActive() && !document.querySelector('input:focus, select:focus, textarea:focus'))
    refresh().catch(error => showToast(error.message || 'Could not refresh live beds', 'error'));
}, 15000);
setInterval(() => {
  if (state.repo && signedIn() && !document.querySelector('input:focus, select:focus, textarea:focus'))
    refresh().catch(() => {});
}, 30000);
bootstrap();
