import { applyDemoAction, archiveCutoff, BED_COUNT, previousStep, validateArchivedEdit, validateFormula, validateProjectDefaults, formulaRate, computeMaterials } from './domain.mjs?v=1.9';
import { storeDemoPhoto, loadDemoPhoto } from './attachments.mjs';

const STORE = 'icph-hcs-demo-v1';
const demoUrlCache = new Map();
const newId = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const seed = () => ({
  beds: Array.from({ length: BED_COUNT }, (_, i) => ({ bed_no: i + 1, status: 'available', active_cycle_id: null, updated_at: new Date().toISOString() })),
  projects: [
    { id: 1, code: '10108', name: 'Bedok N8C14', is_active: true, is_default: true },
    { id: 2, code: '10124', name: 'New Maitri School', is_active: true, is_default: true },
    { id: 3, code: '10061', name: 'Project L', is_active: true, is_default: true }
  ],
  cycles: [], events: [], photos: [], history_edits: [], formulas: []
});
let memory = seed();
function readDemo() {
  try { const s = localStorage.getItem(STORE); return s ? JSON.parse(s) : memory; }
  catch { return memory; }
}
function writeDemo(data) {
  memory = data;
  try { localStorage.setItem(STORE, JSON.stringify(data)); } catch { /* private mode */ }
}
export function demoRepository() {
  return {
    mode: 'demo',
    async getData() {
      const d = readDemo();
      const cycles = d.cycles.filter(c => !c.cancelled_at && !c.deleted_at && (!c.cut_end || c.cut_end >= archiveCutoff()));
      const photos = [];
      for (const photo of d.photos || []) {
        if (!cycles.some(c => c.id === photo.cycle_id)) continue;
        if (!demoUrlCache.has(photo.id)) {
          const blob = await loadDemoPhoto(photo.id);
          if (blob) demoUrlCache.set(photo.id, URL.createObjectURL(blob));
        }
        if (demoUrlCache.has(photo.id)) photos.push({ ...photo, url: demoUrlCache.get(photo.id) });
      }
      return { beds: d.beds, projects: d.projects.filter(p => p.is_active).map(p => ({ ...p, is_default: p.is_default === true || [["10108","Bedok N8C14"],["10124","New Maitri School"],["10061","Project L"]].some(([code,name]) => p.code === code && p.name === name) })), cycles, photos, formulas: d.formulas || [] };
    },
    async getSession() { return { user: { email: 'Demo administrator' } }; },
    async isAdmin() { return true; },
    async getRole() { return 'admin'; },
    async verifyViewerCode() { throw new Error('Verification is used only in live mode.'); },
    async signIn() { return { user: { email: 'Demo supervisor' } }; },
    async signOut() {},
    onAuthChange() { return () => {}; },
    async applyAction(payload) { writeDemo(applyDemoAction(readDemo(), payload)); },
    async setTotalBatchConcrete(cycleId, totalBatchConcreteM3) {
      const d = readDemo();
      const c = d.cycles.find(row => row.id === cycleId);
      const bed = d.beds.find(row => row.active_cycle_id === cycleId);
      if (!c || !bed || !['curing','cutting'].includes(bed.status)) throw new Error('Batch must be in Curing or Cutting.');
      const value = Number(totalBatchConcreteM3);
      if (!(value > 0 && value <= 10000)) throw new Error('Total Batch Concrete must be > 0 and <= 10,000 m³.');
      c.total_batch_concrete_m3 = value;
      d.events.push({cycle_id:c.id,bed_no:c.bed_no,action:'set_total_batch_concrete',event_at:new Date().toISOString()});
      writeDemo(d);
    },
    async backStep(bedNo) { writeDemo(previousStep(readDemo(), bedNo)); },
    async editHistory(cycleId, fields) {
      const d = readDemo();
      const ix = d.cycles.findIndex(c => c.id === cycleId);
      if (ix === -1) throw new Error('Production record not found.');
      const prior = structuredClone(d.cycles[ix]);
      const project = d.projects.find(p => Number(p.id) === Number(fields.project_id));
      if (!project) throw new Error('Select a valid project.');
      const rateHeight = Number(fields.height_mm) === Number(prior.height_mm) ? prior.concrete_m3_per_m : formulaRate(d.formulas, 'volume', fields.height_mm);
      const rateSteel = String(fields.strand_pattern).trim().toUpperCase() === String(prior.strand_pattern).trim().toUpperCase() ? prior.steel_kg_per_m : formulaRate(d.formulas, 'steel', fields.strand_pattern);
      const length = fields.casting_length_m == null || fields.casting_length_m === '' ? null : Number(fields.casting_length_m);
      d.cycles[ix] = validateArchivedEdit(prior, {
        casting_length_m: length, concrete_m3_per_m:rateHeight ?? null, steel_kg_per_m:rateSteel ?? null,
        ...fields, project_code: project.code, project_name: project.name,
        height_mm: Number(fields.height_mm), cube_strength_mpa: Number(fields.cube_strength_mpa)
      });
      (d.history_edits ||= []).push({ cycle_id: cycleId, before: prior, after: d.cycles[ix], edited_at: new Date().toISOString() });
      writeDemo(d);
    },
    async deleteHistory(cycleId, reason) {
      const data = readDemo();
      const cycle = data.cycles.find(c => c.id === cycleId);
      if (!cycle || !cycle.cut_end || cycle.cancelled_at || cycle.deleted_at) throw new Error('Only completed summary records can be deleted.');
      if (String(reason || '').trim().length < 5) throw new Error('Enter a deletion reason.');
      const prior = structuredClone(cycle);
      cycle.deleted_at = new Date().toISOString();
      cycle.deleted_by = 'demo-admin';
      cycle.deletion_reason = reason.trim();
      (data.history_edits ||= []).push({ cycle_id: cycleId, before: prior, after: structuredClone(cycle), edited_at: new Date().toISOString(), action: 'delete_summary' });
      writeDemo(data);
    },
    async saveFormula(kind, key, rate) {
      const item = validateFormula(kind, key, rate);
      const d = readDemo(); d.formulas ||= [];
      d.formulas = d.formulas.filter(r => !(r.kind === item.kind && r.key.toUpperCase() === item.key.toUpperCase()));
      if (item.rate != null) d.formulas.push(item);
      writeDemo(d);
    },
    async uploadPhoto(cycleId, stage, file) {
      const d = readDemo();
      if (!d.cycles.some(c => c.id === cycleId)) throw new Error('Batch not found.');
      const photo = { id: newId(), cycle_id: cycleId, stage, created_at: new Date().toISOString(), uploaded_by: 'demo' };
      await storeDemoPhoto(photo.id, file);
      (d.photos ||= []).push(photo);
      writeDemo(d);
      return photo;
    },
    async addProject({ code, name }) {
      const d = readDemo();
      code = String(code).trim(); name = String(name).trim();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,19}$/.test(code) || name.length < 2 || name.length > 100) throw new Error('Invalid project code or name.');
      if (d.projects.some(p => p.code.toLowerCase() === code.toLowerCase())) throw new Error('This project code already exists. Use its registered project title.');
      const project = { id: Math.max(0, ...d.projects.map(p => p.id)) + 1, code, name, is_active: true, is_default: false };
      d.projects.push(project); writeDemo(d); return project;
    },
    async addDefaultProject({ code, name, heightMm, strandPattern }) {
      const d = readDemo();
      code = String(code).trim(); name = String(name).trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(code) || name.length < 2 || name.length > 100) throw new Error('Invalid project code or title.');
      if (d.projects.some(row => row.code.toLowerCase() === code.toLowerCase())) throw new Error(`Project code ${code} already exists. Existing project codes and titles cannot be overwritten.`);
      const preset = validateProjectDefaults(heightMm, strandPattern);
      const project = { id: Math.max(0, ...d.projects.map(row => row.id)) + 1, code, name, is_active: true, is_default: true, ...preset };
      d.projects.push(project); writeDemo(d); return project;
    },
    async updateProjectDefaults(projectId, heightMm, strandPattern) {
      const d = readDemo();
      const project = d.projects.find(row => Number(row.id) === Number(projectId));
      if (!project || !project.is_default) throw new Error('Only default projects can receive saved height and strand presets.');
      Object.assign(project, validateProjectDefaults(heightMm, strandPattern));
      writeDemo(d); return project;
    },
    subscribe(callback) {
      const fn = (event) => { if (event.key === STORE) callback(); };
      window.addEventListener('storage', fn);
      return () => window.removeEventListener('storage', fn);
    }
  };
}
export async function supabaseRepository({ supabaseUrl, supabaseAnonKey }) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
  });
  const urlCache = new Map();
  const unwrap = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    mode: 'live',
    async getData() {
      const since = archiveCutoff();
      const results = await Promise.all([
        client.from('hcs_beds').select('*').order('bed_no', { ascending: true }),
        client.from('hcs_projects').select('*').eq('is_active', true).order('code'),
        client.from('hcs_cycles').select('*')
          .is('cancelled_at', null).is('deleted_at', null).or(`cut_end.is.null,cut_end.gte.${since}`)
          .order('created_at', { ascending: false }).limit(2000),
        client.from('hcs_formula_rates').select('kind,key,rate').order('kind')
      ]);
      const cycles = unwrap(results[2]);
      let photos = [];
      const { data: { session } } = await client.auth.getSession();
      if (session) {
        const ids = cycles.map(c => c.id);
        if (ids.length) {
          // Batch UUID filter to avoid overlong URLs on busy factory months.
          const records = [];
          for (let index = 0; index < ids.length; index += 75) {
            const idBatch = ids.slice(index, index + 75);
            for (let offset = 0; offset < 5000; offset += 500) {
              const batch = unwrap(await client.from('hcs_photos').select('*').in('cycle_id', idBatch)
                .order('created_at', { ascending: false }).range(offset, offset + 499));
              records.push(...batch);
              if (batch.length < 500) break;
            }
          }
          const missing = [...new Set(records.map(p => p.storage_path).filter(path => !urlCache.has(path) || urlCache.get(path).expiry < Date.now()))];
          if (missing.length) {
            for (let i = 0; i < missing.length; i += 100) {
              const paths = missing.slice(i, i + 100);
              const signed = unwrap(await client.storage.from('hcs-photos').createSignedUrls(paths, 3600));
              signed.forEach((item, j) => { if (item.signedUrl) urlCache.set(paths[j], { url: item.signedUrl, expiry: Date.now() + 45 * 60000 }); });
            }
          }
          photos = records.map(p => ({ ...p, url: urlCache.get(p.storage_path)?.url || '' }));
        }
      }
      return { beds: unwrap(results[0]), projects: unwrap(results[1]), cycles, photos, formulas: unwrap(results[3]) };
    },
    async getSession() { return unwrap(await client.auth.getSession()); },
    async isAdmin() { return Boolean(unwrap(await client.rpc('hcs_is_admin'))); },
    async getRole() { return String(unwrap(await client.rpc('hcs_my_role')) || 'none'); },
    async verifyViewerCode(code) {
      const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/icph-viewer`;
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }), cache: 'no-store'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Verification failed.');
      if (!Array.isArray(result.rows) || !Array.isArray(result.beds)) throw new Error('Invalid viewer response.');
      return result;
    },
    async signIn(email, password) { return unwrap(await client.auth.signInWithPassword({ email, password })); },
    async signOut() { return unwrap(await client.auth.signOut()); },
    onAuthChange(callback) {
      const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => callback(session));
      return () => subscription.unsubscribe();
    },
    async applyAction({ bedNo, action, at, projectId, heightMm, strandPattern, castingLengthM, cubeStrengthMpa }) {
      if (action === 'start_preparation') return unwrap(await client.rpc('hcs_begin_preparation_v15', {
        p_bed_no:bedNo, p_at:at, p_project_id:projectId, p_height_mm:heightMm,
        p_strand_pattern:strandPattern, p_casting_length_m:castingLengthM
      }));
      return unwrap(await client.rpc('hcs_apply_action', {
        p_bed_no: bedNo, p_action: action, p_at: at,
        p_project_id: projectId ?? null, p_height_mm: heightMm ?? null,
        p_strand_pattern: strandPattern ?? null, p_cube_strength_mpa: cubeStrengthMpa ?? null
      }));
    },
    async backStep(bedNo) { return unwrap(await client.rpc('hcs_back_step', { p_bed_no: bedNo })); },
    async setTotalBatchConcrete(cycleId, totalBatchConcreteM3) {
      return unwrap(await client.rpc('hcs_set_total_batch_concrete', {
        p_cycle_id: cycleId, p_total_batch_concrete_m3: Number(totalBatchConcreteM3)
      }));
    },
    async editHistory(cycleId, f) {
      return unwrap(await client.rpc('hcs_edit_history_v19', {
        p_cycle_id: cycleId, p_project_id: Number(f.project_id), p_height_mm: Number(f.height_mm),
        p_strand_pattern: f.strand_pattern, p_casting_length_m:f.casting_length_m === '' ? null : f.casting_length_m,
        p_total_batch_concrete_m3:f.total_batch_concrete_m3 === '' || f.total_batch_concrete_m3 == null ? null : Number(f.total_batch_concrete_m3),
        p_prep_start: f.prep_start, p_prep_end: f.prep_end,
        p_casting_start: f.casting_start, p_casting_end: f.casting_end, p_cut_start: f.cut_start,
        p_cut_end: f.cut_end, p_cube_strength_mpa: Number(f.cube_strength_mpa),
        p_cube_strength_updated_at: f.cube_strength_updated_at
      }));
    },
    async deleteHistory(cycleId, reason) {
      return unwrap(await client.rpc('hcs_delete_history', { p_cycle_id: cycleId, p_reason: reason }));
    },
    async saveFormula(kind, key, rate) {
      const item = validateFormula(kind, key, rate);
      return unwrap(await client.rpc('hcs_save_formula', {
        p_kind:item.kind, p_key:item.key, p_rate:item.rate
      }));
    },
    async uploadPhoto(cycleId, stage, file) {
      const { data: { user }, error: authError } = await client.auth.getUser();
      if (authError || !user) throw new Error('Log in before uploading photos.');
      const name = `${user.id}/${cycleId}/${stage}/${newId()}.jpg`;
      unwrap(await client.storage.from('hcs-photos').upload(name, file, { cacheControl: '3600', upsert: false, contentType: 'image/jpeg' }));
      try {
        return unwrap(await client.rpc('hcs_add_photo', { p_cycle_id: cycleId, p_stage: stage, p_storage_path: name }));
      } catch (error) {
        await client.storage.from('hcs-photos').remove([name]).catch(() => {});
        throw error;
      }
    },
    async addProject({ code, name }) {
      return unwrap(await client.rpc('hcs_add_project', { p_code: code, p_name: name }));
    },
    async addDefaultProject({ code, name, heightMm, strandPattern }) {
      const preset = validateProjectDefaults(heightMm, strandPattern);
      return unwrap(await client.rpc('hcs_add_default_project_v19', {
        p_code: code, p_name: name,
        p_default_height_mm: preset.default_height_mm,
        p_default_strand_pattern: preset.default_strand_pattern
      }));
    },
    async updateProjectDefaults(projectId, heightMm, strandPattern) {
      const preset = validateProjectDefaults(heightMm, strandPattern);
      return unwrap(await client.rpc('hcs_set_default_project_options', {
        p_project_id: projectId,
        p_default_height_mm: preset.default_height_mm,
        p_default_strand_pattern: preset.default_strand_pattern
      }));
    },
    subscribe(callback, statusCallback) {
      let delay;
      const listener = () => { clearTimeout(delay); delay = setTimeout(callback, 180); };
      const channel = client.channel('icph-hcs-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hcs_beds' }, listener)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hcs_cycles' }, listener)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hcs_projects' }, listener)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hcs_photos' }, listener)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'hcs_formula_rates' }, listener)
        .subscribe(status => { statusCallback?.(status); if (status === 'SUBSCRIBED') listener(); });
      return () => { clearTimeout(delay); client.removeChannel(channel); };
    }
  };
}

