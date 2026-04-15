import React, { createContext, useContext, useState, useEffect } from 'react';
import { pb } from '../lib/pocketbase';
import type { AuthModel } from 'pocketbase';
import type { UserRole } from '@learnlife/pb-client';

interface AuthContextType {
  user: AuthModel | null;
  isAuthenticated: boolean;
  role: UserRole | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthModel | null>(pb.authStore.model);

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

  const role = (user?.role ?? null) as UserRole | null;

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: pb.authStore.isValid, role }}>
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
