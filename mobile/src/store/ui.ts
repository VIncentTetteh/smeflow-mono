import { create } from 'zustand';

export type AppLanguage = 'en' | 'ak' | 'ee' | 'gaa' | 'ha';

export const LANGUAGE_OPTIONS: Array<{ code: AppLanguage; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ak', label: 'Twi / Akan' },
  { code: 'ee', label: 'Ewe' },
  { code: 'gaa', label: 'Ga' },
  { code: 'ha', label: 'Hausa' },
];

interface UIState {
  theme: 'warm' | 'dark';
  language: AppLanguage;
  isOffline: boolean;
  setTheme: (t: 'warm' | 'dark') => void;
  setLanguage: (l: AppLanguage) => void;
  setOffline: (v: boolean) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  theme: 'warm',
  language: 'en',
  isOffline: false,
  setTheme: (theme) => set({ theme }),
  setLanguage: (language) => set({ language }),
  setOffline: (isOffline) => set({ isOffline }),
}));
