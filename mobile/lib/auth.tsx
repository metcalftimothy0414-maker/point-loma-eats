import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type Profile = { id: string; full_name: string | null; role: 'customer' | 'courier' | 'admin' };

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextValue>({ session: null, profile: null, isLoading: true });

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
