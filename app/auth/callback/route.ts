import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  // Validate redirect target to prevent open redirect
  if (!next.startsWith('/') || next.startsWith('//')) {
    return NextResponse.redirect(`${origin}/`);
  }

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();
      const providerToken = sessionData?.session?.provider_token ?? null;
      if (user) {
        const meta = user.user_metadata;
        const username = meta.user_name || meta.preferred_username || '';

        // Check if profile already exists (returning user)
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .single();

        const isNewUser = !existingProfile;

        // Create profile if needed
        await supabase.from('profiles').upsert({
          id: user.id,
          github_username: username,
          avatar_url: meta.avatar_url || '',
          bonus_packs: 10,
          referral_code: username || undefined,
        }, { onConflict: 'id', ignoreDuplicates: true });

        // Always store/refresh the GitHub token (works for new and returning users)
        if (providerToken) {
          await supabase.from('profiles')
            .update({ github_token: providerToken })
            .eq('id', user.id);
        }

        // Process referral for new users only
        const ref = searchParams.get('gpref');
        if (isNewUser && ref) {
          await supabase.rpc('process_referral', {
            p_new_user_id: user.id,
            p_referral_code: ref,
          });
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
