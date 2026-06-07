import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { apiClient } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen, SectionHeader } from '@/components/ui/Screen';
import { Text, Heading } from '@/components/ui/Text';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';
import type { BusinessKYCResponseDto } from '@/types/kyc';
import type { UserKYCStatusDto } from '@/types/auth';

async function fetchUserKycStatus(): Promise<UserKYCStatusDto> {
  const res = await apiClient.get<UserKYCStatusDto>('/api/v1/auth/kyc/status');
  return res.data;
}

async function fetchKycStatus(): Promise<BusinessKYCResponseDto | null> {
  try {
    const res = await apiClient.get<BusinessKYCResponseDto>('/api/v1/kyc/me');
    return res.data;
  } catch (error) {
    // Treat 404 (no KYC submitted) as null
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      return null;
    }
    throw error;
  }
}

type KycStatus = 'pending' | 'verified' | 'failed' | 'not_submitted';

function badgeVariant(status: KycStatus): 'verified' | 'offline' | 'pending' {
  if (status === 'verified') return 'verified';
  if (status === 'failed') return 'offline';
  return 'pending';
}

const BUSINESS_STATUS_LABEL: Record<KycStatus, string> = {
  verified: 'Verified',
  pending: 'Pending review',
  failed: 'Failed',
  not_submitted: 'Not submitted',
};

const USER_STATUS_LABEL: Record<string, string> = {
  verified: 'Verified',
  pending: 'Pending review',
  failed: 'Failed',
  rejected: 'Rejected',
  unverified: 'Not submitted',
};

export default function KycStatusScreen() {
  const { colors, fonts, spacing } = useTheme();
  const router = useRouter();
  const businessKyc = useAuthStore((state) => state.businessKyc);
  const userKycStatus = useAuthStore((state) => state.userKycStatus);

  const { data, isLoading } = useQuery({
    queryKey: ['kyc-status'],
    queryFn: fetchKycStatus,
    // Poll every 10 seconds while pending
    refetchInterval: (query) => {
      const currentStatus = query.state.data?.status;
      return currentStatus === 'pending' ? 10_000 : false;
    },
  });

  const { data: userKycData, isLoading: userKycLoading } = useQuery({
    queryKey: ['user-kyc-status'],
    queryFn: fetchUserKycStatus,
    refetchInterval: (query) => {
      return query.state.data?.kyc_status === 'pending' ? 10_000 : false;
    },
  });

  const status: KycStatus = (data?.status as KycStatus | undefined)
    ?? (businessKyc?.status as KycStatus | undefined)
    ?? 'not_submitted';

  const userStatus = userKycData?.kyc_status ?? userKycStatus?.kyc_status ?? 'unverified';

  return (
    <Screen>
      <Heading>KYC Status</Heading>

      {isLoading ? <CardSkeleton /> : null}

      <Card style={{ gap: spacing.sm }}>
        <SectionHeader
          title="Business verification"
          subtitle="Requires Business Registration Number · TIN optional"
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.bodySemiBold }}>Business KYC</Text>
          <Badge label={BUSINESS_STATUS_LABEL[status] ?? status} variant={badgeVariant(status)} />
        </View>

        {status === 'pending' ? (
          <Text style={{ color: colors.muted }}>
            Verification in progress — usually takes a few minutes. This page refreshes automatically.
          </Text>
        ) : null}

        {status === 'failed' ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: colors.danger, fontFamily: fonts.bodySemiBold }}>Verification failed</Text>
            <Text style={{ color: colors.muted }}>
              {data?.failure_reason ?? businessKyc?.failure_reason ?? 'Contact support for details.'}
            </Text>
            <Button
              label="Re-submit business KYC"
              variant="soft"
              onPress={() => router.push('/owner/kyc-business')}
            />
          </View>
        ) : null}

        {status === 'verified' ? (
          <Text style={{ color: colors.brand }}>
            Verified{data?.reviewed_at ? ` on ${new Date(data.reviewed_at).toLocaleDateString()}` : ''}
          </Text>
        ) : null}

        {status === 'not_submitted' ? (
          <Button
            label="Start business verification"
            onPress={() => router.push('/owner/kyc-business')}
          />
        ) : null}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionHeader
          title="Personal verification"
          subtitle="Requires Ghana Card number"
        />
        {userKycLoading ? <CardSkeleton /> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.bodySemiBold }}>Personal KYC</Text>
          <Badge
            label={USER_STATUS_LABEL[userStatus] ?? userStatus}
            variant={userStatus === 'verified' ? 'verified' : 'pending'}
          />
        </View>

        {userStatus === 'unverified' ? (
          <Button
            label="Submit Ghana Card"
            onPress={() => router.push('/owner/kyc-personal')}
          />
        ) : null}

        {userStatus === 'pending' ? (
          <Text style={{ color: colors.muted }}>
            Personal verification in progress — usually takes a few minutes.
          </Text>
        ) : null}

        {(userStatus === 'failed' || userStatus === 'rejected') ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: colors.danger, fontFamily: fonts.bodySemiBold }}>Verification failed</Text>
            <Button
              label="Re-submit Ghana Card"
              variant="soft"
              onPress={() => router.push('/owner/kyc-personal')}
            />
          </View>
        ) : null}

        {userStatus === 'verified' ? (
          <Text style={{ color: colors.brand }}>Verified</Text>
        ) : null}
      </Card>
    </Screen>
  );
}
