'use client';
import { useStoreAuth } from '@/stores/authStore';

export type StoreRole = 'owner' | 'manager' | 'staff' | 'none';

/** Current member role in the active business (from the JWT, persisted at login/switch). */
export function useRole(): StoreRole {
  return (useStoreAuth((s) => s.role) as StoreRole) ?? 'none';
}

/** Managers and owners can manage the business (team, settings, writes). */
export function useCanManage(): boolean {
  const role = useRole();
  return role === 'owner' || role === 'manager';
}

/** A handful of actions (billing changes, business deletion) are owner-only. */
export function useIsOwner(): boolean {
  return useRole() === 'owner';
}
