import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  Share,
  StatusBar,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera';
import { Text } from '@/components/ui/Text';
import {
  type CartLine,
  type LocalItem,
  type PaymentSplit,
  type SaleDraft,
  type SalePaymentMethod,
  useFilteredItems,
  useLocalItems,
} from '@/features/localData';
import {
  createPaystackSaleIntentFromCart,
  recordSaleOnlineFirst,
  verifyPaystackSaleIntent,
  type PaystackSaleIntentResult,
} from '@/features/onlineSales';
import {
  buildSaleDraft,
  findItemByBarcode,
  nextCartForQuantityChange,
  type SellMode,
} from '@/features/sellCart';
import { syncNow } from '@/db/sync/service';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';
import { useGenerateGhQR, useInvoiceBySale } from '@/api/hooks/featureHooks';
import { CreditTermsForm, creditDateAfter } from '@/components/sales/CreditTermsForm';

function ghc(v: number) {
  return `GH₵ ${v.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Tax rates sum to 17% (0.125+0.025+0.01+0.01). sell_price is tax-INCLUSIVE:
// customer pays the shelf price, tax is extracted from within it, never added on top.
const TAX = { vat: 0.125, nhil: 0.025, getfund: 0.01, covid: 0.01, combined: 0.17 };

function computeTax(chargedTotal: number, hasTax: boolean) {
  if (!hasTax) return { vatAmt: 0, nhilAmt: 0, getfundAmt: 0, covidAmt: 0, grandTotal: chargedTotal, taxBase: chargedTotal };
  const taxBase = chargedTotal / (1 + TAX.combined);
  return {
    taxBase,
    vatAmt:     taxBase * TAX.vat,
    nhilAmt:    taxBase * TAX.nhil,
    getfundAmt: taxBase * TAX.getfund,
    covidAmt:   taxBase * TAX.covid,
    grandTotal: chargedTotal,
  };
}

type Stage = 'cart' | 'method' | 'credit' | 'paystack' | 'ghqr' | 'success';
type SaleMode = SellMode;

// ─── POS Cart ─────────────────────────────────────────────────────────────────
function POSCart({
  cart, total, items: itemCount, updateQty, onClose, onCheckout,
  visibleItems, query, setQuery, categories, filter, setFilter,
  onManageInventory, onScanBarcode,
}: {
  cart: CartLine[]; total: number; items: number; updateQty: (id: string, d: number) => void;
  onClose: () => void; onCheckout: () => void;
  visibleItems: LocalItem[]; query: string; setQuery: (v: string) => void;
  categories: string[]; filter: string; setFilter: (v: string) => void;
  onManageInventory: () => void;
  onScanBarcode: () => void;
}) {
  const { colors, fonts, spacing } = useTheme();
  const business = useAuthStore((s) => s.business);
  const [showTaxBreakdown, setShowTaxBreakdown] = useState(false);
  const hasTax = cart.length > 0 && !!business?.tin;
  const { vatAmt, nhilAmt, getfundAmt, covidAmt, grandTotal, taxBase } = computeTax(total, hasTax);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Top bar */}
      <View style={{
        paddingHorizontal: 12, paddingVertical: 10,
        flexDirection: 'row', alignItems: 'center', gap: 8,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}>
        <TouchableOpacity onPress={onClose} style={{
          width: 36, height: 36, borderRadius: 12,
          backgroundColor: `${colors.ink}10`,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <MaterialCommunityIcons name="close" size={18} color={colors.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 16, color: colors.ink }}>New sale</Text>
          <Text style={{ fontSize: 11, color: colors.muted }}>
            {itemCount} item{itemCount !== 1 ? 's' : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={onScanBarcode} style={{
          width: 38, height: 38, borderRadius: 12,
          backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center',
        }}>
          <MaterialCommunityIcons name="barcode-scan" size={18} color="#fdf7eb" />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          paddingHorizontal: 12, height: 42,
          backgroundColor: colors.surface, borderWidth: 1,
          borderColor: colors.border, borderRadius: 12,
        }}>
          <MaterialCommunityIcons name="magnify" size={16} color={colors.muted} />
          <TextInput
            placeholder="Search items, SKU, or barcode"
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            style={{ flex: 1, fontSize: 14, color: colors.ink, fontFamily: fonts.body }}
          />
        </View>
      </View>

      {/* Category chips */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 6, alignItems: 'center' }}
      >
        {categories.slice(0, 6).map((cat, i) => {
          const label = cat === 'all' ? 'All items' : cat === 'low' ? 'Low stock' : cat;
          const sel = filter === cat;
          return (
            <TouchableOpacity key={cat} onPress={() => setFilter(cat)} style={{
              paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999,
              backgroundColor: sel ? colors.ink : colors.surface,
              borderWidth: sel ? 0 : 1, borderColor: colors.border,
            }}>
              <Text style={{
                fontSize: 12, fontFamily: fonts.bodySemiBold,
                color: sel ? '#fdf7eb' : colors.muted,
              }}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}>
        {/* Section label */}
        <Text style={{
          fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold,
          textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6,
        }}>
          In cart · {itemCount} item{itemCount !== 1 ? 's' : ''}
        </Text>

        {/* Cart items */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 12 }}>
          {cart.length === 0 ? (
            <View style={{ padding: 16 }}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Add items below to start a sale.</Text>
            </View>
          ) : cart.map((line, i) => (
            <View key={line.item.id} style={{
              flexDirection: 'row', alignItems: 'center', gap: 10,
              padding: 12,
              borderBottomWidth: i < cart.length - 1 ? 1 : 0,
              borderBottomColor: colors.border,
            }}>
              <View style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: `${colors.ink}08`,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ fontSize: 11, fontFamily: fonts.bodySemiBold, color: colors.muted }}>
                  {line.item.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{line.item.name}</Text>
                <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.mono }}>
                  GH₵ {line.item.sellPrice.toFixed(2)} ea
                </Text>
              </View>
              {/* Stepper */}
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: `${colors.ink}08`, borderRadius: 999, padding: 2,
              }}>
                <TouchableOpacity onPress={() => updateQty(line.item.id, -1)} style={{
                  width: 28, height: 28, borderRadius: 14,
                  backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <MaterialCommunityIcons name="minus" size={14} color={colors.muted} />
                </TouchableOpacity>
                <Text style={{ minWidth: 24, textAlign: 'center', fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                  {line.qty}
                </Text>
                <TouchableOpacity onPress={() => updateQty(line.item.id, 1)} style={{
                  width: 28, height: 28, borderRadius: 14,
                  backgroundColor: colors.ink,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <MaterialCommunityIcons name="plus" size={14} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
        {cart.length > 0 && (
          <TouchableOpacity
            onPress={() => {
              cart.forEach((line) => updateQty(line.item.id, -line.qty));
            }}
            style={{ alignSelf: 'flex-start', marginBottom: 12, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, backgroundColor: `${colors.danger}10` }}
          >
            <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.danger }}>Clear cart</Text>
          </TouchableOpacity>
        )}

        {/* Inventory list */}
        {visibleItems.length > 0 ? (
          <>
            <Text style={{
              fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold,
              textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6,
            }}>
              {query ? 'Search results' : 'Items'}
            </Text>
            <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
              {visibleItems.slice(0, 12).map((item, i, arr) => {
                const inCartQty = cart.find((line) => line.item.id === item.id)?.qty ?? 0;
                const remaining = Math.max(0, item.stockQty - inCartQty);
                const unavailable = remaining <= 0;
                return (
                <View key={item.id} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  padding: 10,
                  borderBottomWidth: i < arr.length - 1 ? 1 : 0,
                  borderBottomColor: colors.border,
                }}>
                  <View style={{
                    width: 32, height: 32, borderRadius: 8,
                    backgroundColor: `${colors.brand}15`,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <MaterialCommunityIcons name={unavailable ? 'minus-circle-outline' : 'plus'} size={16} color={unavailable ? colors.danger : colors.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{item.name}</Text>
                    <Text style={{ fontSize: 11, color: unavailable ? colors.danger : colors.muted }}>
                      {unavailable ? 'Out of stock' : `${remaining} ${item.unit} left`} · GH₵ {item.sellPrice.toFixed(2)}
                      {item.sku ? ` · ${item.sku}` : item.barcode ? ` · ${item.barcode}` : ''}
                    </Text>
                  </View>
                  <TouchableOpacity disabled={unavailable} onPress={() => updateQty(item.id, 1)} style={{
                    paddingVertical: 6, paddingHorizontal: 10,
                    borderRadius: 999, backgroundColor: unavailable ? `${colors.ink}08` : `${colors.brand}15`,
                  }}>
                    <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: unavailable ? colors.muted : colors.brand }}>
                      {unavailable ? 'None' : 'Add'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );})}
            </View>
          </>
        ) : (
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 18, alignItems: 'center' }}>
            <MaterialCommunityIcons name="package-variant-closed" size={24} color={colors.border} />
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
              {query ? 'No matching items found.' : 'No inventory items available.'}
            </Text>
            {!query && (
              <TouchableOpacity onPress={onManageInventory} style={{ marginTop: 10, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: `${colors.brand}15` }}>
                <Text style={{ color: colors.brand, fontSize: 12, fontFamily: fonts.bodySemiBold }}>Add inventory</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {/* Sticky checkout footer */}
      <View style={{
        paddingHorizontal: 12, paddingTop: 12, paddingBottom: 16,
        backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
      }}>
        {hasTax && showTaxBreakdown ? (
          <View style={{ gap: 3, marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Pre-tax base</Text>
              <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.muted }}>{ghc(taxBase)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>VAT (12.5%)</Text>
              <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.muted }}>{ghc(vatAmt)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>NHIL (2.5%)</Text>
              <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.muted }}>{ghc(nhilAmt)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>GETFund (1%)</Text>
              <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.muted }}>{ghc(getfundAmt)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>COVID Levy (1%)</Text>
              <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.muted }}>{ghc(covidAmt)}</Text>
            </View>
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>Total</Text>
              <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink }}>{ghc(grandTotal)}</Text>
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>Total</Text>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 24, color: colors.ink }}>{ghc(grandTotal)}</Text>
          </View>
        )}
        {hasTax && (
          <TouchableOpacity onPress={() => setShowTaxBreakdown((v) => !v)} style={{ marginTop: -5, marginBottom: 10, alignSelf: 'flex-start' }}>
            <Text style={{ fontSize: 11.5, color: colors.muted, fontFamily: fonts.bodySemiBold }}>
              {showTaxBreakdown ? 'Hide tax breakdown' : `Incl. VAT/levies · ${ghc(grandTotal - taxBase)}`}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={cart.length > 0 ? onCheckout : undefined}
          style={{
            height: 52, borderRadius: 14,
            backgroundColor: cart.length > 0 ? colors.ink : `${colors.ink}40`,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 16, color: '#fdf7eb' }}>
            Charge {ghc(grandTotal)}
          </Text>
          <MaterialCommunityIcons name="arrow-right" size={18} color="#fdf7eb" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── POS Method ───────────────────────────────────────────────────────────────
function POSMethod({
  total, onBack, onPick, phone, setPhone, customerName, setCustomerName, isRecording,
  showCustomerDetails, setShowCustomerDetails,
}: {
  total: number; onBack: () => void;
  onPick: (mode: SaleMode) => void;
  phone: string; setPhone: (v: string) => void;
  customerName: string; setCustomerName: (v: string) => void;
  isRecording: boolean;
  showCustomerDetails: boolean; setShowCustomerDetails: (v: boolean) => void;
}) {
  const { colors, fonts, spacing } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        flexDirection: 'row', alignItems: 'center', gap: 10,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}>
        <TouchableOpacity onPress={onBack} style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={colors.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 16, color: colors.ink }}>How is the customer paying?</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>GH₵ {total.toFixed(2)} due</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 4 }}>
          Payment method
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[
            { mode: 'paystack' as SaleMode, icon: 'credit-card-multiple-outline', label: 'Online checkout', sub: 'Adds to payout wallet after confirmation', accent: colors.info },
            { mode: 'cash' as SaleMode, icon: 'cash-multiple', label: 'Cash', sub: 'Take cash', accent: colors.brand },
            { mode: 'ghqr' as SaleMode, icon: 'qrcode', label: 'Manual QR', sub: 'Records sale only', accent: colors.info },
            { mode: 'credit' as SaleMode, icon: 'file-document', label: 'Credit', sub: 'Pay later', accent: '#b6831e' },
          ].map((m) => (
            <TouchableOpacity
              key={m.mode}
              disabled={isRecording}
              onPress={() => onPick(m.mode)}
              style={{
                width: '47%', padding: 14, borderRadius: 14,
                backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                gap: 8, opacity: isRecording ? 0.5 : 1,
              }}
            >
              <View style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: m.mode === 'credit' ? '#fff5cc' : `${m.accent}15`,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <MaterialCommunityIcons name={m.icon as never} size={18} color={m.accent} />
              </View>
              <View>
                <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{m.label}</Text>
                <Text style={{ fontSize: 11.5, color: colors.muted }}>{m.sub}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 8 }}>
          Customer
        </Text>
        <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 9 }}>
          <TouchableOpacity onPress={() => setShowCustomerDetails(!showCustomerDetails)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.ink }}>Walk-in customer</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{showCustomerDetails ? 'Customer details are optional unless paying by Credit.' : 'No name or phone required.'}</Text>
            </View>
            <Text style={{ color: colors.brand, fontFamily: fonts.bodySemiBold }}>{showCustomerDetails ? 'Hide' : 'Add customer details'}</Text>
          </TouchableOpacity>
          {showCustomerDetails && <>
            <TextInput value={customerName} onChangeText={setCustomerName} placeholder="Customer name" placeholderTextColor={colors.muted} style={{ height: 42, paddingHorizontal: 12, backgroundColor: `${colors.ink}05`, borderRadius: 12, color: colors.ink }} />
            <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Customer phone (optional)" placeholderTextColor={colors.muted} style={{ height: 44, paddingHorizontal: 12, backgroundColor: `${colors.ink}05`, borderRadius: 12, color: colors.ink }} />
          </>}
        </View>
      </ScrollView>
    </View>
  );
}

function POSPaystack({
  total, intent, isConfirming, onCreate, onCheckNow, onCancel,
}: {
  total: number;
  intent: PaystackSaleIntentResult | null;
  isConfirming: boolean;
  onCreate: () => void;
  onCheckNow: () => void;
  onCancel: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TouchableOpacity onPress={onCancel}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.ink} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 17, color: colors.ink }}>Pay with Paystack</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>Customer chooses card, MoMo, bank, or another enabled channel</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, alignItems: 'center', gap: 16 }}>
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 28, color: colors.ink }}>{ghc(total)}</Text>
        {intent?.qrImageUrl ? <Image source={{ uri: intent.qrImageUrl }} style={{ width: 240, height: 240, borderRadius: 14 }} /> : <MaterialCommunityIcons name="qrcode" size={150} color={colors.border} />}
        <Text style={{ color: colors.brand, fontFamily: fonts.bodySemiBold, fontSize: 12.5, textAlign: 'center' }}>
          Funds enter your Payments wallet after provider confirmation.
        </Text>
        <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center' }}>
          {intent ? 'Customer scans this QR or opens the shared link. This screen will update automatically after payment.' : 'Create a customer payment link. The merchant stays on this screen.'}
        </Text>
        {intent?.channel ? <Text style={{ color: colors.brand, fontFamily: fonts.bodySemiBold }}>Received via {intent.channel.replace(/_/g, ' ')}{intent.providerDetail ? ` · ${intent.providerDetail}` : ''}</Text> : null}
        {intent?.paymentUrl ? <TouchableOpacity onPress={() => void Share.share({ message: intent.paymentUrl! })} style={{ paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1, borderColor: colors.brand }}><Text style={{ color: colors.brand, fontFamily: fonts.bodySemiBold }}>Share payment link</Text></TouchableOpacity> : null}
      </ScrollView>
      <View style={{ padding: 16, gap: 10 }}>
        <TouchableOpacity disabled={isConfirming} onPress={intent ? onCheckNow : onCreate} style={{ height: 52, borderRadius: 14, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
          {isConfirming ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontFamily: fonts.bodySemiBold }}>{intent ? 'Check payment now' : 'Create Paystack payment'}</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={onCancel} style={{ height: 48, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.muted }}>Back to payment methods</Text></TouchableOpacity>
      </View>
    </View>
  );
}

// ─── GhQR Payment Stage ────────────────────────────────────────────────────────
function GhQRStage({
  qrImageUrl, qrLoading, total, onConfirm, onCancel, isRecording,
}: {
  qrImageUrl: string | null;
  qrLoading: boolean;
  total: number;
  onConfirm: () => void;
  onCancel: () => void;
  isRecording: boolean;
}) {
  const { colors, fonts, spacing } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        flexDirection: 'row', alignItems: 'center',
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}>
        <TouchableOpacity onPress={onCancel} style={{ marginRight: 12, padding: 4 }}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.ink} />
        </TouchableOpacity>
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 18, color: colors.ink, flex: 1 }}>
          Manual QR payment
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, alignItems: 'center', gap: 20 }}>
        <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center' }}>
          This records the sale only. It will not enter payout balance unless a provider confirmation is received.
        </Text>

        <View style={{
          width: 240, height: 240,
          borderRadius: 16,
          backgroundColor: colors.surface,
          borderWidth: 1, borderColor: colors.border,
          alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}>
          {qrLoading ? (
            <ActivityIndicator size="large" color={colors.brand} />
          ) : qrImageUrl ? (
            <Image
              source={{ uri: qrImageUrl }}
              style={{ width: 220, height: 220 }}
              resizeMode="contain"
            />
          ) : (
            <MaterialCommunityIcons name="qrcode" size={80} color={colors.border} />
          )}
        </View>

        <View style={{
          backgroundColor: colors.surface, borderRadius: 12,
          borderWidth: 1, borderColor: colors.border,
          padding: 14, width: '100%', alignItems: 'center',
        }}>
          <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            Amount to collect
          </Text>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 28, color: colors.ink, marginTop: 4 }}>
            {`GH₵ ${total.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </Text>
        </View>

        <TouchableOpacity
          onPress={onConfirm}
          disabled={isRecording}
          style={{
            width: '100%', height: 50, borderRadius: 14,
            backgroundColor: colors.brand,
            alignItems: 'center', justifyContent: 'center',
            opacity: isRecording ? 0.6 : 1,
          }}
        >
          {isRecording ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#fff' }}>
              Payment confirmed manually — record sale
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={onCancel} style={{ paddingVertical: 8 }}>
          <Text style={{ fontSize: 13, color: colors.muted }}>Back to payment methods</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── POS Success / Receipt ─────────────────────────────────────────────────────
function POSSuccess({
  total, cartLines, method, onDone,
  receiptRef, saleId, isOffline,
  creditDueDate, customerName,
}: {
  total: number; cartLines: CartLine[]; method: SaleMode | null;
  onDone: () => void; receiptRef: string; saleId: string | null; isOffline: boolean;
  creditDueDate?: string; customerName?: string;
}) {
  const { colors, fonts } = useTheme();
  const business = useAuthStore((s) => s.business);
  const hasTax = !!business?.tin;
  // computeTax takes the charged total and extracts the pre-tax base + components
  const { taxBase, vatAmt, nhilAmt, getfundAmt, covidAmt } = computeTax(total, hasTax);

  const invoiceQuery = useInvoiceBySale(saleId);
  const inv = invoiceQuery.data;

  // Show tax breakdown if TIN is set locally OR if the invoice confirms tax was applied
  const showTaxBreakdown = hasTax || (!!inv && Number(inv.vat_amount) > 0);
  // Pre-tax base: prefer invoice (authoritative) then local extraction
  const displaySubtotal = inv ? Number(inv.subtotal) : taxBase;

  const displayInvoiceNum = inv?.invoice_number ?? (receiptRef.slice(0, 8).toUpperCase());
  const invoiceReady = !!inv?.invoice_number;

  const methodLabel = method === 'momo' ? 'MTN MoMo' : method === 'paystack' ? 'Paystack' : method === 'cash' ? 'Cash' : method === 'ghqr' ? 'GhQR' : method === 'credit' ? 'Credit' : 'Split';

  async function shareReceipt() {
    const displayVat     = inv ? Number(inv.vat_amount)     : vatAmt;
    const displayNhil    = inv ? Number(inv.nhil_amount)    : nhilAmt;
    const displayGetfund = inv ? Number(inv.getfund_amount) : getfundAmt;
    const displayCovid   = inv ? Number(inv.covid_levy)     : covidAmt;
    const displayTotal   = inv ? Number(inv.total)          : total;
    const displaySub     = inv ? Number(inv.subtotal)       : taxBase;
    const itemLines = (inv?.line_items?.length
      ? inv.line_items.map((l) => `${l.description}  GH₵ ${Number(l.line_total).toFixed(2)}`)
      : cartLines.map((l) => `${l.item.name} x${l.qty}  GH₵ ${((l.unitPrice ?? l.item.sellPrice) * l.qty).toFixed(2)}`)
    );
    const taxLines = hasTax ? [
      `VAT 12.5%     GH₵ ${displayVat.toFixed(2)}`,
      `NHIL 2.5%     GH₵ ${displayNhil.toFixed(2)}`,
      `GETFund 1%    GH₵ ${displayGetfund.toFixed(2)}`,
      `COVID Levy 1% GH₵ ${displayCovid.toFixed(2)}`,
    ] : [];
    const message = [
      `Receipt — ${business?.name ?? 'Your Business'}`,
      business?.tin ? `TIN: ${business.tin}` : null,
      inv?.invoice_number ? `Invoice: ${inv.invoice_number}` : `Ref: ${receiptRef.slice(0, 8).toUpperCase()}`,
      `Date: ${new Date().toLocaleString('en-GH')}`,
      '',
      ...itemLines,
      '',
      hasTax ? `Pre-tax base  GH₵ ${displaySub.toFixed(2)}` : `Subtotal      GH₵ ${displaySub.toFixed(2)}`,
      ...taxLines,
      `Total         GH₵ ${displayTotal.toFixed(2)}`,
      method === 'credit' ? `Balance due ${inv?.due_date ? new Date(inv.due_date).toLocaleDateString('en-GH') : creditDueDate}` : `Paid via ${methodLabel}`,
    ].filter((l) => l !== null).join('\n');
    try { await Share.share({ message }); } catch { /* user cancelled */ }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Check + title */}
      <View style={{ paddingTop: 24, paddingBottom: 8, alignItems: 'center' }}>
        <View style={{
          width: 72, height: 72, borderRadius: 36,
          backgroundColor: colors.brand,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: colors.brand, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.4, shadowRadius: 20,
          elevation: 8,
        }}>
          <MaterialCommunityIcons name="check" size={38} color="#fff" />
        </View>
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.ink, marginTop: 10 }}>
          {isOffline ? 'Sale queued' : method === 'credit' ? 'Credit sale recorded' : method === 'momo' ? 'Payment pending' : 'Sale recorded'}
        </Text>
        {method === 'momo' && !isOffline && (
          <View style={{
            backgroundColor: '#fff8e1', borderRadius: 10,
            paddingHorizontal: 12, paddingVertical: 7,
            marginTop: 6, marginHorizontal: 24,
          }}>
            <Text style={{ fontSize: 12, color: '#78350f', textAlign: 'center' }}>
              Waiting for customer to approve the MoMo prompt.{'\n'}Sale is recorded — funds confirm automatically.
            </Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: method === 'momo' ? 8 : 2 }}>
          <Text style={{ fontFamily: fonts.mono, fontSize: 13, color: colors.muted }}>
            {displayInvoiceNum} · {cartLines.reduce((s, l) => s + l.qty, 0)} items
          </Text>
          {!isOffline && !invoiceReady && (
            <ActivityIndicator size="small" color={colors.muted} style={{ transform: [{ scale: 0.7 }] }} />
          )}
          {invoiceReady && (
            <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: `${colors.brand}15` }}>
              <Text style={{ fontSize: 9, fontFamily: fonts.bodySemiBold, color: colors.brand }}>INVOICE READY</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        {/* Receipt card */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
          {/* Header */}
          <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 16, color: colors.ink }}>{business?.name ?? 'Your Business'}</Text>
              <View style={{
                paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
                backgroundColor: isOffline ? '#fff5cc' : method === 'momo' ? '#fff8e1' : `${colors.brand}15`,
              }}>
                <Text style={{ fontSize: 10.5, fontFamily: fonts.bodySemiBold, color: isOffline ? '#b6831e' : method === 'momo' ? '#92650a' : colors.brand }}>
                  {isOffline ? 'Queued' : method === 'credit' ? 'Due' : method === 'momo' ? 'Pending' : 'Paid'}
                </Text>
              </View>
            </View>
            {method === 'credit' && <Text style={{ fontSize: 12, color: colors.muted }}>{customerName} · Due {new Date(`${creditDueDate}T00:00:00`).toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>}
            <Text style={{ fontSize: 11, color: colors.muted }}>
              {[business?.type?.replace(/_/g, ' '), business?.tin ? `TIN ${business.tin}` : null].filter(Boolean).join(' · ')}
            </Text>
          </View>

          {/* Line items */}
          <View style={{ padding: 12, gap: 6 }}>
            {cartLines.map((line) => (
              <View key={line.item.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 12.5, color: colors.muted, flex: 1 }}>
                  {line.item.name} × {line.qty}
                </Text>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.mono, fontWeight: '500' as never, color: colors.ink }}>
                  GH₵ {(line.item.sellPrice * line.qty).toFixed(2)}
                </Text>
              </View>
            ))}
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 11.5, color: colors.muted }}>{showTaxBreakdown ? 'Pre-tax base' : 'Subtotal'}</Text>
              <Text style={{ fontSize: 11.5, fontFamily: fonts.mono, color: colors.muted }}>GH₵ {displaySubtotal.toFixed(2)}</Text>
            </View>
            {showTaxBreakdown && (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 11.5, color: colors.muted }}>VAT (12.5%)</Text>
                  <Text style={{ fontSize: 11.5, fontFamily: fonts.mono, color: colors.muted }}>GH₵ {(inv ? Number(inv.vat_amount) : vatAmt).toFixed(2)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 11.5, color: colors.muted }}>NHIL (2.5%)</Text>
                  <Text style={{ fontSize: 11.5, fontFamily: fonts.mono, color: colors.muted }}>GH₵ {(inv ? Number(inv.nhil_amount) : nhilAmt).toFixed(2)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 11.5, color: colors.muted }}>GETFund (1%)</Text>
                  <Text style={{ fontSize: 11.5, fontFamily: fonts.mono, color: colors.muted }}>GH₵ {(inv ? Number(inv.getfund_amount) : getfundAmt).toFixed(2)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 11.5, color: colors.muted }}>COVID Levy (1%)</Text>
                  <Text style={{ fontSize: 11.5, fontFamily: fonts.mono, color: colors.muted }}>GH₵ {(inv ? Number(inv.covid_levy) : covidAmt).toFixed(2)}</Text>
                </View>
              </>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
              <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Total</Text>
              <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink }}>GH₵ {(inv ? Number(inv.total) : total).toFixed(2)}</Text>
            </View>
          </View>

          {/* Payment method footer */}
          <View style={{
            padding: 12, backgroundColor: `${colors.brand}10`,
            borderTopWidth: 1, borderTopColor: colors.border,
            flexDirection: 'row', alignItems: 'center', gap: 10,
          }}>
            <View style={{ width: 44, height: 44, borderRadius: 6, backgroundColor: colors.ink, opacity: 0.85 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.brand }}>
                Paid via {methodLabel}
              </Text>
              {method === 'paystack' ? (
                <Text style={{ fontSize: 11, color: colors.brand, marginTop: 1 }}>
                  Provider-confirmed funds move to Payments wallet.
                </Text>
              ) : null}
              <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.mono }}>
                Ref {receiptRef.slice(0, 12).toUpperCase()} · Receipt signed
              </Text>
            </View>
          </View>
        </View>

        <View style={{ height: 14 }} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[
            { icon: 'whatsapp', label: 'WhatsApp' },
            { icon: 'phone', label: 'SMS receipt' },
          ].map((btn) => (
            <TouchableOpacity key={btn.label} onPress={() => void shareReceipt()} style={{
              flex: 1, height: 46, borderRadius: 12,
              backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              <MaterialCommunityIcons name={btn.icon as never} size={18} color={colors.muted} />
              <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.muted }}>{btn.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingBottom: 20, paddingTop: 10, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
        <TouchableOpacity onPress={onDone} style={{
          height: 52, borderRadius: 14,
          backgroundColor: colors.ink,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 16, color: '#fdf7eb' }}>Done · New sale</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Main POS Screen ───────────────────────────────────────────────────────────
export default function SellScreen() {
  const { colors, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { items, reload } = useLocalItems();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [stage, setStage] = useState<Stage>('cart');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [method, setMethod] = useState<SaleMode | null>(null);
  const [phone, setPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [showCustomerDetails, setShowCustomerDetails] = useState(false);
  const [creditDueDate, setCreditDueDate] = useState(creditDateAfter(7));
  const [reminderConsent, setReminderConsent] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [paystackIntent, setPaystackIntent] = useState<PaystackSaleIntentResult | null>(null);
  const paystackPollCountRef = useRef(0);
  const [showScanner, setShowScanner] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const scanLockedRef = useRef(false);
  const [receiptRef, setReceiptRef] = useState('');
  const [saleId, setSaleId] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const generateGhQR = useGenerateGhQR();

  const visibleItems = useFilteredItems(items, query, filter);
  const subtotal = cart.reduce((sum, line) => sum + line.item.sellPrice * line.qty, 0);
  const itemCount = cart.reduce((s, l) => s + l.qty, 0);
  const screenBusiness = useAuthStore((s) => s.business);
  const screenHasTax = !!screenBusiness?.tin;
  const { grandTotal } = computeTax(subtotal, screenHasTax);
  const categories = useMemo(
    () => ['all', 'low', ...Array.from(new Set(items.map((i) => i.category).filter((c): c is string => !!c)))],
    [items]
  );

  useFocusEffect(useCallback(() => {
    let active = true;
    async function refresh() {
      try { await syncNow(); } finally { if (active) await reload(); }
    }
    void refresh();
    return () => { active = false; };
  }, [reload]));

  useEffect(() => {
    if (stage !== 'paystack' || !paystackIntent?.paymentId || paystackIntent.saleId || ['failed', 'reversed'].includes(paystackIntent.status)) return;
    paystackPollCountRef.current = 0;
    const MAX_POLLS = 60; // 3 minutes at 3s intervals
    const timer = setInterval(() => {
      paystackPollCountRef.current += 1;
      if (paystackPollCountRef.current >= MAX_POLLS) {
        clearInterval(timer);
        Alert.alert('Payment timeout', 'No payment detected after 3 minutes. Tap "Check payment now" to retry manually.');
        return;
      }
      void checkPaystackPayment(false);
    }, 3000);
    return () => clearInterval(timer);
  }, [stage, paystackIntent?.paymentId, paystackIntent?.saleId, paystackIntent?.status]);

  async function handleCreatePaystack() {
    if (paystackIntent) return;
    setIsConfirming(true);
    try {
      const draft = buildSaleDraft({ customerName, customerPhone: phone, mode: 'paystack' });
      setPaystackIntent(await createPaystackSaleIntentFromCart(cart, draft));
    } catch (err) {
      const data = (err as { response?: { data?: { error?: { message?: string }; detail?: Array<{ msg: string }> } } })?.response?.data;
      const message = data?.error?.message || (Array.isArray(data?.detail) ? data.detail.map((d) => d.msg).join('; ') : null) || (err as Error).message;
      Alert.alert('Paystack payment not created', message);
    } finally {
      setIsConfirming(false);
    }
  }

  async function checkPaystackPayment(showAlerts = true) {
    if (!paystackIntent?.paymentId || isConfirming) return;
    setIsConfirming(true);
    try {
      const next = await verifyPaystackSaleIntent(paystackIntent.paymentId);
      setPaystackIntent(next);
      if (next.saleId) {
        setReceiptRef(next.saleId);
        setSaleId(next.saleId);
        setIsOffline(false);
        setMethod('paystack');
        setStage('success');
      } else if (showAlerts) {
        Alert.alert('Waiting for payment', 'The customer has not completed payment yet.');
      }
    } catch (err) {
      if (showAlerts) Alert.alert('Could not check payment', (err as Error).message);
    } finally {
      setIsConfirming(false);
    }
  }

  function updateQty(itemId: string, delta: number) {
    setCart((current) => {
      const result = nextCartForQuantityChange(current, items, itemId, delta);
      if (result.reason === 'out-of-stock') Alert.alert('Out of stock', 'This item has no stock available.');
      if (result.reason === 'stock-limit') Alert.alert('Stock limit', 'Quantity cannot exceed available stock.');
      return result.cart;
    });
  }

  async function openScanner() {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Camera permission needed', 'Allow camera access to scan item barcodes.');
        return;
      }
    }
    scanLockedRef.current = false;
    setScanLocked(false);
    setShowScanner(true);
  }

  function closeScanner() {
    scanLockedRef.current = true;
    setScanLocked(true);
    setShowScanner(false);
  }

  function handleScannedBarcode(result: BarcodeScanningResult) {
    if (scanLockedRef.current) return;
    scanLockedRef.current = true;
    setScanLocked(true);
    const item = findItemByBarcode(items, result.data);
    setShowScanner(false);
    if (!item) {
      setQuery(result.data);
      Alert.alert('Barcode not found', 'No local inventory item matches this barcode. The barcode has been placed in search.');
      return;
    }
    updateQty(item.id, 1);
  }

  async function completeSale(picked: SaleMode): Promise<boolean> {
    let draft: SaleDraft;
    try {
      draft = buildSaleDraft({
        customerName,
        customerPhone: phone,
        mode: picked,
        creditDueDate: picked === 'credit' ? creditDueDate : undefined,
        reminderConsent: picked === 'credit' ? reminderConsent : false,
        reminderChannel: 'whatsapp',
      });
    } catch (err) {
      Alert.alert('Check sale details', (err as Error).message);
      return false;
    }

    setIsRecording(true);
    try {
      const result = await recordSaleOnlineFirst(cart, draft);
      setReceiptRef(result.saleId || result.idempotencyKey);
      setSaleId(result.saleId || null);
      setIsOffline(result.mode === 'offline');
      return true;
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: Array<{ msg: string }> } } })?.response?.data?.detail;
      const message = Array.isArray(detail) && detail.length
        ? detail.map((d) => d.msg).join('; ')
        : (err as Error).message ?? 'Could not record sale';
      Alert.alert('Sale not recorded', message);
      return false;
    } finally {
      setIsRecording(false);
    }
  }

  async function handlePick(picked: SaleMode) {
    setMethod(picked);
    if (picked === 'credit') {
      setShowCustomerDetails(true);
      setStage('credit');
      return;
    }
    if (picked === 'paystack') {
      setPaystackIntent(null);
      setStage('paystack');
    } else if (picked === 'ghqr') {
      generateGhQR.mutate(
        { amount: grandTotal.toFixed(2), description: 'SMEflow POS sale' },
        {
          onSuccess: () => setStage('ghqr'),
          onError: (e: Error) => Alert.alert('GhQR error', e.message),
        }
      );
    } else {
      const ok = await completeSale(picked);
      if (ok) setStage('success');
    }
  }

  function resetSale() {
    setCart([]);
    setMethod(null);
    setPhone('');
    setCustomerName('');
    setShowCustomerDetails(false);
    setCreditDueDate(creditDateAfter(7));
    setReceiptRef('');
    setSaleId(null);
    setPaystackIntent(null);
    setStage('cart');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {stage === 'cart' && (
        <POSCart
          cart={cart}
          total={subtotal}
          items={itemCount}
          updateQty={updateQty}
          onClose={() => router.back()}
          onCheckout={() => setStage('method')}
          visibleItems={visibleItems}
          query={query}
          setQuery={setQuery}
          categories={categories}
          filter={filter}
          setFilter={setFilter}
          onManageInventory={() => router.push('/owner/inventory' as never)}
          onScanBarcode={() => void openScanner()}
        />
      )}
      {stage === 'method' && (
        <POSMethod
          total={grandTotal}
          onBack={() => setStage('cart')}
          onPick={handlePick}
          phone={phone}
          setPhone={setPhone}
          customerName={customerName}
          setCustomerName={setCustomerName}
          isRecording={isRecording}
          showCustomerDetails={showCustomerDetails}
          setShowCustomerDetails={setShowCustomerDetails}
        />
      )}
      {stage === 'paystack' && (
        <POSPaystack
          total={grandTotal}
          intent={paystackIntent}
          isConfirming={isConfirming}
          onCreate={() => void handleCreatePaystack()}
          onCheckNow={() => void checkPaystackPayment(true)}
          onCancel={() => setStage('method')}
        />
      )}
      {stage === 'credit' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
          <TouchableOpacity onPress={() => setStage('method')}><Text style={{ color: colors.brand }}>Back to payment methods</Text></TouchableOpacity>
          <CreditTermsForm
            customerName={customerName}
            customerPhone={phone}
            dueDate={creditDueDate}
            reminderConsent={reminderConsent}
            onCustomerName={setCustomerName}
            onCustomerPhone={setPhone}
            onDueDate={setCreditDueDate}
            onReminderConsent={setReminderConsent}
            busy={isRecording}
            onConfirm={async () => { const ok = await completeSale('credit'); if (ok) setStage('success'); }}
          />
        </ScrollView>
      )}
      {stage === 'ghqr' && (
        <GhQRStage
          qrImageUrl={generateGhQR.data?.qr_image_url ?? null}
          qrLoading={generateGhQR.isPending}
          total={grandTotal}
          onConfirm={async () => {
            const ok = await completeSale('ghqr');
            if (ok) setStage('success');
          }}
          onCancel={() => { generateGhQR.reset(); setStage('method'); }}
          isRecording={isRecording}
        />
      )}
      {stage === 'success' && (
        <POSSuccess
          total={grandTotal}
          cartLines={cart}
          method={method}
          onDone={resetSale}
          receiptRef={receiptRef}
          saleId={saleId}
          isOffline={isOffline}
          creditDueDate={method === 'credit' ? creditDueDate : undefined}
          customerName={method === 'credit' ? customerName : undefined}
        />
      )}
      <StatusBar hidden={showScanner} />
      <Modal visible={showScanner} animationType="slide" onRequestClose={closeScanner}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.ink }} edges={['top', 'bottom']}>
          <View style={{
            paddingHorizontal: 16,
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: 12,
            flexDirection: 'row',
            alignItems: 'center',
            zIndex: 2,
          }}>
            <TouchableOpacity hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }} onPress={closeScanner} style={{
              width: 40, height: 40, borderRadius: 12,
              backgroundColor: 'rgba(255,255,255,0.12)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <MaterialCommunityIcons name="close" size={20} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: '#fff', fontSize: 16, fontFamily: fonts.bodySemiBold }}>Scan item barcode</Text>
              <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12 }}>Point the camera at a product barcode.</Text>
            </View>
          </View>
          {showScanner && (
            <CameraView
              active={showScanner}
              barcodeScannerSettings={{
                barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'],
              }}
              facing="back"
              onBarcodeScanned={scanLocked ? undefined : handleScannedBarcode}
              style={{ flex: 1 }}
            />
          )}
          <View style={{ padding: 16, backgroundColor: colors.ink }}>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, textAlign: 'center' }}>
              If the barcode is not found, it will be copied into search so you can check inventory manually.
            </Text>
            <TouchableOpacity onPress={closeScanner} style={{
              marginTop: 12,
              height: 46,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.22)',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Text style={{ color: '#fff', fontFamily: fonts.bodySemiBold, fontSize: 14 }}>Cancel scan</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
