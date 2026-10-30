import { applyDemoAction, archiveCutoff, BED_COUNT, previousStep, validateArchivedEdit, validateFormula, formulaRate, computeMaterials } from './domain.mjs';
import { storeDemoPhoto, loadDemoPhoto } from './attachments.mjs';

const STORE = 'icph-hcs-demo-v1';
const demoUrlCache = new Map();
const newId = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const seed = () => ({
  beds: Array.from({ length: BED_COUNT }, (_, i) => ({ bed_no: i + 1, status: 'available', active_cycle_id: null, updated_at: new Date().toISOString() })),
  projects: [
    { id: 1, code: '10108', name: 'Bedok N8C14', is_active: true },
    { id: 2, code: '10124', name: 'New Maitri School', is_active: true },
    { id: 3, code: '10061', name: 'Project L', is_active: true }
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
      const cycles = d.cycles.filter(c => !c.cancelled_at && (!c.cut_end || c.cut_end >= archiveCutoff()));
      const photos = [];
      for (const photo of d.photos || []) {
        if (!cycles.some(c => c.id === photo.cycle_id)) continue;
        if (!demoUrlCache.has(photo.id)) {
          const blob = await loadDemoPhoto(photo.id);
          if (blob) demoUrlCache.set(photo.id, URL.createObjectURL(blob));
        }
        if (demoUrlCache.has(photo.id)) photos.push({ ...photo, url: demoUrlCache.get(photo.id) });
      }
      return { beds: d.beds, projects: d.projects.filter(p => p.is_active), cycles, photos, formulas: d.formulas || [] };
    },
    async getSession() { return { user: { email: 'Demo administrator' } }; },
    async isAdmin() { return true; },
    async signIn() { return { user: { email: 'Demo supervisor' } }; },
    async signOut() {},
    onAuthChange() { return () => {}; },
    async applyAction(payload) { writeDemo(applyDemoAction(readDemo(), payload)); },
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
      if (d.projects.some(p => p.code.toLowerCase() === code.toLowerCase())) throw new Error('This project code already exists.');
      const project = { id: Math.max(0, ...d.projects.map(p => p.id)) + 1, code, name, is_active: true };
      d.projects.push(project); writeDemo(d); return project;
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
          .is('cancelled_at', null).or(`cut_end.is.null,cut_end.gte.${since}`)
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
    async editHistory(cycleId, f) {
      return unwrap(await client.rpc('hcs_edit_history_v15', {
        p_cycle_id: cycleId, p_project_id: Number(f.project_id), p_height_mm: Number(f.height_mm),
        p_strand_pattern: f.strand_pattern, p_casting_length_m:f.casting_length_m === '' ? null : f.casting_length_m, p_prep_start: f.prep_start, p_prep_end: f.prep_end,
        p_casting_start: f.casting_start, p_casting_end: f.casting_end, p_cut_start: f.cut_start,
        p_cut_end: f.cut_end, p_cube_strength_mpa: Number(f.cube_strength_mpa),
        p_cube_strength_updated_at: f.cube_strength_updated_at
      }));
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
