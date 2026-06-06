type AuthExpiredListener = () => void;

const listeners = new Set<AuthExpiredListener>();

export function subscribeToAuthExpired(listener: AuthExpiredListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyAuthExpired(): void {
  listeners.forEach((listener) => listener());
}
