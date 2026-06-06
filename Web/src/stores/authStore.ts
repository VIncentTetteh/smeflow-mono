import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  role: string | null;
  userId: string | null;
  setAuth: (role: string, userId: string) => void;
  logout: () => void;
}

function createAuthStore(name: string) {
  return create<AuthState>()(
    persist(
      (set) => ({
        role: null,
        userId: null,
        setAuth: (role, userId) => set({ role, userId }),
        logout: () => set({ role: null, userId: null }),
      }),
      { name }
    )
  );
}

export const useAdminAuth = createAuthStore('admin-auth');
export const useLenderAuth = createAuthStore('lender-auth');
export const useAgentAuth = createAuthStore('agent-auth');
