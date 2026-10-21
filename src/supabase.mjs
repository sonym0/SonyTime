import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;
let online = navigator.onLine;

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function initSupabase() {
  if (!isConfigured()) return null;
  if (supabase) return supabase;
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    db: { schema: 'public' },
  });
  return supabase;
}

function isOnline() {
  return online;
}

window.addEventListener('online', () => { online = true; });
window.addEventListener('offline', () => { online = false; });

/**
 * Push one attendance session to Supabase.
 * Returns { ok: boolean, error?: string }
 */
export async function pushSession(session) {
  const sb = initSupabase();
  if (!sb || !isOnline()) return { ok: false, error: 'supabase_not_configured_or_offline' };
  try {
    const { error } = await sb
      .from('attendance_sessions')
      .upsert({
        id: session.id,
        i: new Date(session.i).toISOString(),
        o: session.o ? new Date(session.o).toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Push all local sessions to Supabase.
 * Returns { ok: boolean, pushed: number, errors: string[] }
 */
export async function pushAllSessions(sessions) {
  const sb = initSupabase();
  if (!sb || !isOnline()) return { ok: false, pushed: 0, errors: ['supabase_not_configured_or_offline'] };
  const errors = [];
  let pushed = 0;
  for (const s of sessions) {
    const result = await pushSession(s);
    if (result.ok) pushed += 1;
    else errors.push(`id ${s.id}: ${result.error}`);
  }
  return { ok: errors.length === 0, pushed, errors };
}

/**
 * Pull latest sessions from Supabase.
 * Returns { ok: boolean, sessions: array, error?: string }
 */
export async function pullSessions() {
  const sb = initSupabase();
  if (!sb || !isOnline()) return { ok: false, sessions: [], error: 'supabase_not_configured_or_offline' };
  try {
    const { data, error } = await sb
      .from('attendance_sessions')
      .select('id, i, o')
      .order('i', { ascending: true });
    if (error) return { ok: false, sessions: [], error: error.message };
    const sessions = (data || []).map(row => ({
      id: row.id,
      i: new Date(row.i).getTime(),
      o: row.o ? new Date(row.o).getTime() : null,
    }));
    return { ok: true, sessions };
  } catch (err) {
    return { ok: false, sessions: [], error: err?.message || String(err) };
  }
}

export { isConfigured, isOnline, initSupabase };
