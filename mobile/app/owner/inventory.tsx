import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, type BarcodeScanningResult, useCameraPermissions } from 'expo-camera';
import { Text } from '@/components/ui/Text';
import { type LocalItem, useLocalItems } from '@/features/localData';
import {
  useAdjustStock,
  useCreateItem,
  useCreatePurchaseOrder,
  useCreateSupplier,
  useDeleteSupplier,
  useInventoryItems,
  usePurchaseOrders,
  useReceivePurchaseOrder,
  useSalesHistory,
  useSuppliers,
  useThresholdSuggestion,
  useTopItems,
  useUpdateItem,
  useUpdateSupplier,
} from '@/api/hooks/featureHooks';
import type { SaleResponseDto } from '@/types/sales';
import type { CreateSupplierDto, PurchaseOrderDto, SupplierDto } from '@/types/inventory';
import { useTheme } from '@/lib/theme';
import { recordInputVAT } from '@/api/tax.api';

function initials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function ItemDetail({ item, onBack }: { item: LocalItem; onBack: () => void }) {
  const { colors, fonts, spacing } = useTheme();
  const adjustStock = useAdjustStock();
  const suggestion = useThresholdSuggestion();
  const updateItem = useUpdateItem();
  const { data: salesData } = useSalesHistory();
  const [showRestock, setShowRestock] = useState(false);
  const [restockQty, setRestockQty] = useState('');
  const isLow = item.stockQty <= item.lowStockThreshold;
  const margin = item.costPrice && item.costPrice > 0
    ? Math.round(((item.sellPrice - item.costPrice) / item.sellPrice) * 100)
    : null;

  const daysLeft = (() => {
    if (!salesData || !Array.isArray(salesData)) return Math.round(item.stockQty / 4);
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const recentSales = (salesData as SaleResponseDto[]).filter(
      (s) => now - new Date(s.created_at).getTime() <= sevenDaysMs
    );
    const soldQty = recentSales
      .flatMap((s) => s.items ?? [])
      .filter((it) => (it.description ?? '').toLowerCase() === item.name.toLowerCase())
      .reduce((sum, it) => sum + Number(it.qty ?? 0), 0);
    if (soldQty === 0) return Math.round(item.stockQty / 4);
    return Math.round(item.stockQty / (soldQty / 7));
  })();

  const itemSpark = (() => {
    if (!salesData || !Array.isArray(salesData)) return new Array(14).fill(0);
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const bins = new Array(14).fill(0);
    (salesData as SaleResponseDto[]).forEach((s) => {
      const age = Math.floor((now - new Date(s.created_at).getTime()) / dayMs);
      if (age >= 0 && age < 14) {
        (s.items ?? []).forEach((it) => {
          if ((it.description ?? '').toLowerCase() === item.name.toLowerCase()) {
            bins[13 - age] += Number(it.qty ?? 0);
          }
        });
      }
    });
    return bins;
  })();
  const maxV = Math.max(...itemSpark, 1);

  const trendPct = (() => {
    const first7 = itemSpark.slice(0, 7).reduce((a: number, b: number) => a + b, 0);
    const last7 = itemSpark.slice(7).reduce((a: number, b: number) => a + b, 0);
    if (first7 === 0) return null;
    return Math.round(((last7 - first7) / first7) * 100);
  })();

  const recentMovements = (() => {
    if (!salesData || !Array.isArray(salesData)) return [];
    return (salesData as SaleResponseDto[])
      .filter((s) => (s.items ?? []).some(
        (it) => (it.description ?? '').toLowerCase() === item.name.toLowerCase()
      ))
      .slice(0, 5)
      .map((s) => {
        const soldQty = (s.items ?? [])
          .filter((it) => (it.description ?? '').toLowerCase() === item.name.toLowerCase())
          .reduce((sum, it) => sum + Number(it.qty ?? 0), 0);
        const d = new Date(s.created_at);
        const label = d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' +
          d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        return { d: label, t: 'Sale', q: `−${soldQty}`, color: colors.danger };
      });
  })();

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
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 16, color: colors.ink, lineHeight: 20 }}>{item.name}</Text>
          <Text style={{ fontSize: 11, color: colors.muted }}>
            SKU {item.sku || '—'} · Barcode {item.barcode || '—'}
          </Text>
        </View>
        <TouchableOpacity style={{
          width: 38, height: 38, borderRadius: 12,
          backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <MaterialCommunityIcons name="dots-horizontal" size={18} color={colors.muted} />
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10 }}>
        {/* Stock hero */}
        <View style={{
          padding: 14, borderRadius: 16,
          backgroundColor: isLow ? '#fff5cc' : `${colors.brand}10`,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                On hand
              </Text>
              <Text style={{
                fontFamily: fonts.displaySemiBold, fontSize: 32, marginTop: 2,
                color: isLow ? '#b6831e' : colors.brand,
              }}>
                {item.stockQty}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 1 }}>
                <Text style={{ fontSize: 12.5, color: colors.muted }}>
                  Threshold: {item.lowStockThreshold}
                </Text>
                <TouchableOpacity
                  disabled={suggestion.isPending || !item.serverId}
                  onPress={() => {
                    if (!item.serverId) {
                      Alert.alert('Sync required', 'This item must sync before getting suggestions.');
                      return;
                    }
                    suggestion.mutate(item.serverId, {
                      onSuccess: (data) => {
                        Alert.alert(
                          `Suggested threshold: ${data.suggested_threshold}`,
                          data.reasoning ?? 'Based on recent sales velocity.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Apply',
                              onPress: () =>
                                updateItem.mutate(
                                  {
                                    itemId: item.serverId!,
                                    body: { low_stock_threshold: String(data.suggested_threshold) },
                                  },
                                  {
                                    onSuccess: () => Alert.alert('Updated', 'Low stock threshold updated.'),
                                    onError: (e: Error) => Alert.alert('Error', e.message),
                                  }
                                ),
                            },
                          ]
                        );
                      },
                      onError: (e: Error) => Alert.alert('Error', e.message ?? 'Could not get suggestion.'),
                    });
                  }}
                  style={{
                    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
                    borderWidth: 1, borderColor: colors.border,
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    opacity: suggestion.isPending || !item.serverId ? 0.5 : 1,
                  }}
                >
                  {suggestion.isPending ? (
                    <ActivityIndicator size="small" color={colors.brand} style={{ width: 12, height: 12 }} />
                  ) : (
                    <MaterialCommunityIcons name="auto-fix" size={12} color={colors.muted} />
                  )}
                  <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold }}>Suggest</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 2 }}>
                {isLow ? 'Restock soon' : `≈ ${daysLeft} days left`}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setShowRestock(true)}
              style={{
                paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
                backgroundColor: isLow ? colors.gold : `${colors.ink}10`,
                flexDirection: 'row', alignItems: 'center', gap: 5,
              }}>
              <MaterialCommunityIcons name="plus" size={14} color={isLow ? colors.ink : colors.muted} />
              <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: isLow ? colors.ink : colors.muted }}>Restock</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Price/cost/margin */}
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {[
            { label: 'Sell', value: `GH₵${item.sellPrice.toFixed(0)}`, color: colors.ink },
            { label: 'Cost', value: item.costPrice ? `GH₵${item.costPrice.toFixed(0)}` : '—', color: colors.ink },
            { label: 'Margin', value: margin != null ? `${margin}%` : '—', color: colors.brand },
          ].map((stat) => (
            <View key={stat.label} style={{
              flex: 1, padding: 10, backgroundColor: colors.surface,
              borderRadius: 12, borderWidth: 1, borderColor: colors.border,
            }}>
              <Text style={{ fontSize: 10, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>{stat.label}</Text>
              <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 16, marginTop: 2, color: stat.color }}>{stat.value}</Text>
            </View>
          ))}
        </View>

        {/* 14-day trend bar chart */}
        <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 4 }}>
          14-day trend
        </Text>
        <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>Units sold</Text>
            <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
              {itemSpark.reduce((a: number, b: number) => a + b, 0)}
              {trendPct !== null && (
                <Text style={{ color: trendPct >= 0 ? colors.brand : colors.danger, fontSize: 11.5 }}>
                  {' '}{trendPct >= 0 ? '+' : ''}{trendPct}%
                </Text>
              )}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 60 }}>
            {itemSpark.map((v: number, i: number) => (
              <View key={i} style={{
                flex: 1,
                height: Math.max(4, Math.round((v / maxV) * 56)),
                borderRadius: 3,
                backgroundColor: i === itemSpark.length - 1 ? colors.brand : `${colors.brand}30`,
              }} />
            ))}
          </View>
        </View>

        {/* Recent stock movement */}
        <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 4 }}>
          Recent stock movement
        </Text>
        <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
          {recentMovements.length === 0 ? (
            <View style={{ paddingHorizontal: 12, paddingVertical: 14 }}>
              <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center' }}>No recorded sales yet</Text>
            </View>
          ) : recentMovements.map((m, i) => (
            <View key={i} style={{
              flexDirection: 'row', alignItems: 'center', gap: 10,
              paddingHorizontal: 12, paddingVertical: 10,
              borderBottomWidth: i < recentMovements.length - 1 ? 1 : 0, borderBottomColor: colors.border,
            }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.color }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12.5, color: colors.muted }}>{m.t}</Text>
                <Text style={{ fontSize: 10.5, color: colors.muted }}>{m.d}</Text>
              </View>
              <Text style={{
                fontSize: 13, fontFamily: fonts.bodySemiBold,
                color: m.q.startsWith('+') ? colors.brand : m.q.startsWith('−') ? colors.danger : colors.muted,
              }}>{m.q}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {isLow ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 20, paddingTop: 10, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
          <TouchableOpacity
            onPress={() => setShowRestock(true)}
            style={{
              height: 52, borderRadius: 14, backgroundColor: colors.gold,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            <MaterialCommunityIcons name="plus" size={18} color={colors.ink} />
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink }}>
              Restock now
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <Modal visible={showRestock} transparent animationType="slide" onRequestClose={() => setShowRestock(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} activeOpacity={1} onPress={() => setShowRestock(false)} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 }}>
            <Text style={{ fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink, marginBottom: 4 }}>Restock · {item.name}</Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 12 }}>Current: {item.stockQty} units on hand</Text>
            <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 4 }}>UNITS TO ADD</Text>
            <TextInput
              value={restockQty}
              onChangeText={setRestockQty}
              keyboardType="numeric"
              placeholder="24"
              placeholderTextColor={colors.muted}
              autoFocus
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                paddingHorizontal: 12, paddingVertical: 10,
                fontSize: 18, color: colors.ink, backgroundColor: colors.bg, marginBottom: 14,
              }}
            />
            <TouchableOpacity
              disabled={adjustStock.isPending || !restockQty || Number(restockQty) <= 0}
              onPress={() => {
                adjustStock.mutate(
                  { item_id: item.id, qty_change: Number(restockQty), reason: 'purchase' },
                  {
                    onSuccess: () => { setShowRestock(false); setRestockQty(''); Alert.alert('Restocked', `Added ${restockQty} units to ${item.name}.`); },
                    onError: (e: Error) => Alert.alert('Error', e.message),
                  }
                );
              }}
              style={{
                height: 46, borderRadius: 12, backgroundColor: colors.brand,
                alignItems: 'center', justifyContent: 'center',
                opacity: (adjustStock.isPending || !restockQty || Number(restockQty) <= 0) ? 0.6 : 1,
              }}
            >
              {adjustStock.isPending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>Confirm Restock</Text>
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function perfRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(to.getDate() - 30);
  return { from_date: from.toISOString().slice(0, 10), to_date: to.toISOString().slice(0, 10) };
}

