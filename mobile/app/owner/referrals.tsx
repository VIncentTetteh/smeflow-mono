import { Alert, Clipboard, Linking, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';
import { useReferralCode, useReferralStatus, useSendReferral } from '@/api/hooks/featureHooks';

export default function ReferralsScreen() {
  const { colors, fonts } = useTheme();
  const [phone, setPhone] = useState('');
  const { data: codeData } = useReferralCode();
  const { data: status } = useReferralStatus();
  const sendReferral = useSendReferral();

  const code = codeData?.referral_code ?? '—';
  const shareLink = codeData?.link ?? (codeData?.referral_code ? `https://smeflow.app/join?ref=${codeData.referral_code}` : '');

  const STATS = [
    { label: 'Invited', value: String(status?.total_invited ?? 0),                     accent: false },
    { label: 'Joined',  value: String(status?.converted ?? 0),                          accent: false },
    { label: 'Earned',  value: status?.reward_granted ? 'GH₵ 50' : 'Pending',          accent: true },
  ];

  function handleCopy() {
    Clipboard.setString(code);
    Alert.alert('Copied', 'Referral code copied to clipboard');
  }

  function handleWhatsApp() {
    const msg = encodeURIComponent(`Use my code ${code} to sign up on SMEflow and get GH₵ 50 off! ${shareLink}`);
    Linking.openURL(`whatsapp://send?text=${msg}`).catch(() =>
      Alert.alert('WhatsApp not installed', 'Please share manually using your referral code.')
    );
  }

  function handleSendSms() {
    if (!phone.trim()) {
      Alert.alert('Enter a phone number');
      return;
    }
    sendReferral.mutate({ referee_phone: phone.trim() }, {
      onSuccess: () => {
        Alert.alert('Invite sent!', `Referral invite sent to ${phone}`);
        setPhone('');
      },
      onError: () => Alert.alert('Error', 'Could not send invite. Try again.'),
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}>
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Refer a trader</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Gold gradient hero */}
        <View style={{
          borderRadius: 18, padding: 18, marginBottom: 14,
          backgroundColor: '#b6831e', overflow: 'hidden',
        }}>
          <View style={{
            position: 'absolute', bottom: -40, right: -40,
            width: 160, height: 160, borderRadius: 80,
            backgroundColor: 'rgba(253,247,235,0.12)',
          }} />
          <View style={{
            position: 'absolute', top: -20, left: -20,
            width: 80, height: 80, borderRadius: 40,
            backgroundColor: 'rgba(253,247,235,0.08)',
          }} />
          <View style={{ position: 'relative' }}>
            <Text style={{
              fontSize: 11, fontFamily: fonts.bodySemiBold, letterSpacing: 0.8,
              textTransform: 'uppercase', color: 'rgba(253,247,235,0.7)',
            }}>
              Earn together
            </Text>
            <Text style={{
              fontFamily: fonts.displaySemiBold, fontSize: 26, letterSpacing: -0.5,
              color: '#fdf7eb', marginTop: 4, lineHeight: 30,
            }}>
              GH₵ 50 for you,{'\n'}GH₵ 50 for them.
            </Text>
            <Text style={{ fontSize: 12, color: 'rgba(253,247,235,0.8)', marginTop: 8 }}>
              When your friend processes their first GH₵ 500 in sales.
            </Text>
          </View>
        </View>

        {/* Referral code */}
        <Text style={{
          fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold,
          textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
        }}>
          Your code
        </Text>
        <View style={{
          backgroundColor: colors.surface,
          borderWidth: 1.5, borderColor: colors.muted, borderStyle: 'dashed',
          borderRadius: 14, padding: 14, marginBottom: 10,
          flexDirection: 'row', alignItems: 'center', gap: 10,
        }}>
          <Text style={{
            flex: 1, fontFamily: fonts.mono, fontSize: 22,
            letterSpacing: 2, color: colors.ink,
          }}>
            {code}
          </Text>
          <TouchableOpacity
            onPress={handleCopy}
            style={{
              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9,
              backgroundColor: colors.inverse,
            }}
          >
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#fdf7eb' }}>Copy</Text>
          </TouchableOpacity>
        </View>

        {/* Share buttons */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          <TouchableOpacity
            onPress={handleWhatsApp}
            style={{
              flex: 1, height: 44, borderRadius: 12,
              backgroundColor: colors.brand,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}
          >
            <MaterialCommunityIcons name="whatsapp" size={16} color="#fff" />
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#fff' }}>Share via WhatsApp</Text>
          </TouchableOpacity>
        </View>

        {/* Invite by phone */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="0244 000 000"
            placeholderTextColor={colors.muted}
            keyboardType="phone-pad"
            style={{
              flex: 1, height: 44, borderRadius: 12,
              borderWidth: 1.5, borderColor: colors.border,
              paddingHorizontal: 12, fontFamily: fonts.mono,
              fontSize: 14, color: colors.ink,
              backgroundColor: colors.surface,
            }}
          />
          <TouchableOpacity
            onPress={handleSendSms}
            disabled={sendReferral.isPending}
            style={{
              height: 44, paddingHorizontal: 14, borderRadius: 12,
              backgroundColor: colors.inverse, justifyContent: 'center',
              opacity: sendReferral.isPending ? 0.6 : 1,
            }}
          >
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#fdf7eb' }}>
              {sendReferral.isPending ? '…' : 'Invite'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Stats grid */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          {STATS.map((s) => (
            <View key={s.label} style={{
              flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
              borderRadius: 12, padding: 11,
            }}>
              <Text style={{
                fontSize: 10, color: colors.muted, fontFamily: fonts.bodySemiBold,
                textTransform: 'uppercase', letterSpacing: 0.8,
              }}>
                {s.label}
              </Text>
              <Text style={{
                fontFamily: fonts.displaySemiBold, fontSize: 17, marginTop: 2,
                color: s.accent ? colors.brand : colors.ink,
              }}>
                {s.value}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
