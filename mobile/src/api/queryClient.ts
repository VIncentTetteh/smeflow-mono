import { AppState } from 'react-native';
import { focusManager, QueryClient } from '@tanstack/react-query';

// React Native doesn't have browser focus events — use AppState instead
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (state) => {
    handleFocus(state === 'active');
  });
  return () => subscription.remove();
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30 seconds — balance between freshness and API calls
      retry: (failureCount, error: unknown) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status === 401) return false;
        return failureCount < 2;
      },
    },
  },
});
