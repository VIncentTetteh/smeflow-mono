import { Switch, TextInput, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';

export function creditDateAfter(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function CreditTermsForm({
  customerName, customerPhone, dueDate, reminderConsent, onCustomerName, onCustomerPhone, onDueDate,
  onReminderConsent, onConfirm, busy,
}: {
  customerName: string; customerPhone: string; dueDate: string;
  reminderConsent: boolean;
  onCustomerName: (value: string) => void; onCustomerPhone: (value: string) => void;
  onDueDate: (value: string) => void; onReminderConsent: (value: boolean) => void;
  onConfirm: () => void; busy?: boolean;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 18, color: colors.ink }}>Credit terms</Text>
      <Text style={{ color: colors.muted, fontSize: 12 }}>Customer details and an agreed repayment date are required.</Text>
      <TextInput value={customerName} onChangeText={onCustomerName} placeholder="Customer name" placeholderTextColor={colors.muted} style={{ height: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, color: colors.ink }} />
      <TextInput value={customerPhone} onChangeText={onCustomerPhone} placeholder="Ghana phone number" keyboardType="phone-pad" placeholderTextColor={colors.muted} style={{ height: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, color: colors.ink }} />
      <Text style={{ color: colors.muted, fontFamily: fonts.bodySemiBold }}>When will the customer pay?</Text>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {[7, 14, 30].map((days) => {
          const value = creditDateAfter(days);
          const selected = dueDate === value;
          return <TouchableOpacity key={days} onPress={() => onDueDate(value)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: selected ? colors.brand : colors.border, backgroundColor: selected ? `${colors.brand}15` : colors.surface }}><Text style={{ color: selected ? colors.brand : colors.muted }}>{days} days</Text></TouchableOpacity>;
        })}
      </View>
      <TextInput value={dueDate} onChangeText={onDueDate} placeholder="Custom date YYYY-MM-DD" placeholderTextColor={colors.muted} style={{ height: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, color: colors.ink }} />
      <Text style={{ color: colors.ink }}>Due {new Date(`${dueDate}T00:00:00`).toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontFamily: fonts.bodySemiBold }}>Customer agrees to automated reminders</Text>
          <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }}>WhatsApp first, then SMS fallback. The customer can opt out.</Text>
        </View>
        <Switch value={reminderConsent} onValueChange={onReminderConsent} trackColor={{ false: colors.border, true: colors.brand }} />
      </View>
      <TouchableOpacity disabled={busy} onPress={onConfirm} style={{ height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand, opacity: busy ? 0.6 : 1 }}>
        <Text style={{ color: '#fff', fontFamily: fonts.bodySemiBold }}>{busy ? 'Recording…' : 'Record credit sale'}</Text>
      </TouchableOpacity>
    </View>
  );
}
