import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';
import { useGenerateInvoice } from '@/api/hooks/featureHooks';

interface LineItem { desc: string; qty: string; price: string }

function FieldLabel({ label }: { label: string }) {
  const { colors, fonts } = useTheme();
  return (
    <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
      {label}
    </Text>
  );
}

export default function NewInvoiceScreen() {
  const { colors, fonts } = useTheme();
  const generateInvoice = useGenerateInvoice();

  const [customerName, setCustomerName] = useState('');
  const [customerTin, setCustomerTin] = useState('');
  const [invoiceType, setInvoiceType] = useState<'invoice' | 'proforma'>('invoice');
  const [lines, setLines] = useState<LineItem[]>([{ desc: '', qty: '1', price: '' }]);

  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const canSubmit = lines.some((l) => l.desc.trim() && Number(l.price) > 0) && !generateInvoice.isPending;

  function updateLine(idx: number, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit() {
    const validLines = lines.filter((l) => l.desc.trim() && Number(l.price) > 0);
    if (validLines.length === 0) {
      Alert.alert('No line items', 'Add at least one item with a description and price.');
      return;
    }
    generateInvoice.mutate(
      {
        customer_name: customerName.trim() || undefined,
        customer_tin: customerTin.trim() || undefined,
        invoice_type: invoiceType,
        line_items: validLines
          .map((l) => ({
            description: l.desc.trim(),
            qty: String(Number(l.qty) || 1),
            unit_price: String(Number(l.price)),
          })),
      },
      {
        onSuccess: (data) => {
          Alert.alert('Invoice created', `${data.invoice_number ?? 'Invoice'} generated successfully.`);
          router.back();
        },
        onError: (e: Error) => Alert.alert('Error', e.message),
      }
    );
  }

  const inputStyle = {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: colors.ink, backgroundColor: colors.bg,
    fontFamily: fonts.body,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {/* Header */}
        <View style={{
          paddingHorizontal: 16, paddingVertical: 12,
          flexDirection: 'row', alignItems: 'center', gap: 10,
          borderBottomWidth: 1, borderBottomColor: colors.border,
          backgroundColor: colors.surface,
        }}>
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
            <MaterialCommunityIcons name="arrow-left" size={20} color={colors.ink} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 18, color: colors.ink }}>New Invoice</Text>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Invoice type toggle */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
            {(['invoice', 'proforma'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setInvoiceType(t)}
                style={{
                  flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center',
                  backgroundColor: invoiceType === t ? colors.ink : colors.surface,
                  borderWidth: 1, borderColor: invoiceType === t ? colors.ink : colors.border,
                }}
              >
                <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: invoiceType === t ? '#fdf7eb' : colors.muted }}>
                  {t === 'invoice' ? 'Tax Invoice' : 'Proforma'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Customer fields */}
          <View style={{ marginBottom: 10 }}>
            <FieldLabel label="Customer name (optional)" />
            <TextInput value={customerName} onChangeText={setCustomerName} placeholder="Walk-in customer" placeholderTextColor={colors.muted} style={inputStyle} />
          </View>
          <View style={{ marginBottom: 16 }}>
            <FieldLabel label="Customer TIN (optional)" />
            <TextInput value={customerTin} onChangeText={setCustomerTin} placeholder="C0012345678" placeholderTextColor={colors.muted} style={inputStyle} />
          </View>

          {/* Line items */}
          <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>
            Line items
          </Text>
          {lines.map((line, idx) => (
            <View key={idx} style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <TextInput
                    value={line.desc}
                    onChangeText={(v) => updateLine(idx, { desc: v })}
                    placeholder="Description"
                    placeholderTextColor={colors.muted}
                    style={inputStyle}
                  />
                </View>
                <View style={{ width: 52 }}>
                  <TextInput
                    value={line.qty}
                    onChangeText={(v) => updateLine(idx, { qty: v })}
                    keyboardType="numeric"
                    placeholder="Qty"
                    placeholderTextColor={colors.muted}
                    style={{ ...inputStyle, textAlign: 'center' }}
                  />
                </View>
                <View style={{ width: 84 }}>
                  <TextInput
                    value={line.price}
                    onChangeText={(v) => updateLine(idx, { price: v })}
                    keyboardType="numeric"
                    placeholder="Price"
                    placeholderTextColor={colors.muted}
                    style={{ ...inputStyle, textAlign: 'right' }}
                  />
                </View>
                {lines.length > 1 && (
                  <TouchableOpacity onPress={() => removeLine(idx)} style={{ padding: 10 }}>
                    <MaterialCommunityIcons name="close" size={16} color={colors.muted} />
                  </TouchableOpacity>
                )}
              </View>
              {line.desc && Number(line.price) > 0 && (
                <Text style={{ fontSize: 11, color: colors.muted, textAlign: 'right', marginTop: 2, fontFamily: fonts.mono }}>
                  = GH₵ {((Number(line.qty) || 1) * Number(line.price)).toFixed(2)}
                </Text>
              )}
            </View>
          ))}

          <TouchableOpacity
            onPress={() => setLines((prev) => [...prev, { desc: '', qty: '1', price: '' }])}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingVertical: 10, marginBottom: 16,
            }}
          >
            <MaterialCommunityIcons name="plus" size={16} color={colors.brand} />
            <Text style={{ fontSize: 13, color: colors.brand, fontFamily: fonts.bodySemiBold }}>Add line</Text>
          </TouchableOpacity>

          {/* Subtotal + tax note */}
          <View style={{ padding: 12, borderRadius: 12, backgroundColor: `${colors.ink}06`, marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Subtotal</Text>
              <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.ink }}>GH₵ {subtotal.toFixed(2)}</Text>
            </View>
            <Text style={{ fontSize: 11, color: colors.muted }}>VAT (12.5%), NHIL & GETFund calculated automatically by GRA rules.</Text>
          </View>

          {/* Submit */}
          <TouchableOpacity
            disabled={!canSubmit}
            onPress={handleSubmit}
            style={{
              height: 48, borderRadius: 13, backgroundColor: colors.inverse,
              alignItems: 'center', justifyContent: 'center',
              opacity: canSubmit ? 1 : 0.4,
            }}
          >
            <Text style={{ fontSize: 15, fontFamily: fonts.bodySemiBold, color: '#fdf7eb' }}>
              {generateInvoice.isPending ? 'Generating…' : 'Generate Invoice'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
