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
        <SectionHeader title="Business verification" subtitle="Verifies your business workspace" />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.bodySemiBold }}>Business KYC</Text>
          <Badge label={status} variant={badgeVariant(status)} />
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
              label="Re-submit KYC"
              variant="soft"
              onPress={() => router.push('/onboarding/kyc')}
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
            label="Start KYC verification"
            onPress={() => router.push('/onboarding/kyc')}
          />
        ) : null}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <SectionHeader title="Personal verification" subtitle="Verifies your personal identity" />
        {userKycLoading ? <CardSkeleton /> : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontFamily: fonts.bodySemiBold }}>User KYC</Text>
          <Badge
            label={userStatus}
            variant={userStatus === 'verified' ? 'verified' : 'pending'}
          />
        </View>

        {(userStatus === 'unverified') ? (
          <Button
            label="Submit personal KYC"
            onPress={() => router.push('/onboarding/kyc')}
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
              label="Re-submit personal KYC"
              variant="soft"
              onPress={() => router.push('/onboarding/kyc')}
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
