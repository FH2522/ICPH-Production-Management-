// Shared rules for the offline demo and UI. Online transitions are also
// independently checked in a database transaction (see supabase/schema.sql).
export const BED_COUNT = 5;
export const TIMEZONE = 'Asia/Singapore';
export const HISTORY_DAYS = 30;
export const STATUSES = {
  available: { label: 'AVAILABLE', short: 'Available', color: 'green', step: -1 },
  preparation: { label: 'PREPARATION', short: 'Preparation', color: 'blue', step: 0 },
  ready_casting: { label: 'READY TO CAST', short: 'Ready to cast', color: 'cyan', step: 0 },
  casting: { label: 'CASTING', short: 'Casting', color: 'amber', step: 1 },
  curing: { label: 'CURING', short: 'Curing', color: 'purple', step: 2 },
  cutting: { label: 'CUT & DEMOULDING', short: 'Cut & demould', color: 'pink', step: 3 }
};
export const STEPS = ['Preparation', 'Casting', 'Curing', 'Cut & Demould'];

export function singaporeDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}
export function singaporeTime(value, date = true) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, ...(date ? { day: '2-digit', month: 'short' } : {}),
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(value));
}
export function singaporeDateTimeInput(value = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(value)).replace(' ', 'T');
}
export function fromSingaporeInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Select a valid Singapore date and time.');
  const iso = new Date(value + ':00+08:00');
  if (Number.isNaN(+iso) || singaporeDateTimeInput(iso) !== value) throw new Error('Invalid date/time.');
  return iso.toISOString();
}
export function elapsed(start, end = new Date()) {
  return start ? Math.max(0, +new Date(end) - +new Date(start)) : null;
}
export function duration(ms, scale = 'short') {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const mins = Math.round(ms / 60000);
  if (scale === 'hours') return `${(ms / 3600000).toFixed(1)} h`;
  if (mins < 60) return `${mins} min`;
  const hr = Math.floor(mins / 60);
  return `${hr}h ${String(mins % 60).padStart(2, '0')}m`;
}
export function stageDuration(cycle, stage, now = new Date()) {
  if (!cycle) return null;
  const pairs = {
    preparation: ['prep_start', 'prep_end'],
    casting: ['casting_start', 'casting_end'],
    curing: ['curing_start', 'cut_start'],
    cutting: ['cut_start', 'cut_end']
  };
  const [start, end] = pairs[stage];
  return cycle[start] ? elapsed(cycle[start], cycle[end] || now) : null;
}
export function archiveCutoff(now = new Date()) {
  return new Date(+new Date(now) - HISTORY_DAYS * 86400000).toISOString();
}
export function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
export function parseProjectText(text, projects) {
  const v = String(text || '').trim();
  if (!v) throw new Error('Select or enter a project.');
  const hit = projects.find(p => [p.code, p.name, `${p.code} - ${p.name}`, `${p.code} — ${p.name}`]
    .some(s => s.toLowerCase() === v.toLowerCase()));
  if (hit) return { project: hit };
  const match = v.match(/^([a-zA-Z0-9][a-zA-Z0-9_-]{0,19})\s+[-–—]\s+(.{2,100})$/);
  if (!match) throw new Error('New project format: 10200 - Project Name, or pick an existing project.');
  const existingCode = projects.find(p => p.code.toLowerCase() === match[1].toLowerCase());
  if (existingCode) return { project: existingCode };
  return { newProject: { code: match[1], name: match[2].trim() } };
}
export const PHOTO_STAGES = [
  ['preparation', 'Preparation'], ['casting', 'Casting'], ['curing', 'Curing'],
  ['cutting', 'Cut & Demoulding'], ['cube_strength', 'Cube Strength']
];
export const PREVIOUS_STEPS = {
  preparation: 'Available', ready_casting: 'Preparation', casting: 'Ready to Cast',
  curing: 'Casting', cutting: 'Curing'
};
export function previousStep(data, bedNo) {
  const next = structuredClone(data);
  const bed = next.beds.find(x => x.bed_no === Number(bedNo));
  if (!bed || bed.status === 'available') throw new Error('No previous production step is available.');
  const c = next.cycles.find(x => x.id === bed.active_cycle_id);
  if (!c) throw new Error('Active batch not found.');
  const prior = bed.status;
  switch (bed.status) {
    case 'preparation': c.cancelled_at = new Date().toISOString(); bed.status = 'available'; bed.active_cycle_id = null; break;
    case 'ready_casting': c.prep_end = null; bed.status = 'preparation'; break;
    case 'casting': c.casting_start = null; bed.status = 'ready_casting'; break;
    case 'curing': c.casting_end = null; c.curing_start = null; c.cube_strength_mpa = null; c.cube_strength_updated_at = null; bed.status = 'casting'; break;
    case 'cutting': c.cut_start = null; bed.status = 'curing'; break;
    default: throw new Error('Unsupported step.');
  }
  bed.updated_at = new Date().toISOString();
  next.events.push({ cycle_id: c.id, bed_no: bedNo, action: 'back_to_last_step', from_status: prior, to_status: bed.status, event_at: bed.updated_at });
  return next;
}
export function validateArchivedEdit(original, fields) {
  if (!original?.cut_end) throw new Error('Only archived production records can be edited.');
  const c = { ...original, ...fields };
  if (!(Number(c.height_mm) > 0 && Number(c.height_mm) <= 1000)) throw new Error('Invalid height.');
  if (!String(c.strand_pattern || '').trim()) throw new Error('Strand pattern is required.');
  const names = ['prep_start', 'prep_end', 'casting_start', 'casting_end', 'cut_start', 'cut_end'];
  const values = names.map(k => +new Date(c[k]));
  if (values.some(v => !Number.isFinite(v)) || values.some((v,i) => i && v < values[i-1])) throw new Error('Production timestamps must follow the process order.');
  if (values.at(-1) > Date.now() + 60000) throw new Error('Completion cannot be in the future.');
  if (!(Number(c.cube_strength_mpa) > 0 && Number(c.cube_strength_mpa) <= 250)) throw new Error('Invalid cube strength.');
  const cube = +new Date(c.cube_strength_updated_at);
  if (!Number.isFinite(cube) || cube < values[3] || cube > values[4]) throw new Error('Cube test time must be between casting completion and start of cutting.');
  return { ...c, curing_start: c.casting_end };
}
const checkTime = (when, previous) => {
  const time = +new Date(when);
  if (!Number.isFinite(time) || time > Date.now() + 60000) throw new Error('Event time must be valid and not in the future.');
  if (previous && time < +new Date(previous)) throw new Error('Event time must not be earlier than the preceding stage.');
};
export function applyDemoAction(data, { bedNo, action, at, projectId, heightMm, strandPattern, cubeStrengthMpa }) {
  const next = structuredClone(data);
  const bed = next.beds.find(x => x.bed_no === Number(bedNo));
  if (!bed) throw new Error('Bed not found.');
  const cycle = next.cycles.find(x => x.id === bed.active_cycle_id);
  checkTime(at);
  if (action === 'start_preparation') {
    if (bed.status !== 'available') throw new Error('Bed is not available. Refresh and try again.');
    const project = next.projects.find(p => p.id === Number(projectId));
    if (!project) throw new Error('Select a valid project.');
    if (!(Number(heightMm) > 0 && Number(heightMm) <= 1000)) throw new Error('Height must be between 0 and 1000 mm.');
    if (!String(strandPattern || '').trim()) throw new Error('Enter a strand pattern.');
    const record = {
      id: globalThis.crypto?.randomUUID?.() || 'cycle-' + Math.random().toString(36).slice(2),
      bed_no: bed.bed_no, project_id: project.id, project_code: project.code, project_name: project.name,
      height_mm: Number(heightMm), strand_pattern: String(strandPattern).trim(),
      prep_start: at, prep_end: null, casting_start: null, casting_end: null,
      curing_start: null, cut_start: null, cut_end: null, cube_strength_mpa: null,
      cube_strength_updated_at: null, created_at: at
    };
    next.cycles.unshift(record);
    bed.active_cycle_id = record.id;
    bed.status = 'preparation';
  } else {
    if (!cycle) throw new Error('Active batch not found.');
    switch (action) {
      case 'finish_preparation':
        if (bed.status !== 'preparation') throw new Error('Bed is not in Preparation.');
        checkTime(at, cycle.prep_start); cycle.prep_end = at; bed.status = 'ready_casting'; break;
      case 'start_casting':
        if (bed.status !== 'ready_casting') throw new Error('Finish Preparation first.');
        checkTime(at, cycle.prep_end); cycle.casting_start = at; bed.status = 'casting'; break;
      case 'finish_casting':
        if (bed.status !== 'casting') throw new Error('Bed is not in Casting.');
        checkTime(at, cycle.casting_start); cycle.casting_end = at;
        cycle.curing_start = at; bed.status = 'curing'; break;
      case 'set_cube_strength':
        if (bed.status !== 'curing') throw new Error('Cube strength is updated during Curing.');
        checkTime(at, cycle.cube_strength_updated_at || cycle.curing_start);
        if (!(Number(cubeStrengthMpa) > 0 && Number(cubeStrengthMpa) <= 250)) throw new Error('Cube strength must be 0–250 MPa.');
        cycle.cube_strength_mpa = Number(cubeStrengthMpa); cycle.cube_strength_updated_at = at; break;
      case 'start_cut':
        if (bed.status !== 'curing') throw new Error('Bed is not in Curing.');
        checkTime(at, cycle.cube_strength_updated_at || cycle.curing_start);
        if (cycle.cube_strength_mpa == null) throw new Error('Record cube strength before cut & demoulding.');
        cycle.cut_start = at; bed.status = 'cutting'; break;
      case 'finish_cut':
        if (bed.status !== 'cutting') throw new Error('Bed is not in Cut & Demoulding.');
        checkTime(at, cycle.cut_start); cycle.cut_end = at; bed.status = 'available'; bed.active_cycle_id = null; break;
      default: throw new Error('Unknown action.');
    }
  }
  bed.updated_at = at;
  next.events.push({ bed_no: bedNo, cycle_id: cycle?.id || bed.active_cycle_id, action, event_at: at });
  return next;
}
