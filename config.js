// Supabase project credentials — these are the PUBLIC anon key and URL.
// It is safe to commit these values; data is protected by Row-Level Security,
// not by keeping the key secret. Fill in after creating your Supabase project.
export const SUPABASE_URL = '';      // e.g. 'https://xyzxyz.supabase.co'
export const SUPABASE_ANON_KEY = ''; // starts with 'eyJ...'

// Configurable business rules (overridden by app_settings row in Phase 2)
export const OT_THRESHOLD_HOURS = 40;

// Week starts on Saturday (JS Date.getDay(): 0=Sun … 6=Sat)
export const WEEK_START_DAY = 6;
