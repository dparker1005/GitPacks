import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Get a GitHub API token for the given user, falling back to the server token.
 * This distributes rate limits across users (5,000/hr each) instead of sharing one pool.
 */
export async function getGitHubToken(
  supabase: SupabaseClient,
  userId: string
): Promise<string | undefined> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('github_token')
      .eq('id', userId)
      .single();
    if (data?.github_token) return data.github_token;
  } catch {
    // Fall through to server token
  }
  return process.env.GITHUB_TOKEN || undefined;
}

/** Build GitHub API headers using the provided token, or fall back to server token. */
export function gitHubHeaders(token?: string): Record<string, string> {
  const t = token || process.env.GITHUB_TOKEN;
  return t
    ? { Authorization: `token ${t}`, Accept: 'application/vnd.github.v3+json' }
    : { Accept: 'application/vnd.github.v3+json' };
}