export default function InventoryScreen() {
  const { colors, fonts, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const { items, loading, reload } = useLocalItems();
  const createItem = useCreateItem();
  const suppliers = useSuppliers();
  const createSupplierMutation = useCreateSupplier();
  const updateSupplierMutation = useUpdateSupplier();
  const deleteSupplierMutation = useDeleteSupplier();

  const topItemsRange = perfRange();
  const topItems = useTopItems(section === 'performance' ? topItemsRange : null);

  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierDto | null>(null);
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supEmail, setSupEmail] = useState('');
  const [supAddress, setSupAddress] = useState('');

  function resetSupplierForm() {
    setSupName(''); setSupPhone(''); setSupEmail(''); setSupAddress('');
  }

  function openEditSupplier(s: SupplierDto) {
    setEditingSupplier(s);
    setSupName(s.name);
    setSupPhone(s.phone ?? '');
    setSupEmail(s.email ?? '');
    setSupAddress(s.address ?? '');
  }

  const purchaseOrders = usePurchaseOrders();
  const createPO = useCreatePurchaseOrder();
  const receivePO = useReceivePurchaseOrder();
  const [expandedPoId, setExpandedPoId] = useState<string | null>(null);

  // Create PO form state (full wiring in Task 7)
  const [showCreatePO, setShowCreatePO] = useState(false);
  const [poStep, setPoStep] = useState<1 | 2 | 3>(1);
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poLineItems, setPoLineItems] = useState<Array<{ item_id: string; name: string; qty: string; cost_price: string }>>([]);
  const [poDeliveryDate, setPoDeliveryDate] = useState('');
  const [poRef, setPoRef] = useState('');
  const [poTerms, setPoTerms] = useState('');
  const [poNotes, setPoNotes] = useState('');

  function resetPoForm() {
    setPoStep(1);
    setPoSupplierId('');
    setPoLineItems([]);
    setPoDeliveryDate('');
    setPoRef('');
    setPoTerms('');
    setPoNotes('');
    setPoItemQuery('');
  }

  const [poItemQuery, setPoItemQuery] = useState('');
  const inventoryItemsQuery = useInventoryItems({ search: poItemQuery || undefined, page_size: 20 });

  // Mark Received state (full wiring in Task 8)
  const [receivingPoId, setReceivingPoId] = useState<string | null>(null);
  const [receiveInvoiceRef, setReceiveInvoiceRef] = useState('');
  const [receiveVatAmount, setReceiveVatAmount] = useState('');
  const [receiveSubtotal, setReceiveSubtotal] = useState('');
  const [receiveSupplierName, setReceiveSupplierName] = useState('');

  function poStatusColor(status: string) {
    if (status === 'received') return colors.brand;
    if (status === 'submitted' || status === 'ordered') return '#3b82f6';
    if (status === 'partially_received') return '#b6831e';
    if (status === 'cancelled') return colors.danger;
    return colors.muted; // draft
  }

  function poStatusLabel(status: string) {
    const map: Record<string, string> = {
      draft: 'Draft',
      ordered: 'Ordered',
      submitted: 'Submitted',
      partially_received: 'Partially received',
      received: 'Received',
      cancelled: 'Cancelled',
    };
    return map[status] ?? status;
  }

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [section, setSection] = useState<'items' | 'suppliers' | 'orders' | 'performance'>('items');
  const [itemFilter, setItemFilter] = useState<'all' | 'low'>('all');
  const [query, setQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<LocalItem | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const scanLockedRef = useRef(false);
  const [itemName, setItemName] = useState('');
  const [itemUnit, setItemUnit] = useState('');
  const [itemSku, setItemSku] = useState('');
  const [itemBarcode, setItemBarcode] = useState('');
  const [itemSellPrice, setItemSellPrice] = useState('');
  const [itemCostPrice, setItemCostPrice] = useState('');
  const [itemStock, setItemStock] = useState('');

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const lowCount = items.filter((i) => i.stockQty <= i.lowStockThreshold).length;
  const addActionLabel = section === 'suppliers'
    ? 'Add supplier'
    : section === 'orders'
      ? 'Create PO'
      : section === 'performance'
        ? null   // no add action on performance tab
        : 'Add item';

  const filtered = items.filter((i) => {
    if (itemFilter === 'low' && i.stockQty > i.lowStockThreshold) return false;
    const normalizedQuery = query.trim().toLowerCase();
    if (normalizedQuery && !(
      i.name.toLowerCase().includes(normalizedQuery) ||
      i.sku?.toLowerCase().includes(normalizedQuery) ||
      i.barcode?.toLowerCase().includes(normalizedQuery)
    )) return false;
    return true;
  });

  function resetItemForm() {
    setItemName('');
    setItemUnit('');
    setItemSku('');
    setItemBarcode('');
    setItemSellPrice('');
    setItemCostPrice('');
    setItemStock('');
  }

  function closeBarcodeScanner(returnToForm = true) {
    scanLockedRef.current = true;
    setScanLocked(true);
    setShowBarcodeScanner(false);
    if (returnToForm) setShowAddItem(true);
  }

  async function openBarcodeScanner() {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Camera permission needed', 'Allow camera access to scan product barcodes.');
        return;
      }
    }
    Keyboard.dismiss();
    scanLockedRef.current = false;
    setScanLocked(false);
    setShowAddItem(false);
    setTimeout(() => setShowBarcodeScanner(true), Platform.OS === 'ios' ? 250 : 0);
  }

  function handleBarcodeScanned(result: BarcodeScanningResult) {
    if (scanLockedRef.current) return;
    scanLockedRef.current = true;
    setScanLocked(true);
    setItemBarcode(result.data.trim());
    setShowBarcodeScanner(false);
    setShowAddItem(true);
  }

  if (selectedItem) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <ItemDetail item={selectedItem} onBack={() => setSelectedItem(null)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {/* Header */}
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        flexDirection: 'row', alignItems: 'center', gap: 10,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Inventory</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>{items.length} items · {lowCount} low</Text>
        </View>
        <TouchableOpacity
          accessibilityLabel={addActionLabel}
          onPress={() => {
            if (section === 'suppliers') { resetSupplierForm(); setShowAddSupplier(true); }
            else if (section === 'orders') { resetPoForm(); setShowCreatePO(true); }
            else setShowAddItem(true);
          }}
          style={{
            minWidth: 38, height: 38, borderRadius: 12,
            paddingHorizontal: 12,
            backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center',
            flexDirection: 'row', gap: 6,
          }}>
          <MaterialCommunityIcons name="plus" size={18} color="#fdf7eb" />
          <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: '#fdf7eb' }}>
            {addActionLabel}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Section switch */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <View style={{
          flexDirection: 'row',
          padding: 3,
          borderRadius: 13,
          backgroundColor: `${colors.ink}08`,
          borderWidth: 1,
          borderColor: colors.border,
          gap: 3,
        }}>
          {[
            { id: 'items' as const, label: 'Items' },
            { id: 'performance' as const, label: 'Performance' },
            { id: 'suppliers' as const, label: 'Suppliers' },
            { id: 'orders' as const, label: 'Orders' },
          ].map((s) => {
            const sel = section === s.id;
            return (
              <TouchableOpacity
                key={s.id}
                onPress={() => setSection(s.id)}
                style={{
                  flex: 1,
                  minHeight: 34,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 6,
                  backgroundColor: sel ? colors.surface : 'transparent',
                }}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                  style={{
                    fontSize: 11.5,
                    fontFamily: fonts.bodySemiBold,
                    color: sel ? colors.ink : colors.muted,
                  }}
                >
                  {s.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {section === 'items' && (
        <>
          {/* Search */}
          <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              paddingHorizontal: 12, height: 40,
              backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
            }}>
              <MaterialCommunityIcons name="magnify" size={16} color={colors.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search items, SKU, barcode"
                placeholderTextColor={colors.muted}
                style={{ flex: 1, fontSize: 13.5, color: colors.ink, fontFamily: fonts.body }}
              />
            </View>
          </View>

          {/* Item filters */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 6 }}
            style={{ flexGrow: 0 }}
          >
            {[
              { id: 'all' as const, label: 'All', count: items.length, warn: false },
              { id: 'low' as const, label: 'Low stock', count: lowCount, warn: true },
            ].map((t) => {
              const sel = itemFilter === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setItemFilter(t.id)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 5,
                    paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999,
                    backgroundColor: sel ? colors.ink : colors.surface,
                    borderWidth: sel ? 0 : 1, borderColor: colors.border,
                  }}
                >
                  <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: sel ? '#fdf7eb' : colors.muted }}>
                    {t.label}
                  </Text>
                  {t.count != null ? (
                    <View style={{
                      paddingHorizontal: 5, borderRadius: 999,
                      backgroundColor: t.warn ? '#fff5cc' : sel ? 'rgba(255,255,255,0.15)' : `${colors.ink}10`,
                    }}>
                      <Text style={{ fontSize: 10.5, fontFamily: fonts.bodySemiBold, color: t.warn ? '#b6831e' : sel ? '#fdf7eb' : colors.muted }}>
                        {t.count}
                      </Text>
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}

      {/* Item list */}
      {section === 'items' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
          {loading ? (
            <Text style={{ color: colors.muted, marginTop: 16 }}>Loading inventory…</Text>
          ) : null}
          <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
            {filtered.length === 0 ? (
              <View style={{ padding: 16 }}>
                <Text style={{ color: colors.muted }}>No items found.</Text>
              </View>
            ) : filtered.map((item, i) => {
              const isLow = item.stockQty <= item.lowStockThreshold;
              const margin = item.costPrice && item.costPrice > 0
                ? Math.round(((item.sellPrice - item.costPrice) / item.sellPrice) * 100)
                : null;
              return (
                <TouchableOpacity key={item.id} onPress={() => setSelectedItem(item)} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  padding: 12,
                  borderBottomWidth: i < filtered.length - 1 ? 1 : 0,
                  borderBottomColor: colors.border,
                }}>
                  <View style={{
                    width: 40, height: 40, borderRadius: 10,
                    backgroundColor: isLow ? '#fff5cc' : `${colors.ink}08`,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: isLow ? '#b6831e' : colors.muted }}>
                      {initials(item.name)}
                    </Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>{item.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                      <Text style={{ fontSize: 11.5, color: colors.muted, fontFamily: fonts.mono }}>GH₵ {item.sellPrice.toFixed(2)}</Text>
                      {margin != null ? (
                        <Text style={{ fontSize: 11, color: colors.muted }}>· {margin}% margin</Text>
                      ) : null}
                    </View>
                    {(item.sku || item.barcode) ? (
                      <Text style={{ marginTop: 2, fontSize: 10.5, color: colors.muted }} numberOfLines={1}>
                        {[item.sku ? `SKU ${item.sku}` : null, item.barcode ? `Barcode ${item.barcode}` : null].filter(Boolean).join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: isLow ? '#b6831e' : colors.ink }}>
                      {item.stockQty}
                    </Text>
                    <Text style={{ fontSize: 10.5, color: isLow ? '#b6831e' : colors.muted, fontFamily: isLow ? fonts.bodySemiBold : fonts.body }}>
                      {isLow ? 'low' : 'in stock'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* ── PERFORMANCE TAB ── */}
      {section === 'performance' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}>
          <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>
            Top items · Last 30 days
          </Text>
          {topItems.isLoading && (
            <ActivityIndicator color={colors.brand} style={{ marginTop: 32 }} />
          )}
          {topItems.isError && (
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <MaterialCommunityIcons name="alert-circle-outline" size={28} color={colors.danger} />
              <Text style={{ fontSize: 13, color: colors.muted, marginTop: 8 }}>Could not load performance data.</Text>
              <TouchableOpacity onPress={() => void topItems.refetch()} style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
          {!topItems.isLoading && !topItems.isError && (
            <>
              {(topItems.data ?? []).length === 0 ? (
                <View style={{ alignItems: 'center', paddingTop: 48 }}>
                  <MaterialCommunityIcons name="chart-bar" size={36} color={colors.border} />
                  <Text style={{ fontSize: 14, color: colors.muted, marginTop: 10 }}>No sales data yet for this period.</Text>
                </View>
              ) : (
                (() => {
                  const rows = topItems.data ?? [];
                  const maxRev = Math.max(...rows.map((r: Record<string, unknown>) => Number(r.total_revenue ?? 0)), 1);
                  return (
                    <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}>
                      {rows.map((item: Record<string, unknown>, i: number) => {
                        const rev = Number(item.total_revenue ?? 0);
                        const qty = Number(item.total_qty ?? 0);
                        const barPct = rev / maxRev;
                        return (
                          <View key={String(item.id ?? i)} style={{
                            paddingHorizontal: 14, paddingVertical: 12,
                            borderBottomWidth: i < rows.length - 1 ? 1 : 0,
                            borderBottomColor: colors.border,
                            gap: 6,
                          }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: `${colors.brand}18`, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Text style={{ fontSize: 11, fontFamily: fonts.bodySemiBold, color: colors.brand }}>{i + 1}</Text>
                              </View>
                              <Text style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>
                                {String(item.name ?? item.description ?? 'Unknown item')}
                              </Text>
                              <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                                GH₵ {rev.toLocaleString('en-GH', { minimumFractionDigits: 0 })}
                              </Text>
                            </View>
                            {/* Revenue bar */}
                            <View style={{ height: 4, backgroundColor: `${colors.brand}18`, borderRadius: 2, overflow: 'hidden' }}>
                              <View style={{ width: `${barPct * 100}%`, height: '100%', backgroundColor: colors.brand, borderRadius: 2 }} />
                            </View>
                            <Text style={{ fontSize: 11, color: colors.muted }}>
                              {qty} unit{qty !== 1 ? 's' : ''} sold
                              {item.unit ? ` (${String(item.unit)})` : ''}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  );
                })()
              )}
              <TouchableOpacity
                onPress={() => {/* navigate to analytics */}}
                style={{ marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 }}
              >
                <MaterialCommunityIcons name="trending-up" size={14} color={colors.brand} />
                <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: colors.brand }}>Full analytics in Analytics tab</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      )}

      {/* ── SUPPLIERS TAB ── */}
      {section === 'suppliers' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}>
          {suppliers.isLoading && (
            <ActivityIndicator color={colors.brand} style={{ marginTop: 32 }} />
          )}
          {suppliers.isError && (
            <View style={{ alignItems: 'center', paddingTop: 48 }}>
              <MaterialCommunityIcons name="alert-circle-outline" size={36} color={colors.danger} />
              <Text style={{ fontSize: 14, color: colors.muted, marginTop: 10 }}>Could not load suppliers</Text>
              <TouchableOpacity onPress={() => void suppliers.refetch()} style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
          {!suppliers.isLoading && (suppliers.data ?? []).length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 48 }}>
              <MaterialCommunityIcons name="truck-outline" size={36} color={colors.border} />
              <Text style={{ fontSize: 14, color: colors.muted, marginTop: 10 }}>No suppliers yet</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Tap + to add your first supplier</Text>
            </View>
          )}
          {(suppliers.data ?? []).length > 0 && (
            <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
              {(suppliers.data ?? []).map((s, i) => (
                <View
                  key={String(s.id)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', padding: 13, gap: 11,
                    borderBottomWidth: i < (suppliers.data ?? []).length - 1 ? 1 : 0,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: `${colors.brand}15`, alignItems: 'center', justifyContent: 'center' }}>
                    <MaterialCommunityIcons name="truck-outline" size={17} color={colors.brand} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>{s.name}</Text>
                    {(s.phone || s.email) ? (
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }} numberOfLines={1}>
                        {[s.phone, s.email].filter(Boolean).join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  <TouchableOpacity onPress={() => openEditSupplier(s)} hitSlop={8}>
                    <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.muted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── ORDERS TAB ── */}
      {section === 'orders' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}>
          {purchaseOrders.isLoading && (
            <ActivityIndicator color={colors.brand} style={{ marginTop: 32 }} />
          )}
          {purchaseOrders.isError && (
            <View style={{ alignItems: 'center', paddingTop: 48 }}>
              <MaterialCommunityIcons name="alert-circle-outline" size={36} color={colors.danger} />
              <Text style={{ fontSize: 14, color: colors.muted, marginTop: 10 }}>Could not load orders</Text>
              <TouchableOpacity onPress={() => void purchaseOrders.refetch()} style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
          {!purchaseOrders.isLoading && !purchaseOrders.isError && (purchaseOrders.data ?? []).length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 48 }}>
              <MaterialCommunityIcons name="clipboard-list-outline" size={36} color={colors.border} />
              <Text style={{ fontSize: 14, color: colors.muted, marginTop: 10 }}>No purchase orders yet</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Tap + to create your first PO</Text>
            </View>
          )}
          {(purchaseOrders.data ?? []).map((po: PurchaseOrderDto) => {
            const isExpanded = expandedPoId === String(po.id);
            const lineCount = po.line_items?.length ?? 0;
            const supplierName = po.supplier_name
              ?? (suppliers.data ?? []).find((s) => String(s.id) === String(po.supplier_id))?.name
              ?? 'Unknown supplier';
            const canReceive = po.status === 'draft' || po.status === 'ordered' || po.status === 'submitted' || po.status === 'partially_received';
            return (
              <View key={String(po.id)} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, marginBottom: 10, overflow: 'hidden' }}>
                {/* PO header row */}
                <TouchableOpacity
                  onPress={() => setExpandedPoId(isExpanded ? null : String(po.id))}
                  style={{ padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>{supplierName}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: poStatusColor(po.status) }} />
                      <Text style={{ fontSize: 11, color: colors.muted }}>{poStatusLabel(po.status)}</Text>
                      <Text style={{ fontSize: 11, color: colors.muted }}>·</Text>
                      <Text style={{ fontSize: 11, color: colors.muted }}>{lineCount} item{lineCount !== 1 ? 's' : ''}</Text>
                      {po.expected_delivery_date ? (
                        <>
                          <Text style={{ fontSize: 11, color: colors.muted }}>·</Text>
                          <Text style={{ fontSize: 11, color: colors.muted }}>Due {po.expected_delivery_date}</Text>
                        </>
                      ) : null}
                    </View>
                  </View>
                  <MaterialCommunityIcons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
                </TouchableOpacity>

                {/* Expanded line items */}
                {isExpanded && (
                  <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 13, paddingBottom: 12, paddingTop: 8 }}>
                    {(po.line_items ?? []).map((li, i) => (
                      <View key={`${String(po.id)}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: i < (po.line_items ?? []).length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
                        <Text style={{ fontSize: 12.5, color: colors.ink, flex: 1 }} numberOfLines={1}>{li.name ?? String(li.item_id)}</Text>
                        <Text style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.mono }}>×{li.qty} @ GH₵{Number(li.cost_price).toFixed(2)}</Text>
                      </View>
                    ))}
                    {po.reference_number ? (
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>Ref: {po.reference_number}</Text>
                    ) : null}
                    {canReceive && (
                      <TouchableOpacity
                        onPress={() => {
                          const lineItems = po.line_items ?? [];
                          const subtotal = lineItems.reduce((sum, li) => sum + li.qty * Number(li.cost_price), 0);
                          const vat = subtotal * 0.15;
                          const sName = po.supplier_name
                            ?? (suppliers.data ?? []).find((s) => String(s.id) === String(po.supplier_id))?.name
                            ?? '';
                          setReceivingPoId(String(po.id));
                          setReceiveInvoiceRef(po.reference_number ?? '');
                          setReceiveSubtotal(subtotal.toFixed(2));
                          setReceiveVatAmount(vat.toFixed(2));
                          setReceiveSupplierName(sName);
                        }}
                        style={{ marginTop: 10, height: 38, borderRadius: 10, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}
                      >
                        <MaterialCommunityIcons name="package-variant-closed-check" size={15} color="#fff" />
                        <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: '#fff' }}>Mark received</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      <Modal visible={showAddItem} transparent animationType="slide" onRequestClose={() => setShowAddItem(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          style={{ flex: 1 }}
        >
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} activeOpacity={1} onPress={() => setShowAddItem(false)} />
          <ScrollView
            style={{
              maxHeight: '88%',
              backgroundColor: colors.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
            }}
            contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            <Text style={{ fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink, marginBottom: 14 }}>Add Item</Text>

            {[
              { label: 'ITEM NAME', value: itemName, onChange: setItemName, placeholder: 'Indomie Chicken 70g', keyboard: 'default' as const },
              { label: 'UNIT (e.g. piece, kg, bottle)', value: itemUnit, onChange: setItemUnit, placeholder: 'piece', keyboard: 'default' as const },
              { label: 'SKU (OPTIONAL)', value: itemSku, onChange: setItemSku, placeholder: 'SKU-001', keyboard: 'default' as const },
              { label: 'SELL PRICE (GH₵)', value: itemSellPrice, onChange: setItemSellPrice, placeholder: '3.50', keyboard: 'numeric' as const },
              { label: 'COST PRICE (GH₵, OPTIONAL)', value: itemCostPrice, onChange: setItemCostPrice, placeholder: '2.00', keyboard: 'numeric' as const },
              { label: 'OPENING STOCK', value: itemStock, onChange: setItemStock, placeholder: '50', keyboard: 'numeric' as const },
            ].map((field) => (
              <View key={field.label} style={{ marginBottom: 10 }}>
                <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 4 }}>{field.label}</Text>
                <TextInput
                  value={field.value}
                  onChangeText={field.onChange}
                  keyboardType={field.keyboard}
                  placeholder={field.placeholder}
                  placeholderTextColor={colors.muted}
                  style={{
                    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                    paddingHorizontal: 12, paddingVertical: 10,
                    fontSize: 14, color: colors.ink, backgroundColor: colors.bg,
                  }}
                />
              </View>
            ))}

            <View style={{ marginBottom: 10 }}>
              <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 4 }}>BARCODE (OPTIONAL)</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  value={itemBarcode}
                  onChangeText={setItemBarcode}
                  keyboardType="default"
                  placeholder="Scan or type barcode"
                  placeholderTextColor={colors.muted}
                  style={{
                    flex: 1,
                    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                    paddingHorizontal: 12, paddingVertical: 10,
                    fontSize: 14, color: colors.ink, backgroundColor: colors.bg,
                  }}
                />
                <TouchableOpacity
                  onPress={() => void openBarcodeScanner()}
                  style={{
                    width: 48,
                    borderRadius: 10,
                    backgroundColor: colors.ink,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <MaterialCommunityIcons name="barcode-scan" size={20} color="#fdf7eb" />
                </TouchableOpacity>
              </View>
            </View>

            <TouchableOpacity
              disabled={createItem.isPending || !itemName || !itemUnit || !itemSellPrice}
              onPress={() => {
                createItem.mutate(
                  {
                    name: itemName,
                    unit: itemUnit || 'piece',
                    sku: itemSku || undefined,
                    barcode: itemBarcode || undefined,
                    sell_price: Number(itemSellPrice),
                    cost_price: itemCostPrice ? Number(itemCostPrice) : undefined,
                    initial_stock: itemStock ? Number(itemStock) : 0,
                  } as never,
                  {
                    onSuccess: () => {
                      setShowAddItem(false);
                      resetItemForm();
                      void reload();
                      Alert.alert('Added', `${itemName} added to inventory.`);
                    },
                    onError: (e: Error) => Alert.alert('Error', e.message),
                  }
                );
              }}
              style={{
                marginTop: 4, height: 46, borderRadius: 12, backgroundColor: colors.ink,
                alignItems: 'center', justifyContent: 'center',
                opacity: (createItem.isPending || !itemName || !itemSellPrice) ? 0.4 : 1,
              }}
            >
              {createItem.isPending
                ? <ActivityIndicator size="small" color="#fdf7eb" />
                : <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fdf7eb' }}>Add to inventory</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <StatusBar hidden={showBarcodeScanner} />
      <Modal visible={showBarcodeScanner} animationType="slide" onRequestClose={() => closeBarcodeScanner(true)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.ink }} edges={['top', 'bottom']}>
          <View style={{
            paddingHorizontal: 16,
            paddingTop: Math.max(insets.top, 16) + 8,
            paddingBottom: 12,
            flexDirection: 'row',
            alignItems: 'center',
            zIndex: 2,
          }}>
            <TouchableOpacity hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }} onPress={() => closeBarcodeScanner(true)} style={{
              width: 40, height: 40, borderRadius: 12,
              backgroundColor: 'rgba(255,255,255,0.12)',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <MaterialCommunityIcons name="close" size={20} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: '#fff', fontSize: 16, fontFamily: fonts.bodySemiBold }}>Attach barcode</Text>
              <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12 }}>Point the camera at the product barcode.</Text>
            </View>
          </View>
          {showBarcodeScanner && (
            <CameraView
              active={showBarcodeScanner}
              barcodeScannerSettings={{
                barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'],
              }}
              facing="back"
              onBarcodeScanned={scanLocked ? undefined : handleBarcodeScanned}
              style={{ flex: 1 }}
            />
          )}
          <View style={{ padding: 16, backgroundColor: colors.ink }}>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, textAlign: 'center' }}>
              The scanned barcode will be saved to this item for fast lookup at checkout.
            </Text>
            <TouchableOpacity onPress={() => closeBarcodeScanner(true)} style={{
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
      {/* ── Add / Edit Supplier modal ── */}
      <Modal
        visible={showAddSupplier || !!editingSupplier}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowAddSupplier(false); setEditingSupplier(null); }}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
            activeOpacity={1}
            onPress={() => { setShowAddSupplier(false); setEditingSupplier(null); }}
          />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
            <ScrollView bounces={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                <Text style={{ flex: 1, fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink }}>
                  {editingSupplier ? 'Edit Supplier' : 'Add Supplier'}
                </Text>
                {editingSupplier && (
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert('Delete supplier?', `Remove ${editingSupplier.name}? This cannot be undone.`, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete', style: 'destructive',
                          onPress: () => deleteSupplierMutation.mutate(String(editingSupplier.id), {
                            onSuccess: () => { setEditingSupplier(null); Alert.alert('Deleted', `${editingSupplier.name} removed.`); },
                            onError: (e: Error) => Alert.alert('Cannot delete', e.message),
                          }),
                        },
                      ]);
                    }}
                  >
                    <MaterialCommunityIcons name="trash-can-outline" size={19} color={colors.danger} />
                  </TouchableOpacity>
                )}
              </View>
              {([
                { label: 'NAME', value: supName, set: setSupName, placeholder: 'Kofi Trading Co', keyboard: 'default' as const },
                { label: 'PHONE (OPTIONAL)', value: supPhone, set: setSupPhone, placeholder: '0244000000', keyboard: 'phone-pad' as const },
                { label: 'EMAIL (OPTIONAL)', value: supEmail, set: setSupEmail, placeholder: 'supplier@example.com', keyboard: 'email-address' as const },
                { label: 'ADDRESS (OPTIONAL)', value: supAddress, set: setSupAddress, placeholder: 'Accra, Ghana', keyboard: 'default' as const },
              ] as const).map((f) => (
                <View key={f.label} style={{ marginBottom: 10 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 4 }}>{f.label}</Text>
                  <TextInput
                    value={f.value}
                    onChangeText={f.set}
                    placeholder={f.placeholder}
                    placeholderTextColor={colors.muted}
                    keyboardType={f.keyboard}
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.ink, backgroundColor: colors.bg }}
                  />
                </View>
              ))}
            </ScrollView>
            <View style={{ paddingHorizontal: 20, paddingBottom: 34, paddingTop: 4 }}>
              <TouchableOpacity
                disabled={(createSupplierMutation.isPending || updateSupplierMutation.isPending || deleteSupplierMutation.isPending) || !supName.trim()}
                onPress={() => {
                  const body: CreateSupplierDto = {
                    name: supName.trim(),
                    ...(supPhone.trim() ? { phone: supPhone.trim() } : {}),
                    ...(supEmail.trim() ? { email: supEmail.trim() } : {}),
                    ...(supAddress.trim() ? { address: supAddress.trim() } : {}),
                  };
                  if (editingSupplier) {
                    updateSupplierMutation.mutate({ id: String(editingSupplier.id), body }, {
                      onSuccess: () => { setEditingSupplier(null); resetSupplierForm(); },
                      onError: (e: Error) => Alert.alert('Error', e.message),
                    });
                  } else {
                    createSupplierMutation.mutate(body, {
                      onSuccess: () => { setShowAddSupplier(false); resetSupplierForm(); },
                      onError: (e: Error) => Alert.alert('Error', e.message),
                    });
                  }
                }}
                style={{
                  height: 46, borderRadius: 12, backgroundColor: colors.brand,
                  alignItems: 'center', justifyContent: 'center',
                  opacity: (createSupplierMutation.isPending || updateSupplierMutation.isPending || !supName.trim()) ? 0.6 : 1,
                }}
              >
                {(createSupplierMutation.isPending || updateSupplierMutation.isPending) ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>
                    {editingSupplier ? 'Save changes' : 'Add Supplier'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* ── Create PO modal (3-step) ── */}
      <Modal
        visible={showCreatePO}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowCreatePO(false); resetPoForm(); }}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
            activeOpacity={1}
            onPress={() => { setShowCreatePO(false); resetPoForm(); }}
          />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%' }}>
            {/* Step indicator */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10, gap: 8 }}>
              {([1, 2, 3] as const).map((s) => (
                <View key={s} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: poStep >= s ? colors.brand : colors.border }} />
              ))}
            </View>
            <Text style={{ paddingHorizontal: 20, fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink, marginBottom: 12 }}>
              {poStep === 1 ? 'Step 1: Select supplier' : poStep === 2 ? 'Step 2: Add items' : 'Step 3: Details'}
            </Text>

            <ScrollView bounces={false} keyboardShouldPersistTaps="handled" style={{ paddingHorizontal: 20 }} contentContainerStyle={{ paddingBottom: 8 }}>

              {/* STEP 1: Supplier picker */}
              {poStep === 1 && (
                <>
                  {(suppliers.data ?? []).length === 0 ? (
                    <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                      <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center' }}>No suppliers yet. Add a supplier first from the Suppliers tab.</Text>
                    </View>
                  ) : (suppliers.data ?? []).map((s) => (
                    <TouchableOpacity
                      key={String(s.id)}
                      onPress={() => setPoSupplierId(String(s.id))}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        padding: 12, borderRadius: 12, borderWidth: 1,
                        borderColor: poSupplierId === String(s.id) ? colors.brand : colors.border,
                        backgroundColor: poSupplierId === String(s.id) ? `${colors.brand}08` : colors.bg,
                        marginBottom: 8,
                      }}
                    >
                      <MaterialCommunityIcons name="truck-outline" size={18} color={poSupplierId === String(s.id) ? colors.brand : colors.muted} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{s.name}</Text>
                        {s.phone ? <Text style={{ fontSize: 11, color: colors.muted }}>{s.phone}</Text> : null}
                      </View>
                      {poSupplierId === String(s.id) && (
                        <MaterialCommunityIcons name="check-circle" size={18} color={colors.brand} />
                      )}
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {/* STEP 2: Line items */}
              {poStep === 2 && (
                <>
                  {/* Item search */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 40, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginBottom: 10 }}>
                    <MaterialCommunityIcons name="magnify" size={16} color={colors.muted} />
                    <TextInput
                      value={poItemQuery}
                      onChangeText={setPoItemQuery}
                      placeholder="Search items to add"
                      placeholderTextColor={colors.muted}
                      style={{ flex: 1, fontSize: 13.5, color: colors.ink }}
                    />
                  </View>
                  {/* Search results */}
                  {(inventoryItemsQuery.data?.items ?? []).map((item) => {
                    const alreadyAdded = poLineItems.some((l) => l.item_id === String(item.id));
                    return (
                      <TouchableOpacity
                        key={String(item.id)}
                        onPress={() => {
                          if (!alreadyAdded) {
                            setPoLineItems((prev) => [...prev, {
                              item_id: String(item.id),
                              name: item.name,
                              qty: '1',
                              cost_price: String(item.cost_price ?? '0'),
                            }]);
                          }
                        }}
                        style={{
                          flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1,
                          borderColor: alreadyAdded ? colors.brand : colors.border,
                          backgroundColor: alreadyAdded ? `${colors.brand}08` : colors.bg,
                          marginBottom: 6,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{item.name}</Text>
                          <Text style={{ fontSize: 11, color: colors.muted }}>Cost GH₵{Number(item.cost_price ?? 0).toFixed(2)}</Text>
                        </View>
                        {alreadyAdded
                          ? <MaterialCommunityIcons name="check" size={16} color={colors.brand} />
                          : <MaterialCommunityIcons name="plus" size={16} color={colors.muted} />}
                      </TouchableOpacity>
                    );
                  })}
                  {/* Selected line items editable list */}
                  {poLineItems.length > 0 && (
                    <View style={{ marginTop: 12 }}>
                      <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>Selected items</Text>
                      {poLineItems.map((li, i) => (
                        <View key={li.item_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <Text style={{ flex: 1, fontSize: 13, color: colors.ink }} numberOfLines={1}>{li.name}</Text>
                          <TextInput
                            value={li.qty}
                            onChangeText={(v) => setPoLineItems((prev) => prev.map((x, j) => j === i ? { ...x, qty: v } : x))}
                            keyboardType="numeric"
                            placeholder="Qty"
                            placeholderTextColor={colors.muted}
                            style={{ width: 52, textAlign: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 6, fontSize: 13, color: colors.ink }}
                          />
                          <TextInput
                            value={li.cost_price}
                            onChangeText={(v) => setPoLineItems((prev) => prev.map((x, j) => j === i ? { ...x, cost_price: v } : x))}
                            keyboardType="decimal-pad"
                            placeholder="Cost"
                            placeholderTextColor={colors.muted}
                            style={{ width: 70, textAlign: 'right', borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 6, fontSize: 13, color: colors.ink }}
                          />
                          <TouchableOpacity onPress={() => setPoLineItems((prev) => prev.filter((_, j) => j !== i))} hitSlop={8}>
                            <MaterialCommunityIcons name="close" size={16} color={colors.muted} />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                </>
              )}

              {/* STEP 3: Details */}
              {poStep === 3 && (
                <>
                  {([
                    { label: 'EXPECTED DELIVERY DATE', value: poDeliveryDate, set: setPoDeliveryDate, placeholder: 'YYYY-MM-DD', keyboard: 'default' as const },
                    { label: 'REFERENCE NUMBER (OPTIONAL)', value: poRef, set: setPoRef, placeholder: 'PO-2026-001', keyboard: 'default' as const },
                    { label: 'PAYMENT TERMS (OPTIONAL)', value: poTerms, set: setPoTerms, placeholder: 'Net 30', keyboard: 'default' as const },
                    { label: 'NOTES (OPTIONAL)', value: poNotes, set: setPoNotes, placeholder: 'Internal notes…', keyboard: 'default' as const },
                  ] as const).map((f) => (
                    <View key={f.label} style={{ marginBottom: 10 }}>
                      <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 4 }}>{f.label}</Text>
                      <TextInput
                        value={f.value}
                        onChangeText={f.set}
                        placeholder={f.placeholder}
                        placeholderTextColor={colors.muted}
                        keyboardType={f.keyboard}
                        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.ink, backgroundColor: colors.bg }}
                      />
                    </View>
                  ))}
                </>
              )}

            </ScrollView>

            {/* Navigation buttons */}
            <View style={{ paddingHorizontal: 20, paddingBottom: 34, paddingTop: 8, flexDirection: 'row', gap: 10 }}>
              {poStep > 1 && (
                <TouchableOpacity
                  onPress={() => setPoStep((s) => (s - 1) as 1 | 2 | 3)}
                  style={{ flex: 1, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Back</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                disabled={
                  (poStep === 1 && !poSupplierId) ||
                  (poStep === 2 && poLineItems.length === 0) ||
                  (poStep === 3 && !poDeliveryDate.trim()) ||
                  createPO.isPending
                }
                onPress={() => {
                  if (poStep < 3) {
                    setPoStep((s) => (s + 1) as 2 | 3);
                    return;
                  }
                  // Submit on step 3
                  const validItems = poLineItems.filter((l) => Number(l.qty) > 0 && Number(l.cost_price) >= 0);
                  createPO.mutate({
                    supplier_id: poSupplierId,
                    expected_delivery_date: poDeliveryDate.trim(),
                    line_items: validItems.map((l) => ({ item_id: l.item_id, qty: Number(l.qty), cost_price: Number(l.cost_price) })),
                    ...(poRef.trim() ? { reference_number: poRef.trim() } : {}),
                    ...(poTerms.trim() ? { payment_terms: poTerms.trim() } : {}),
                    ...(poNotes.trim() ? { notes: poNotes.trim() } : {}),
                  }, {
                    onSuccess: () => { setShowCreatePO(false); resetPoForm(); Alert.alert('PO created', 'Purchase order created successfully.'); },
                    onError: (e: Error) => Alert.alert('Error', e.message),
                  });
                }}
                style={{
                  flex: 2, height: 46, borderRadius: 12, backgroundColor: colors.brand,
                  alignItems: 'center', justifyContent: 'center',
                  opacity: (
                    (poStep === 1 && !poSupplierId) ||
                    (poStep === 2 && poLineItems.length === 0) ||
                    (poStep === 3 && !poDeliveryDate.trim()) ||
                    createPO.isPending
                  ) ? 0.5 : 1,
                }}
              >
                {createPO.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>
                    {poStep < 3 ? 'Next' : 'Create PO'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* ── Mark Received modal ── */}
      <Modal
        visible={!!receivingPoId}
        transparent
        animationType="slide"
        onRequestClose={() => setReceivingPoId(null)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
            activeOpacity={1}
            onPress={() => setReceivingPoId(null)}
          />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 }}>
            <Text style={{ fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink, marginBottom: 4 }}>Mark received</Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 16 }}>
              This will update stock for all PO line items. Input VAT is optional and will be saved to Tax if entered.
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 16 }}>
              {receiveSupplierName || 'Supplier'} · Subtotal GH₵{receiveSubtotal}
            </Text>

            <View style={{ marginBottom: 10 }}>
              <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 4 }}>SUPPLIER INVOICE REF (OPTIONAL)</Text>
              <TextInput
                value={receiveInvoiceRef}
                onChangeText={setReceiveInvoiceRef}
                placeholder="INV-001"
                placeholderTextColor={colors.muted}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.ink, backgroundColor: colors.bg }}
              />
            </View>

            <View style={{ marginBottom: 20 }}>
              <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 4 }}>INPUT VAT AMOUNT (GH₵)</Text>
              <TextInput
                value={receiveVatAmount}
                onChangeText={setReceiveVatAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.muted}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.ink, backgroundColor: colors.bg }}
              />
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>Pre-filled at 15% of subtotal. Set to 0 if this supplier invoice has no VAT.</Text>
            </View>

            <TouchableOpacity
              disabled={receivePO.isPending}
              onPress={async () => {
                if (!receivingPoId) return;
                try {
                  await receivePO.mutateAsync(receivingPoId);
                  const vatAmt = parseFloat(receiveVatAmount) || 0;
                  const subtotalAmt = parseFloat(receiveSubtotal) || 0;
                  if (vatAmt > 0) {
                    try {
                      await recordInputVAT({
                        supplier_name: receiveSupplierName || 'Unknown supplier',
                        invoice_ref: receiveInvoiceRef || undefined,
                        purchase_date: new Date().toISOString().slice(0, 10),
                        subtotal: subtotalAmt,
                        vat_amount: vatAmt,
                      });
                      setReceivingPoId(null);
                      Alert.alert('Received', 'Stock updated and input VAT recorded.');
                    } catch {
                      setReceivingPoId(null);
                      Alert.alert(
                        'Partially received',
                        'Stock was updated, but input VAT recording failed. Add it manually on the Tax screen.'
                      );
                    }
                  } else {
                    setReceivingPoId(null);
                    Alert.alert('Received', 'Stock levels have been updated.');
                  }
                } catch (e) {
                  Alert.alert('Error', (e as Error).message ?? 'Could not mark as received.');
                }
              }}
              style={{
                height: 46, borderRadius: 12, backgroundColor: colors.brand,
                alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6,
                opacity: receivePO.isPending ? 0.6 : 1,
              }}
            >
              {receivePO.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialCommunityIcons name="package-variant-closed-check" size={16} color="#fff" />
                  <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>Confirm received</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
