/**
 * Supabase client — backend MUST use service role key (bypasses RLS for writes).
 * Never expose SUPABASE_SERVICE_KEY to the frontend.
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

let _client = null;

function getSupabase() {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  }

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _client;
}

module.exports = { getSupabase };
