'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCanManage } from '@/hooks/store/useRole';

/** Landing route — send managers to the dashboard, staff to inventory. */
export default function StoreIndexPage() {
  const router = useRouter();
  const canManage = useCanManage();
  useEffect(() => {
    router.replace(canManage ? '/store/dashboard' : '/store/inventory');
  }, [canManage, router]);
  return null;
}
