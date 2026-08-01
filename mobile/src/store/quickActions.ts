/**
 * Personalizable quick actions — persisted via AsyncStorage (Expo Go compatible).
 * Merchants can long-press the home action strip to customise their 4 pinned shortcuts.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MAX_PINS = 4;

export interface QuickAction {
  id: string;
  icon: string;
  label: string;
  route: string;
  accent?: boolean;
}

export const ALL_QUICK_ACTIONS: QuickAction[] = [
  { id: 'sell',       icon: 'cart-plus',             label: 'New sale',   route: '/owner/sell',             accent: true },
  { id: 'invoices',   icon: 'file-document-outline',  label: 'Invoices',   route: '/owner/invoices' },
  { id: 'payments',   icon: 'wallet-outline',          label: 'Payments',   route: '/owner/payments-history' },
  { id: 'inventory',  icon: 'package-variant',         label: 'Stock',      route: '/owner/inventory' },
  { id: 'analytics',  icon: 'trending-up',             label: 'Analytics',  route: '/owner/analytics' },
  { id: 'expenses',   icon: 'cash-minus',              label: 'Expenses',   route: '/owner/expenses' },
  { id: 'customers',  icon: 'account-group-outline',   label: 'Customers',  route: '/owner/customers' },
  { id: 'payroll',    icon: 'account-cash-outline',    label: 'Payroll',    route: '/owner/payroll' },
  { id: 'tax',        icon: 'file-chart-outline',      label: 'Tax',        route: '/owner/tax' },
  { id: 'credit',     icon: 'credit-card-outline',     label: 'Credit',     route: '/owner/credit' },
  { id: 'sync',       icon: 'sync',                    label: 'Sync',       route: '/owner/sync' },
];

const DEFAULT_PINS = ['sell', 'invoices', 'payments', 'inventory'];

interface QuickActionsStore {
  pinnedIds: string[];
  isEditing: boolean;
  setPinned: (ids: string[]) => void;
  togglePin: (id: string) => void;
  setEditing: (editing: boolean) => void;
}

export const useQuickActionsStore = create<QuickActionsStore>()(
  persist(
    (set, get) => ({
      pinnedIds: DEFAULT_PINS,
      isEditing: false,

      setPinned: (ids) => {
        set({ pinnedIds: ids.slice(0, MAX_PINS) });
      },

      togglePin: (id) => {
        const { pinnedIds, setPinned } = get();
        if (pinnedIds.includes(id)) {
          if (pinnedIds.length <= 1) return;
          setPinned(pinnedIds.filter((p) => p !== id));
        } else if (pinnedIds.length < MAX_PINS) {
          setPinned([...pinnedIds, id]);
        }
      },

      setEditing: (isEditing) => set({ isEditing }),
    }),
    {
      name: 'quick-actions',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ pinnedIds: state.pinnedIds }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const valid = state.pinnedIds.filter((id) =>
          ALL_QUICK_ACTIONS.some((a) => a.id === id)
        );
        if (valid.length === 0) state.pinnedIds = DEFAULT_PINS;
        else state.pinnedIds = valid;
      },
    }
  )
);
