'use client';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export interface StaffPerformanceRow {
  user_id: string;
  name: string | null;
  phone: string | null;
  sale_count: number;
  revenue: string;
}

export function useStaffPerformance(fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ['store', 'analytics', 'staff-performance', fromDate, toDate],
    queryFn: async () =>
      (
        await apiClient.get<StaffPerformanceRow[]>('/analytics/staff-performance', {
          params: { from_date: fromDate, to_date: toDate },
        })
      ).data,
  });
}
