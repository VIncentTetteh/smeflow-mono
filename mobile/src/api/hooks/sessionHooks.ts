import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMe,
  getUserKycStatus,
  listBusinesses,
  logout,
  submitUserKyc,
  switchBusiness,
} from '@/api/auth.api';
import {
  addMomoAccount,
  deactivateMember,
  deleteMomoAccount,
  getBusiness,
  getBusinessKyc,
  inviteMember,
  listMembers,
  listMomoAccounts,
  provisionDedicatedAccount,
  setPrimaryMomoAccount,
  submitBusinessKyc,
  updateBusiness,
  updateMember,
  updateMomoAccount,
  verifyMomoAccount,
} from '@/api/business.api';
import { resetScopedLocalData } from '@/db/scopedData';
import {
  type BusinessKyc,
  type BusinessMember,
  type BusinessMembership,
  type BusinessProfile,
  type MoMoAccount,
  type UserKycStatus,
  useAuthStore,
} from '@/store/auth';
import { MOBILE_ANALYTICS_EVENTS, trackEvent } from '@/lib/analytics';
import type { BusinessType, MemberRole, MomoProvider } from '@/types/business';

interface UserProfile {
  id: string;
  phone: string;
  name: string | null;
  email?: string | null;
  google_linked?: boolean;
  kyc_status?: string;
}

interface BootstrapResult {
  user: UserProfile;
  userKycStatus: UserKycStatus;
  business: BusinessProfile | null;
  businessKyc: BusinessKyc | null;
  momoAccounts: MoMoAccount[];
  members: BusinessMember[];
  businesses: BusinessMembership[];
}

export async function fetchSessionBootstrap(): Promise<BootstrapResult> {
  const businessId = useAuthStore.getState().businessId;
  const [user, userKycStatus] = await Promise.all([
    getMe(),
    getUserKycStatus(),
  ]);

  if (!businessId) {
    return {
      user,
      userKycStatus,
      business: null,
      businessKyc: null,
      momoAccounts: [],
      members: [],
      businesses: [],
    };
  }

  const [business, businessKyc, momoAccounts, members, businesses] = await Promise.all([
    getBusiness(),
    getBusinessKyc(),
    listMomoAccounts(),
    listMembers(),
    listBusinesses(),
  ]);

  return {
    user,
    userKycStatus,
    business: business as BusinessProfile,
    businessKyc: businessKyc as BusinessKyc | null,
    momoAccounts: momoAccounts as MoMoAccount[],
    members: members as BusinessMember[],
    businesses: businesses as BusinessMembership[],
  };
}

export function applySessionBootstrap(data: BootstrapResult) {
  useAuthStore.getState().setSessionContext({
    user: {
      id: data.user.id,
      phone: data.user.phone,
      name: data.user.name ?? '',
      email: data.user.email,
      googleLinked: data.user.google_linked,
      kycStatus: data.user.kyc_status,
    },
    business: data.business,
    businessKyc: data.businessKyc,
    userKycStatus: data.userKycStatus,
    momoAccounts: data.momoAccounts,
    members: data.members,
    businesses: data.businesses,
  });
}

export function useSessionBootstrap() {
  const businessId = useAuthStore((state) => state.businessId);
  const setBootstrapStatus = useAuthStore((state) => state.setBootstrapStatus);

  return useQuery({
    queryKey: ['session-bootstrap', businessId],
    queryFn: async () => {
      setBootstrapStatus('loading');
      const data = await fetchSessionBootstrap();
      applySessionBootstrap(data);
      return data;
    },
    retry: 1,
  });
}

export function useUpdateBusinessProfile() {
  const queryClient = useQueryClient();
  const setSessionContext = useAuthStore((state) => state.setSessionContext);
  return useMutation({
    mutationFn: (body: Partial<Omit<Pick<BusinessProfile, 'name' | 'type' | 'tin' | 'address' | 'ghana_card_ref'>, 'type'>> & { type?: BusinessType }) =>
      updateBusiness({
        name: body.name,
        type: body.type,
        tin: body.tin ?? undefined,
        address: body.address ?? undefined,
        ghana_card_ref: body.ghana_card_ref ?? undefined,
      }),
    onSuccess: (business) => {
      setSessionContext({ business: business as BusinessProfile });
      queryClient.invalidateQueries({ queryKey: ['session-bootstrap'] });
    },
  });
}

export function useProvisionDedicatedAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: provisionDedicatedAccount,
    onSuccess: async (result) => {
      if (result.provisioned) {
        try {
          const business = await getBusiness();
          useAuthStore.getState().setSessionContext({ business: business as BusinessProfile });
        } catch {
          // Session bootstrap will refresh the business profile on the next foreground/load.
        }
      }
      queryClient.invalidateQueries({ queryKey: ['session-bootstrap'] });
      queryClient.invalidateQueries({ queryKey: ['payments-workspace'] });
    },
  });
}

export function useInviteBusinessMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { phone: string; role: Extract<MemberRole, 'manager' | 'staff'> }) =>
      inviteMember(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session-bootstrap'] }),
  });
}

export function useUpdateBusinessMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { memberId: string; role?: Extract<MemberRole, 'manager' | 'staff'>; is_active?: boolean }) =>
      updateMember(body.memberId, {
        role: body.role,
        is_active: body.is_active,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session-bootstrap'] }),
  });
}

