import { createClient } from '@supabase/supabase-js';

const BUCKET = 'og-images';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function invalidateOgCache(owner: string, repo: string) {
  const supabase = getServiceSupabase();
  const prefix = `cards/${owner}/${repo}`.toLowerCase();
  const { data: files } = await supabase.storage.from(BUCKET).list(prefix);
  if (!files?.length) return;
  const paths = files.map((f) => `${prefix}/${f.name}`);
  await supabase.storage.from(BUCKET).remove(paths);
}
