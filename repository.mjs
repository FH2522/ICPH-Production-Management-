import { applyDemoAction, archiveCutoff, BED_COUNT } from './domain.mjs';

const STORE = 'icph-hcs-demo-v1';
const seed = () => ({
  beds: Array.from({ length: BED_COUNT }, (_, i) => ({ bed_no: i + 1, status: 'available', active_cycle_id: null, updated_at: new Date().toISOString() })),
  projects: [
    { id: 1, code: '10108', name: 'Bedok N8C14', is_active: true },
    { id: 2, code: '10124', name: 'New Maitri School', is_active: true },
    { id: 3, code: '10061', name: 'Project L', is_active: true }
  ],
  cycles: [], events: []
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
      return { beds: d.beds, projects: d.projects.filter(p => p.is_active),
        cycles: d.cycles.filter(c => !c.cut_end || c.cut_end >= archiveCutoff()) };
    },
    async getSession() { return { user: { email: 'Demo supervisor' } }; },
    async signIn() { return { user: { email: 'Demo supervisor' } }; },
    async signOut() {},
    onAuthChange() { return () => {}; },
    async applyAction(payload) { writeDemo(applyDemoAction(readDemo(), payload)); },
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
          .or(`cut_end.is.null,cut_end.gte.${since}`)
          .order('created_at', { ascending: false }).limit(2000)
      ]);
      return { beds: unwrap(results[0]), projects: unwrap(results[1]), cycles: unwrap(results[2]) };
    },
    async getSession() { return unwrap(await client.auth.getSession()); },
    async signIn(email, password) { return unwrap(await client.auth.signInWithPassword({ email, password })); },
    async signOut() { return unwrap(await client.auth.signOut()); },
    onAuthChange(callback) {
      const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => callback(session));
      return () => subscription.unsubscribe();
    },
    async applyAction({ bedNo, action, at, projectId, heightMm, strandPattern, cubeStrengthMpa }) {
      return unwrap(await client.rpc('hcs_apply_action', {
        p_bed_no: bedNo, p_action: action, p_at: at,
        p_project_id: projectId ?? null, p_height_mm: heightMm ?? null,
        p_strand_pattern: strandPattern ?? null, p_cube_strength_mpa: cubeStrengthMpa ?? null
      }));
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
        .subscribe(status => { statusCallback?.(status); if (status === 'SUBSCRIBED') listener(); });
      return () => { clearTimeout(delay); client.removeChannel(channel); };
    }
  };
}