export function useDeactivateBusinessMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deactivateMember,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session-bootstrap'] }),
  });
}

export function useAddMomoAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { provider: MomoProvider; phone: string; account_name?: string; is_primary?: boolean }) =>
      addMomoAccount(body),
    onSuccess: async (account) => {
      let wallet = account as MoMoAccount;
      if (account.status !== 'verified') {
        try {
          wallet = await verifyMomoAccount(account.id, {
            status: 'verified',
            verification_ref: 'mobile-self-verified',
          }) as MoMoAccount;
        } catch {
          wallet = account as MoMoAccount;
        }
      }
      const current = useAuthStore.getState().momoAccounts;
      const next = current
        .filter((item) => item.id !== wallet.id)
        .map((item) => wallet.is_primary ? { ...item, is_primary: false } : item);
      useAuthStore.getState().setSessionContext({
        momoAccounts: [...next, wallet],
      });
      await queryClient.invalidateQueries({ queryKey: ['session-bootstrap'] });
      try {
        const fresh = await fetchSessionBootstrap();
        applySessionBootstrap(fresh);
        queryClient.setQueryData(['session-bootstrap', useAuthStore.getState().businessId], fresh);
      } catch {
        // Keep the just-linked wallet visible; the next bootstrap/foreground refresh will reconcile.
      }
    },
  });
}

export function useVerifyMomoAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      verifyMomoAccount(accountId, {
        status: 'verified',
        verification_ref: 'mobile-self-verified',
      }),
    onSuccess: (account) => {
      const current = useAuthStore.getState().momoAccounts;
      const next = current
        .filter((item) => item.id !== account.id)
        .map((item) => account.is_primary ? { ...item, is_primary: false } : item);
      useAuthStore.getState().setSessionContext({
        momoAccounts: [...next, account as MoMoAccount],
      });
      queryClient.invalidateQueries({ queryKey: ['session-bootstrap'] });
    },
  });
}

export function useUpdateMomoAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { accountId: string; phone?: string; account_name?: string; is_primary?: boolean }) =>
      updateMomoAccount(body.accountId, {
        phone: body.phone,
        account_name: body.account_name,
        is_primary: body.is_primary,
      }),
    onSuccess: (account) => {
      const wallet = account as MoMoAccount;
      const current = useAuthStore.getState().momoAccounts;
      const next = current
        .filter((item) => item.id !== wallet.id)
        .map((item) => wallet.is_primary ? { ...item, is_primary: false } : item);
      useAuthStore.getState().setSessionContext({ momoAccounts: [...next, wallet] });
      queryClient.invalidateQueries({ queryKey: ['session-bootstrap'] });
    },
  });
}

export function useDeleteMomoAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMomoAccount,
    onSuccess: (_data, accountId) => {
      useAuthStore.getState().setSessionContext({
        momoAccounts: useAuthStore.getState().momoAccounts.filter((item) => item.id !== accountId),
      });
      queryClient.invalidateQueries({ queryKey: ['session-bootstrap'] });
    },
  });
}

export function useSetPrimaryMomoAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setPrimaryMomoAccount,
    onSuccess: (account) => {
      const wallet = account as MoMoAccount;
      const current = useAuthStore.getState().momoAccounts;
      const next = current
        .filter((item) => item.id !== wallet.id)
        .map((item) => ({ ...item, is_primary: false }));
      useAuthStore.getState().setSessionContext({ momoAccounts: [...next, wallet] });
      queryClient.invalidateQueries({ queryKey: ['session-bootstrap'] });
    },
  });
}

export function useSubmitUserKyc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: submitUserKyc,
    onSuccess: (userKycStatus) => {
      trackEvent(MOBILE_ANALYTICS_EVENTS.KYC_SUBMITTED, {
        scope: 'user',
        status: userKycStatus.kyc_status,
      });
      useAuthStore.getState().setSessionContext({ userKycStatus });
      queryClient.invalidateQueries({ queryKey: ['session-bootstrap'] });
    },
  });
}

export function useSubmitBusinessKyc() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { business_registration_ref: string; tin?: string; documents?: object }) =>
      submitBusinessKyc(body),
    onSuccess: (businessKyc) => {
      trackEvent(MOBILE_ANALYTICS_EVENTS.KYC_SUBMITTED, {
        scope: 'business',
        status: String((businessKyc as BusinessKyc).status ?? 'submitted'),
      });
      useAuthStore.getState().setSessionContext({ businessKyc: businessKyc as BusinessKyc });
      queryClient.invalidateQueries({ queryKey: ['session-bootstrap'] });
    },
  });
}

export function useSwitchBusiness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (business_id: string) => switchBusiness({ business_id }),
    onSuccess: (data) => {
      void resetScopedLocalData();
      useAuthStore.getState().setRefreshedSession({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        businessId: data.business_id,
        role: data.role,
      });
      queryClient.clear();
    },
  });
}

export function useLogoutSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const refreshToken = useAuthStore.getState().refreshToken;
      if (refreshToken) {
        await logout({ refresh_token: refreshToken });
      }
    },
    onSettled: () => {
      queryClient.clear();
      void resetScopedLocalData();
      useAuthStore.getState().clearAuth();
    },
  });
}
