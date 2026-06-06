import { create } from 'zustand';
import type { ToastTone } from '@/components/ui/Toast';

interface ToastState {
  message: string;
  tone: ToastTone;
  visible: boolean;
  show: (message: string, tone?: ToastTone) => void;
  hide: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  message: '',
  tone: 'success' as ToastTone,
  visible: false,
  show: (message: string, tone: ToastTone = 'success') => set({ message, tone, visible: true }),
  hide: () => set({ visible: false }),
}));

// Imperative helper — usable outside React components
export const toast = {
  success: (msg: string) => useToastStore.getState().show(msg, 'success'),
  error: (msg: string) => useToastStore.getState().show(msg, 'error'),
  info: (msg: string) => useToastStore.getState().show(msg, 'info'),
};
