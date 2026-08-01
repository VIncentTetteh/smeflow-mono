import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface BusinessMembership {
  business_id: string;
  business_name: string;
  role: string;
  is_active: boolean;
  subscription: string;
  is_current: boolean;
}

interface AuthState {
  role: string | null;
  userId: string | null;
  businessId: string | null;
  businesses: BusinessMembership[];
  setAuth: (role: string, userId: string, businessId?: string | null) => void;
  setBusiness: (businessId: string | null, role?: string) => void;
  setBusinesses: (businesses: BusinessMembership[]) => void;
  logout: () => void;
}

function createAuthStore(name: string) {
  return create<AuthState>()(
    persist(
      (set) => ({
        role: null,
        userId: null,
        businessId: null,
        businesses: [],
        setAuth: (role, userId, businessId = null) => set({ role, userId, businessId }),
        setBusiness: (businessId, role) =>
          set((s) => ({ businessId, role: role ?? s.role })),
        setBusinesses: (businesses) => set({ businesses }),
        logout: () => set({ role: null, userId: null, businessId: null, businesses: [] }),
      }),
      { name }
    )
  );
}

export const useAdminAuth = createAuthStore('admin-auth');
export const useLenderAuth = createAuthStore('lender-auth');
export const useAgentAuth = createAuthStore('agent-auth');
export const useStoreAuth = createAuthStore('store-auth');
