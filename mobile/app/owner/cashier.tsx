import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Share, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';
import { categoryTileColors as TILE_COLORS } from '@/lib/tokens';
import { useLocalItems } from '@/features/localData';
import type { CartLine, LocalItem } from '@/features/localData';
import { createPaystackSaleIntentFromCart, recordSaleOnlineFirst } from '@/features/onlineSales';
import { useSyncStore } from '@/store/sync';
import { useAuthStore } from '@/store/auth';
import { useInvoiceBySale, useSalesHistory } from '@/api/hooks/featureHooks';
import type { SaleResponseDto } from '@/types/sales';
import { buildSaleDraft, type SellMode } from '@/features/sellCart';
import { CreditTermsForm, creditDateAfter } from '@/components/sales/CreditTermsForm';

type Tab = 'sell' | 'queue' | 'shift';

const CASHIER_TAX = { vat: 0.125, nhil: 0.025, getfund: 0.01, covid: 0.01, combined: 0.175 };

type ReceiptData = {
  subtotal: number; vatAmt: number; nhilAmt: number; getfundAmt: number; covidAmt: number;
  grandTotal: number; hasTax: boolean;
  cartSnapshot: CartLine[]; mode: 'online' | 'offline'; ref: string; saleId: string;
  paymentMethod: 'cash' | 'paystack' | 'credit' | 'ghqr';
  creditDueDate?: string; customerName?: string;
};

