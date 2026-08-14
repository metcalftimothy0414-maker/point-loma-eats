import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { registerForPushNotificationsAsync } from './notifications';

export type Profile = { id: string; full_name: string | null; role: 'customer' | 'courier' | 'admin' };

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextValue>({ session: null, profile: null, isLoading: true });

async function registerPushToken(userId: string): Promise<void> {
  const token = await registerForPushNotificationsAsync();
  if (!token) return;
  await supabase.from('profiles').update({ expo_push_token: token }).eq('id', userId);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // Bundles session + profile into one loading state — routing (which
    // group to redirect into) depends on role, so "signed in but role not
    // known yet" needs to read as still-loading, not as customer-by-default.
    async function syncSession(nextSession: Session | null) {
      if (!isMounted) return;
      setSession(nextSession);

      if (nextSession) {
        const { data } = await supabase
          .from('profiles')
          .select('id, full_name, role')
          .eq('id', nextSession.user.id)
          .single();
        if (isMounted) setProfile(data ?? null);
        // Fire-and-forget: registration can be slow (permission prompt) or
        // fail outright (simulator, no EAS project — see notifications.ts),
        // and none of that should hold up routing.
        void registerPushToken(nextSession.user.id);
      } else {
        setProfile(null);
      }

      if (isMounted) setIsLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => syncSession(data.session));

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setIsLoading(true);
      syncSession(nextSession);
    });

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ session, profile, isLoading }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
