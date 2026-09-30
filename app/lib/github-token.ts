import { getSupabaseAdmin } from './supabase-admin';

/**
 * Get a GitHub API token for the given user, falling back to the server token.
 * This distributes rate limits across users (5,000/hr each) instead of sharing one pool.
 */
export async function getGitHubToken(
  userId: string
): Promise<string | undefined> {
  try {
    // Tokens live in a table only the service role can read.
    const { data } = await getSupabaseAdmin()
      .from('user_github_tokens')
      .select('token')
      .eq('user_id', userId)
      .single();
    if (data?.token) return data.token;
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

