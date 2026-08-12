import type { QueryClient } from '@tanstack/react-query';
import type { useRouter } from 'next/navigation';

/**
 * Switch the active store session. Re-issues a business-scoped session token
 * and clears the entire React Query cache, since every ['store', ...] query
 * is scoped to the previously-active business — shared between
 * BusinessSwitcher and the "All Stores" overview so both switch identically.
 */
export async function switchStore(
  businessId: string,
  opts: {
    setBusiness: (businessId: string | null, role?: string) => void;
    queryClient: QueryClient;
    router: ReturnType<typeof useRouter>;
    fallbackRole?: string;
  }
): Promise<boolean> {
  const resp = await fetch('/api/auth/store/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_id: businessId }),
  });
  if (!resp.ok) return false;
  const json = await resp.json();
  opts.setBusiness(businessId, json.role ?? opts.fallbackRole);
  opts.queryClient.clear();
  opts.router.refresh();
  return true;
}
