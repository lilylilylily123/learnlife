import React, { createContext, useContext, useState, useEffect } from 'react';
import { pb } from '../lib/pocketbase';
import type { AuthModel } from 'pocketbase';
import type { UserRole, ProgramCode } from '@learnlife/pb-client';

interface AuthContextType {
  user: AuthModel | null;
  isAuthenticated: boolean;
  role: UserRole | null;
  program: ProgramCode | null; // learner's program (chmk, cre, exp)
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthModel | null>(pb.authStore.model);
  const [program, setProgram] = useState<ProgramCode | null>(null);

  useEffect(() => {
    // Subscribe to auth state changes (login, logout, token refresh)
    const unsubscribe = pb.authStore.onChange((token, model) => {
      setUser(model);
    });

    // Cleanup subscription on unmount
    return () => {
      unsubscribe();
    };
  }, []);

  // Fetch learner's program when user changes
  useEffect(() => {
    async function fetchProgram() {
      console.log("[AuthContext] fetchProgram - user.learner:", user?.learner);
      if (!user?.learner) {
        setProgram(null);
        return;
      }
      try {
        const learner = await pb.collection("learners").getOne(user.learner);
        console.log("[AuthContext] Fetched learner:", learner.id, "program:", learner.program);
        setProgram((learner.program as ProgramCode) || null);
      } catch (e) {
        console.error("[AuthContext] Failed to fetch learner:", e);
        setProgram(null);
      }
    }
    fetchProgram();
  }, [user?.id, user?.learner]);

  const role = (user?.role ?? null) as UserRole | null;

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: pb.authStore.isValid, role, program }}>
      {children}
    </AuthContext.Provider>
  );
}

// Custom hook to quickly access auth state in any component
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
