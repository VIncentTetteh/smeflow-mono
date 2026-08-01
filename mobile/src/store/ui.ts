import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Canonical app language set — matches the backend (en, ak=Twi, ee=Ewe, gaa=Ga,
// pcm=Pidgin). Legacy codes are migrated on load.
export type AppLanguage = 'en' | 'ak' | 'ee' | 'gaa' | 'pcm';

export const LANGUAGE_OPTIONS: Array<{ code: AppLanguage; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ak', label: 'Twi / Akan' },
  { code: 'ee', label: 'Ewe' },
  { code: 'gaa', label: 'Ga' },
  { code: 'pcm', label: 'Pidgin' },
];

const LEGACY_LANG: Record<string, AppLanguage> = { tw: 'ak', ew: 'ee', ga: 'gaa', ha: 'en', pid: 'pcm' };

function normalizeLang(code: string | undefined): AppLanguage {
  if (!code) return 'en';
  const mapped = LEGACY_LANG[code] ?? (code as AppLanguage);
  return (['en', 'ak', 'ee', 'gaa', 'pcm'] as AppLanguage[]).includes(mapped) ? mapped : 'en';
}

interface UIState {
  theme: 'warm' | 'dark';
  language: AppLanguage;
  isOffline: boolean;
  setTheme: (t: 'warm' | 'dark') => void;
  setLanguage: (l: AppLanguage) => void;
  setOffline: (v: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'warm',
      language: 'en',
      isOffline: false,
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language: normalizeLang(language) }),
      setOffline: (isOffline) => set({ isOffline }),
    }),
    {
      name: 'sf-ui',
      storage: createJSONStorage(() => AsyncStorage),
      // Don't persist transient connectivity state.
      partialize: (s) => ({ theme: s.theme, language: s.language }),
      onRehydrateStorage: () => (state) => {
        if (state) state.language = normalizeLang(state.language);
      },
    }
  )
);