function CashierSell({ colors, fonts, items, loading }: ReturnType<typeof useTheme> & { items: LocalItem[]; loading: boolean }) {
  const business = useAuthStore((s) => s.business);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [charging, setCharging] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customAmt, setCustomAmt] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<Exclude<SellMode, 'momo' | 'mixed'>>('cash');
  const [showCustomerDetails, setShowCustomerDetails] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [creditDueDate, setCreditDueDate] = useState(creditDateAfter(7));
  const [reminderConsent, setReminderConsent] = useState(false);
  const [showCreditTerms, setShowCreditTerms] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const invoiceQuery = useInvoiceBySale(receipt?.saleId ?? null);
  const inv = invoiceQuery.data;

  const subtotal = cart.reduce((s, l) => s + l.qty * (l.unitPrice ?? l.item.sellPrice), 0);
  const hasTax = !!business?.tin;
  const vatAmt     = hasTax ? subtotal * CASHIER_TAX.vat     : 0;
  const nhilAmt    = hasTax ? subtotal * CASHIER_TAX.nhil    : 0;
  const getfundAmt = hasTax ? subtotal * CASHIER_TAX.getfund : 0;
  const covidAmt   = hasTax ? subtotal * CASHIER_TAX.covid   : 0;
  const grandTotal = hasTax ? subtotal * (1 + CASHIER_TAX.combined) : subtotal;
  const total = grandTotal;
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);

  function addToCart(item: LocalItem) {
    setCart((prev) => {
      const existing = prev.find((l) => l.item.id === item.id);
      if (existing) return prev.map((l) => l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l);
      return [...prev, { item, qty: 1 }];
    });
  }

  function updateQty(itemId: string, delta: number) {
    setCart((prev) =>
      prev.map((l) => l.item.id === itemId ? { ...l, qty: l.qty + delta } : l).filter((l) => l.qty > 0)
    );
  }

  async function handleCharge() {
    if (cart.length === 0) {
      Alert.alert('Empty cart', 'Add at least one item before charging.');
      return;
    }
    setCharging(true);
    try {
      const draft = buildSaleDraft({ mode: paymentMethod, customerName, customerPhone, creditDueDate: paymentMethod === 'credit' ? creditDueDate : undefined, reminderConsent: paymentMethod === 'credit' ? reminderConsent : false, reminderChannel: 'whatsapp' });
      if (paymentMethod === 'paystack') {
        const intent = await createPaystackSaleIntentFromCart(cart, draft);
        if (intent.paymentUrl) await Share.share({ message: intent.paymentUrl });
        Alert.alert('Paystack payment created', 'The cart is kept until payment is confirmed. Complete it from the shared Paystack link.');
        return;
      }
      const cartSnapshot = [...cart];
      const snap_subtotal = cartSnapshot.reduce((s, l) => s + l.qty * (l.unitPrice ?? l.item.sellPrice), 0);
      const snap_hasTax = !!business?.tin;
      const result = await recordSaleOnlineFirst(cart, draft);
      setCart([]);
      setReceipt({
        subtotal: snap_subtotal,
        hasTax: snap_hasTax,
        vatAmt:     snap_hasTax ? snap_subtotal * CASHIER_TAX.vat     : 0,
        nhilAmt:    snap_hasTax ? snap_subtotal * CASHIER_TAX.nhil    : 0,
        getfundAmt: snap_hasTax ? snap_subtotal * CASHIER_TAX.getfund : 0,
        covidAmt:   snap_hasTax ? snap_subtotal * CASHIER_TAX.covid   : 0,
        grandTotal: snap_hasTax ? snap_subtotal * (1 + CASHIER_TAX.combined) : snap_subtotal,
        cartSnapshot,
        mode: result.mode,
        ref: result.saleId.slice(0, 8).toUpperCase(),
        saleId: result.saleId,
        paymentMethod,
        creditDueDate: paymentMethod === 'credit' ? creditDueDate : undefined,
        customerName: paymentMethod === 'credit' ? customerName : undefined,
      });
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: Array<{ msg: string }> } } })?.response?.data?.detail;
      const message = Array.isArray(detail) && detail.length
        ? detail.map((d) => d.msg).join('; ')
        : (err as Error).message ?? 'Could not record sale';
      Alert.alert('Error', message);
    } finally {
      setCharging(false);
    }
  }

  const tiles = items.slice(0, 11);

  if (receipt) {
    const methodLabel = receipt.paymentMethod === 'ghqr' ? 'GhQR' : receipt.paymentMethod === 'credit' ? 'Credit' : receipt.paymentMethod === 'paystack' ? 'Paystack' : 'Cash';
    const displayVat     = inv ? Number(inv.vat_amount)     : receipt.vatAmt;
    const displayNhil    = inv ? Number(inv.nhil_amount)    : receipt.nhilAmt;
    const displayGetfund = inv ? Number(inv.getfund_amount) : receipt.getfundAmt;
    const displayCovid   = inv ? Number(inv.covid_levy)     : receipt.covidAmt;
    const displayTotal   = inv ? Number(inv.total)          : receipt.grandTotal;
    const displaySub     = inv ? Number(inv.subtotal)       : receipt.subtotal;

    async function handleShareReceipt() {
      const itemLines = (inv?.line_items?.length
        ? inv.line_items.map((l) => `${l.description}  GH₵ ${Number(l.line_total).toFixed(2)}`)
        : receipt!.cartSnapshot.map((l) => `${l.item.name} x${l.qty}  GH₵ ${(l.qty * (l.unitPrice ?? l.item.sellPrice)).toFixed(2)}`)
      );
      const taxLines = receipt!.hasTax ? [
        `VAT 12.5%     GH₵ ${displayVat.toFixed(2)}`,
        `NHIL 2.5%     GH₵ ${displayNhil.toFixed(2)}`,
        `GETFund 1%    GH₵ ${displayGetfund.toFixed(2)}`,
        `COVID Levy 1% GH₵ ${displayCovid.toFixed(2)}`,
      ] : [];
      const message = [
        `Receipt — ${business?.name ?? 'Your Business'}`,
        business?.tin ? `TIN: ${business.tin}` : null,
        inv?.invoice_number ? `Invoice: ${inv.invoice_number}` : `Ref: ${receipt!.ref}`,
        `Date: ${new Date().toLocaleString('en-GH')}`,
        '',
        ...itemLines,
        '',
        `Subtotal      GH₵ ${displaySub.toFixed(2)}`,
        ...taxLines,
        `Total         GH₵ ${displayTotal.toFixed(2)}`,
        `Paid via ${methodLabel}`,
      ].filter((l) => l !== null).join('\n');
      try { await Share.share({ message }); } catch { /* user cancelled */ }
    }

    const invoiceReady = !!inv?.invoice_number;

    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ paddingTop: 32, paddingBottom: 8, alignItems: 'center' }}>
          <View style={{
            width: 64, height: 64, borderRadius: 32,
            backgroundColor: colors.brand,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <MaterialCommunityIcons name="check" size={32} color="#fff" />
          </View>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink, marginTop: 10 }}>
            {receipt.mode === 'offline' ? 'Sale queued' : 'Sale recorded'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.muted }}>
              {inv?.invoice_number ?? receipt.ref} · {receipt.cartSnapshot.reduce((s, l) => s + l.qty, 0)} items · via {methodLabel}
            </Text>
            {receipt.mode === 'online' && !invoiceReady && (
              <ActivityIndicator size="small" color={colors.muted} style={{ transform: [{ scale: 0.7 }] }} />
            )}
          </View>
          {receipt.paymentMethod === 'credit' && <Text style={{ color: colors.muted }}>Due {new Date(`${receipt.creditDueDate}T00:00:00`).toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' })} · {receipt.customerName}</Text>}
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
            <View style={{ padding: 12, gap: 5 }}>
              {receipt.cartSnapshot.map((line) => (
                <View key={line.item.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12.5, color: colors.muted, flex: 1 }} numberOfLines={1}>
                    {line.item.name} × {line.qty}
                  </Text>
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.mono, color: colors.ink }}>
                    GH₵ {(line.qty * (line.unitPrice ?? line.item.sellPrice)).toFixed(2)}
                  </Text>
                </View>
              ))}
              <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>Subtotal</Text>
                <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.muted }}>GH₵ {displaySub.toFixed(2)}</Text>
              </View>
              {receipt.hasTax && (
                <>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>VAT (12.5%)</Text>
                    <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.muted }}>GH₵ {displayVat.toFixed(2)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>NHIL (2.5%)</Text>
                    <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.muted }}>GH₵ {displayNhil.toFixed(2)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>GETFund (1%)</Text>
                    <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.muted }}>GH₵ {displayGetfund.toFixed(2)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>COVID Levy (1%)</Text>
                    <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.muted }}>GH₵ {displayCovid.toFixed(2)}</Text>
                  </View>
                </>
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Total</Text>
                <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink }}>GH₵ {displayTotal.toFixed(2)}</Text>
              </View>
            </View>
          </View>

          <View style={{ marginTop: 12, flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() => void handleShareReceipt()}
              style={{
                flex: 1, height: 46, borderRadius: 12,
                backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <MaterialCommunityIcons name="share-outline" size={18} color={colors.muted} />
              <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.muted }}>Share Receipt</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        <View style={{ paddingHorizontal: 16, paddingBottom: 20, paddingTop: 10, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
          <TouchableOpacity onPress={() => setReceipt(null)} style={{
            height: 52, borderRadius: 14,
            backgroundColor: colors.ink,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 16, color: '#fdf7eb' }}>Done · New Sale</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Running total bar */}
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
        flexDirection: 'row', alignItems: 'center', gap: 10,
      }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.8, textTransform: 'uppercase' }}>
            This sale · {itemCount} item{itemCount !== 1 ? 's' : ''}
          </Text>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink, letterSpacing: -0.3 }}>
            GH₵ {total.toFixed(2)}
          </Text>
        </View>
        {cart.length > 0 && (
          <TouchableOpacity
            onPress={() => setCart([])}
            style={{ paddingHorizontal: 10, paddingVertical: 10 }}
          >
            <MaterialCommunityIcons name="close" size={18} color={colors.muted} />
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={handleCharge}
          disabled={charging}
          style={{
            paddingHorizontal: 20, paddingVertical: 11, borderRadius: 12,
            backgroundColor: cart.length > 0 ? colors.ink : `${colors.ink}40`,
          }}
        >
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#fdf7eb' }}>
            {charging ? 'Charging…' : 'Charge'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Payment method strip */}
      <View style={{
        paddingHorizontal: 16, paddingVertical: 8,
        backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
        flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6,
      }}>
        <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.5 }}>Pay via</Text>
        {(['paystack', 'cash', 'ghqr', 'credit'] as const).map((m) => {
          const sel = paymentMethod === m;
          return (
            <TouchableOpacity key={m} onPress={() => { setPaymentMethod(m); if (m === 'credit') { setShowCustomerDetails(true); setShowCreditTerms(true); } }} style={{
              paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999,
              backgroundColor: sel ? colors.ink : 'transparent',
              borderWidth: 1, borderColor: sel ? colors.ink : colors.border,
            }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: sel ? '#fdf7eb' : colors.muted }}>
                {m === 'ghqr' ? 'GhQR' : m[0].toUpperCase() + m.slice(1)}
              </Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity onPress={() => setShowCustomerDetails(true)}>
          <Text style={{ fontSize: 12, color: colors.brand, fontFamily: fonts.bodySemiBold }}>
            {showCustomerDetails ? 'Walk-in customer details' : 'Add customer details'}
          </Text>
        </TouchableOpacity>
      </View>
      {showCustomerDetails && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface, flexDirection: 'row', gap: 8 }}>
          <TextInput value={customerName} onChangeText={setCustomerName} placeholder="Customer name" placeholderTextColor={colors.muted} style={{ flex: 1, height: 38, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 9, color: colors.ink }} />
          <TextInput value={customerPhone} onChangeText={setCustomerPhone} placeholder="Ghana phone" keyboardType="phone-pad" placeholderTextColor={colors.muted} style={{ flex: 1, height: 38, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 9, color: colors.ink }} />
        </View>
      )}
      <Modal visible={showCreditTerms} transparent animationType="slide" onRequestClose={() => setShowCreditTerms(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 30 }}>
            <CreditTermsForm
              customerName={customerName}
              customerPhone={customerPhone}
              dueDate={creditDueDate}
              reminderConsent={reminderConsent}
              onCustomerName={setCustomerName}
              onCustomerPhone={setCustomerPhone}
              onDueDate={setCreditDueDate}
              onReminderConsent={setReminderConsent}
              busy={charging}
              onConfirm={() => { setShowCreditTerms(false); void handleCharge(); }}
            />
            <TouchableOpacity onPress={() => setShowCreditTerms(false)} style={{ height: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.muted }}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Cart item rows with +/- controls */}
      {cart.length > 0 && (
        <View style={{ maxHeight: 150, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 4 }}>
            {cart.map((line) => (
              <View key={line.item.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>
                  {line.item.name}
                </Text>
                <Text style={{ fontFamily: fonts.mono, fontSize: 11.5, color: colors.muted }}>
                  GH₵ {(line.qty * (line.unitPrice ?? line.item.sellPrice)).toFixed(2)}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <TouchableOpacity onPress={() => updateQty(line.item.id, -1)} style={{
                    width: 26, height: 26, borderRadius: 7,
                    backgroundColor: `${colors.ink}08`, alignItems: 'center', justifyContent: 'center',
                  }}>
                    <MaterialCommunityIcons name="minus" size={13} color={colors.ink} />
                  </TouchableOpacity>
                  <Text style={{ width: 22, textAlign: 'center', fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                    {line.qty}
                  </Text>
                  <TouchableOpacity onPress={() => updateQty(line.item.id, 1)} style={{
                    width: 26, height: 26, borderRadius: 7,
                    backgroundColor: `${colors.ink}08`, alignItems: 'center', justifyContent: 'center',
                  }}>
                    <MaterialCommunityIcons name="plus" size={13} color={colors.ink} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Quick-tap tile grid */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 10 }}>
        {loading ? (
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 24 }}>Loading items…</Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {tiles.map((item, i) => {
              const color = TILE_COLORS[i % TILE_COLORS.length];
              const inCart = cart.find((l) => l.item.id === item.id);
              return (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => addToCart(item)}
                  style={{
                    width: '31%',
                    aspectRatio: 1,
                    borderRadius: 14,
                    backgroundColor: inCart ? `${color}20` : colors.surface,
                    borderWidth: inCart ? 2 : 1,
                    borderColor: inCart ? color : colors.border,
                    padding: 10, justifyContent: 'space-between',
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{
                      width: 28, height: 28, borderRadius: 7,
                      backgroundColor: `${color}1a`,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
                    </View>
                    {inCart && (
                      <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: color, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                        <Text style={{ fontSize: 10, fontFamily: fonts.bodySemiBold, color: '#fff' }}>{inCart.qty}</Text>
                      </View>
                    )}
                  </View>
                  <View>
                    <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>{item.name}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.mono, marginTop: 1 }}>
                      GH₵ {item.sellPrice.toFixed(2)}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            {/* Custom tile */}
            <TouchableOpacity onPress={() => setShowCustom(true)} style={{
              width: '31%', aspectRatio: 1, borderRadius: 14,
              backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
              padding: 10, justifyContent: 'space-between',
            }}>
              <View style={{ width: 28, height: 28, borderRadius: 7, backgroundColor: `#6b686015`, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name="pencil-outline" size={14} color="#6b6860" />
              </View>
              <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.muted }}>Custom</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <Modal visible={showCustom} transparent animationType="slide" onRequestClose={() => setShowCustom(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} activeOpacity={1} onPress={() => setShowCustom(false)} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 }}>
            <Text style={{ fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink, marginBottom: 12 }}>Custom Item</Text>
            <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 4 }}>AMOUNT (GH₵)</Text>
            <TextInput
              value={customAmt}
              onChangeText={setCustomAmt}
              keyboardType="numeric"
              placeholder="0.00"
              placeholderTextColor={colors.muted}
              autoFocus
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                paddingHorizontal: 12, paddingVertical: 10,
                fontSize: 18, color: colors.ink, backgroundColor: colors.bg, marginBottom: 14,
              }}
            />
            <TouchableOpacity
              disabled={!customAmt || Number(customAmt) <= 0}
              onPress={() => {
                const price = Number(customAmt);
                if (!price) return;
                setCart((prev) => [...prev, {
                  item: { id: `custom-${Date.now()}`, name: 'Custom item', sellPrice: price } as LocalItem,
                  qty: 1,
                }]);
                setShowCustom(false);
                setCustomAmt('');
              }}
              style={{
                height: 46, borderRadius: 12, backgroundColor: colors.ink,
                alignItems: 'center', justifyContent: 'center',
                opacity: (!customAmt || Number(customAmt) <= 0) ? 0.4 : 1,
              }}
            >
              <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fdf7eb' }}>Add to cart</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function CashierQueue({ colors, fonts, pendingCount }: ReturnType<typeof useTheme> & { pendingCount: number }) {
  return (
    <View style={{ flex: 1 }}>
      {pendingCount > 0 && (
        <View style={{ margin: 14 }}>
          <View style={{
            padding: 12, borderRadius: 12,
            backgroundColor: `${colors.brand}10`, borderWidth: 1, borderColor: `${colors.brand}30`,
            flexDirection: 'row', alignItems: 'center', gap: 8,
          }}>
            <MaterialCommunityIcons name="sync" size={16} color={colors.brand} />
            <Text style={{ fontSize: 12.5, color: colors.brand, fontFamily: fonts.bodySemiBold }}>
              {pendingCount} sale{pendingCount !== 1 ? 's' : ''} pending sync · auto-retry every 30s
            </Text>
          </View>
        </View>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }}>
        {pendingCount === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 48 }}>
            <MaterialCommunityIcons name="check-circle-outline" size={36} color={colors.brand} />
            <Text style={{ fontSize: 14, color: colors.muted, marginTop: 8 }}>All sales synced</Text>
          </View>
        ) : (
          <>
            <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
              Awaiting sync
            </Text>
            <View style={{ padding: 12, borderRadius: 12, backgroundColor: `${colors.ink}06`, flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <MaterialCommunityIcons name="shield-check" size={16} color={colors.brand} />
              <Text style={{ fontSize: 11.5, color: colors.muted, lineHeight: 17, flex: 1 }}>
                Each sale has an idempotency key. Even with bad network, the same sale will never post twice.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function CashierShift({ colors, fonts }: ReturnType<typeof useTheme>) {
  const [shiftOpen, setShiftOpen] = useState(true);
  const [shiftStart] = useState(() => new Date());
  const { data: salesData } = useSalesHistory();

  const today = new Date().toDateString();
  const todaySales = ((salesData as SaleResponseDto[] | undefined) ?? []).filter(
    (s) => new Date(s.created_at).toDateString() === today
  );
  const shiftRevenue = todaySales.reduce((s, sale) => s + parseFloat(String(sale.total ?? 0)), 0);

  function getElapsed() {
    const ms = Date.now() - shiftStart.getTime();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function handleShare() {
    void Share.share({
      message: [
        `Z-Report · ${new Date().toLocaleDateString('en-GH')}`,
        `Shift start: ${shiftStart.toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}`,
        `Duration: ${getElapsed()}`,
        '',
        `Total sales: ${todaySales.length}`,
        `Revenue: GH₵ ${shiftRevenue.toFixed(2)}`,
      ].join('\n'),
    });
  }

  function handleClose() {
    setShiftOpen(false);
    Alert.alert(
      'Shift closed',
      `Duration: ${getElapsed()}\n${todaySales.length} sale${todaySales.length !== 1 ? 's' : ''} · GH₵ ${shiftRevenue.toFixed(2)} revenue`,
      [{ text: 'OK' }, { text: 'Share summary', onPress: handleShare }]
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 24 }}>
      <View style={{ backgroundColor: shiftOpen ? colors.ink : `${colors.ink}40`, borderRadius: 16, padding: 14, marginBottom: 12 }}>
        <Text style={{ fontSize: 10, color: 'rgba(245,239,225,0.5)', fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.8 }}>
          {shiftOpen ? 'Shift open' : 'Shift closed'}
        </Text>
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 26, color: '#fdf7eb', marginTop: 2, letterSpacing: -0.3 }}>
          GH₵ {shiftRevenue.toFixed(2)}
        </Text>
        <Text style={{ fontSize: 11, color: 'rgba(245,239,225,0.6)', marginTop: 1 }}>
          {todaySales.length} sale{todaySales.length !== 1 ? 's' : ''} · {shiftOpen ? `${getElapsed()} open` : 'shift ended'}
        </Text>
      </View>

      {shiftOpen ? (
        <View style={{ marginTop: 14, flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            onPress={handleClose}
            style={{
              flex: 1, height: 48, borderRadius: 12,
              backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center',
            }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#fdf7eb' }}>Close shift</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleShare}
            style={{
              height: 48, paddingHorizontal: 16, borderRadius: 12,
              borderWidth: 1.5, borderColor: colors.border,
              flexDirection: 'row', alignItems: 'center', gap: 6,
            }}>
            <MaterialCommunityIcons name="share-outline" size={14} color={colors.muted} />
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.muted }}>Share summary</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ marginTop: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
          <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink, marginBottom: 8 }}>Shift summary</Text>
          {[
            { label: 'Duration', value: getElapsed() },
            { label: 'Total sales', value: String(todaySales.length) },
            { label: 'Revenue', value: `GH₵ ${shiftRevenue.toFixed(2)}` },
          ].map((row, i, arr) => (
            <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 12.5, color: colors.muted }}>{row.label}</Text>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{row.value}</Text>
            </View>
          ))}
          <TouchableOpacity onPress={handleShare} style={{ marginTop: 12, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <MaterialCommunityIcons name="share-outline" size={15} color={colors.muted} />
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.muted }}>Share Z-report</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

export default function CashierScreen() {
  const theme = useTheme();
  const { colors, fonts } = theme;
  const [tab, setTab] = useState<Tab>('sell');
  const { items, loading } = useLocalItems();
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const business = useAuthStore((s) => s.business);

  const TABS: Array<{ id: Tab; label: string; badge?: number }> = [
    { id: 'sell',  label: 'Sell' },
    { id: 'queue', label: 'Queue', badge: pendingCount > 0 ? pendingCount : undefined },
    { id: 'shift', label: 'Shift' },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {/* Dark cashier header */}
      <View style={{
        paddingHorizontal: 14, paddingVertical: 12,
        backgroundColor: colors.ink,
        flexDirection: 'row', alignItems: 'center', gap: 10,
      }}>
        <View style={{
          width: 32, height: 32, borderRadius: 8,
          backgroundColor: 'rgba(245,239,225,0.1)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <MaterialCommunityIcons name="store" size={16} color="#fdf7eb" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 10, color: 'rgba(245,239,225,0.5)', fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Cashier
          </Text>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 15, color: '#fdf7eb' }}>{business?.name ?? 'Store'}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 9.5, color: 'rgba(245,239,225,0.5)', fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {items.length} products
          </Text>
        </View>
      </View>

      {/* Tab strip */}
      <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <TouchableOpacity key={t.id} onPress={() => setTab(t.id)} style={{
              flex: 1, paddingVertical: 11,
              alignItems: 'center', justifyContent: 'center',
              flexDirection: 'row', gap: 6,
              borderBottomWidth: 2,
              borderBottomColor: active ? colors.ink : 'transparent',
            }}>
              <Text style={{
                fontSize: 13, fontFamily: fonts.bodySemiBold,
                color: active ? colors.ink : colors.muted,
              }}>{t.label}</Text>
              {t.badge ? (
                <View style={{
                  minWidth: 18, height: 18, paddingHorizontal: 5,
                  borderRadius: 9, backgroundColor: '#b6831e',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 10, fontFamily: fonts.bodySemiBold, color: '#fff' }}>{t.badge}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'sell'  && <CashierSell {...theme} items={items} loading={loading} />}
        {tab === 'queue' && <CashierQueue {...theme} pendingCount={pendingCount} />}
        {tab === 'shift' && <CashierShift {...theme} />}
      </View>
    </SafeAreaView>
  );
}
