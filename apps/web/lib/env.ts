import 'server-only';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}; copy apps/web/.env.example to apps/web/.env.local (npm run db:start prints the values)`);
  return value;
}

export const env = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  supabaseServiceKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),
  /** Public origin of this app, used in the run URL returned to the CLI. */
  appUrl: () => (process.env.APP_URL ?? 'http://127.0.0.1:3100').replace(/\/+$/, ''),
};
