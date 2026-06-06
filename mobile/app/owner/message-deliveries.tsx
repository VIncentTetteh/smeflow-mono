import { ActivityIndicator, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { useCustomerDeliveries, useRetryCustomerDelivery } from '@/api/hooks/featureHooks';
import { useTheme } from '@/lib/theme';

export default function MessageDeliveriesScreen() {
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const deliveries = useCustomerDeliveries();
  const retry = useRetryCustomerDelivery();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
        <TouchableOpacity onPress={() => router.back()}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.ink} /></TouchableOpacity>
        <View style={{ marginLeft: 12 }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Customer messages</Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Delivery history retained for 12 months</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        {deliveries.isLoading && <ActivityIndicator color={colors.brand} />}
        {(deliveries.data?.items ?? []).map((message) => {
          const last = message.attempts[message.attempts.length - 1];
          return (
            <View key={message.id} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 13, gap: 5 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, color: colors.ink, fontFamily: fonts.bodySemiBold }}>{message.message_type.replace(/_/g, ' ')}</Text>
                <Text style={{ color: message.status === 'failed' ? colors.danger : colors.brand, fontFamily: fonts.bodySemiBold }}>{message.status}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{message.recipient_masked} · {message.attempts.length} attempt{message.attempts.length === 1 ? '' : 's'}</Text>
              {last?.failure_detail && <Text style={{ color: colors.danger, fontSize: 11.5 }}>{last.failure_detail}</Text>}
              {message.status === 'failed' && (
                <TouchableOpacity disabled={retry.isPending} onPress={() => retry.mutate(message.id)} style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: `${colors.brand}12` }}>
                  <Text style={{ color: colors.brand, fontFamily: fonts.bodySemiBold }}>Retry</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
