# Inventory Suppliers & Purchase Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Suppliers and Purchase Orders tabs to the inventory screen, closing the procure-to-stock loop including automatic input VAT recording on receive.

**Architecture:** Two new tabs (`suppliers`, `orders`) are added to the existing `inventory.tsx` tab bar (currently `all | low | cat`). All supplier/PO state is server-side only (no WatermelonDB — matches the payroll/tax pattern). The 3-step Create PO modal and the Mark Received modal are implemented as bottom-sheet Modals inside `inventory.tsx`. Receiving a PO calls two API endpoints in sequence: `/purchase-orders/{id}/receive` then `/tax/input-vat`.

**Tech Stack:** React Native + Expo, TypeScript, React Query (TanStack), Axios (`apiClient`), `@/components/ui/Text`, `useTheme()`, `MaterialCommunityIcons`

---

## File Map

| File | Change |
|---|---|
| `src/types/inventory.ts` | Add 5 new interfaces: `SupplierDto`, `CreateSupplierDto`, `POLineItemDto`, `PurchaseOrderDto`, `CreatePurchaseOrderDto` |
| `src/api/inventory.api.ts` | Add 7 functions: `listSuppliers`, `createSupplier`, `updateSupplier`, `deleteSupplier`, `listPurchaseOrders`, `createPurchaseOrder`, `receivePurchaseOrder` |
| `src/api/hooks/featureHooks.ts` | Add 7 hooks: `useSuppliers`, `useCreateSupplier`, `useUpdateSupplier`, `useDeleteSupplier`, `usePurchaseOrders`, `useCreatePurchaseOrder`, `useReceivePurchaseOrder` |
| `__tests__/api/featureHooksRoutes.test.tsx` | Add 4 route-contract tests for the new mutation hooks |
| `app/owner/inventory.tsx` | Extend tab type; add Suppliers tab view, Orders tab view, Create PO 3-step modal, Mark Received modal |

---

## Task 1: Types

**Files:**
- Modify: `src/types/inventory.ts`

- [ ] **Step 1: Add types to inventory.ts**

Append after the existing `BatchLookupResponseDto` interface (end of file):

```typescript
export interface SupplierDto {
  id: UUID;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  created_at?: ISODateTime;
}

export interface CreateSupplierDto {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface POLineItemDto {
  item_id: UUID;
  name?: string;
  qty: number;
  cost_price: number;
}

export interface PurchaseOrderDto {
  id: UUID;
  supplier_id: UUID;
  supplier_name?: string;
  status: 'draft' | 'submitted' | 'received' | 'cancelled';
  expected_delivery_date?: string;
  reference_number?: string | null;
  payment_terms?: string | null;
  notes?: string | null;
  line_items?: POLineItemDto[];
  created_at?: ISODateTime;
  received_at?: ISODateTime | null;
}

export interface CreatePurchaseOrderDto {
  supplier_id: string;
  expected_delivery_date: string;
  line_items: Array<{ item_id: string; qty: number; cost_price: number }>;
  reference_number?: string;
  payment_terms?: string;
  notes?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/inventory.ts
git commit -m "feat(types): add Supplier and PurchaseOrder types to inventory"
```

---

## Task 2: API Functions

**Files:**
- Modify: `src/api/inventory.api.ts`

- [ ] **Step 1: Add supplier and PO types to the import block**

At the top of `inventory.api.ts`, add these to the existing `import type { ... } from '@/types/inventory'` block:

```typescript
import type {
  // ... existing imports ...
  CreatePurchaseOrderDto,
  CreateSupplierDto,
  PurchaseOrderDto,
  SupplierDto,
} from '@/types/inventory';
```

- [ ] **Step 2: Add supplier API functions**

Append after `createCategory` (end of file):

```typescript
export async function listSuppliers(): Promise<SupplierDto[]> {
  const response = await apiClient.get<SupplierDto[]>('/api/v1/inventory/suppliers');
  return response.data;
}

export async function createSupplier(body: CreateSupplierDto): Promise<SupplierDto> {
  const response = await apiClient.post<SupplierDto>('/api/v1/inventory/suppliers', body);
  return response.data;
}

export async function updateSupplier(
  supplierId: string,
  body: Partial<CreateSupplierDto>
): Promise<SupplierDto> {
  const response = await apiClient.patch<SupplierDto>(
    `/api/v1/inventory/suppliers/${supplierId}`,
    body
  );
  return response.data;
}

export async function deleteSupplier(supplierId: string): Promise<void> {
  await apiClient.delete(`/api/v1/inventory/suppliers/${supplierId}`);
}
```

- [ ] **Step 3: Add purchase order API functions**

Append after `deleteSupplier`:

```typescript
export async function listPurchaseOrders(): Promise<PurchaseOrderDto[]> {
  const response = await apiClient.get<PurchaseOrderDto[]>('/api/v1/inventory/purchase-orders');
  return response.data;
}

export async function createPurchaseOrder(
  body: CreatePurchaseOrderDto
): Promise<PurchaseOrderDto> {
  const response = await apiClient.post<PurchaseOrderDto>(
    '/api/v1/inventory/purchase-orders',
    body
  );
  return response.data;
}

export async function receivePurchaseOrder(poId: string): Promise<PurchaseOrderDto> {
  const response = await apiClient.post<PurchaseOrderDto>(
    `/api/v1/inventory/purchase-orders/${poId}/receive`,
    {}
  );
  return response.data;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/api/inventory.api.ts
git commit -m "feat(api): add supplier and purchase order API functions"
```

---

## Task 3: React Query Hooks

**Files:**
- Modify: `src/api/hooks/featureHooks.ts`

- [ ] **Step 1: Add supplier and PO imports to featureHooks.ts**

Find the existing inventory import line (it imports from `@/api/inventory.api`). Add the new functions:

```typescript
import {
  // existing imports...
  createSupplier,
  createPurchaseOrder,
  deleteSupplier,
  listPurchaseOrders,
  listSuppliers,
  receivePurchaseOrder,
  updateSupplier,
} from '@/api/inventory.api';
```

Also import the new types in the types import block:

```typescript
import type {
  // existing types...
  CreatePurchaseOrderDto,
  CreateSupplierDto,
  PurchaseOrderDto,
  SupplierDto,
} from '@/types/inventory';
```

- [ ] **Step 2: Add supplier hooks**

Add after `useInventoryCategories` (around line 820 in featureHooks.ts):

```typescript
// ── Suppliers ─────────────────────────────────────────────────────────────────

export function useSuppliers() {
  return useQuery({
    queryKey: ['suppliers'],
    queryFn: listSuppliers,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSupplierDto) => createSupplier(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<CreateSupplierDto> }) =>
      updateSupplier(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSupplier(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}
```

- [ ] **Step 3: Add purchase order hooks**

Add after the supplier hooks:

```typescript
// ── Purchase Orders ───────────────────────────────────────────────────────────

export function usePurchaseOrders() {
  return useQuery({
    queryKey: ['purchase-orders'],
    queryFn: listPurchaseOrders,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePurchaseOrderDto) => createPurchaseOrder(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-orders'] }),
  });
}

export function useReceivePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (poId: string) => receivePurchaseOrder(poId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['inventory-items'] });
    },
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/api/hooks/featureHooks.ts
git commit -m "feat(hooks): add supplier and purchase order React Query hooks"
```

---

## Task 4: Route Contract Tests

**Files:**
- Modify: `__tests__/api/featureHooksRoutes.test.tsx`

- [ ] **Step 1: Add imports for new hooks**

In the import block at the top of `featureHooksRoutes.test.tsx`, add:

```typescript
import {
  // existing imports ...
  useCreateSupplier,
  useUpdateSupplier,
  useDeleteSupplier,
  useCreatePurchaseOrder,
} from '@/api/hooks/featureHooks';
```

- [ ] **Step 2: Add supplier mutation tests**

Add inside `describe('feature hook route contracts', () => { ... })` alongside existing tests:

```typescript
it('creates a supplier through the versioned inventory route', async () => {
  mock.onPost('/api/v1/inventory/suppliers', {
    name: 'Kofi Trading Co',
    phone: '0244000001',
  }).reply(201, {
    id: 'sup-1',
    name: 'Kofi Trading Co',
    phone: '0244000001',
    email: null,
    address: null,
  });

  const { result, unmount } = renderHook(() => useCreateSupplier(), { wrapper: createWrapper() });

  await expect(
    act(() => result.current.mutateAsync({ name: 'Kofi Trading Co', phone: '0244000001' }))
  ).resolves.toMatchObject({ id: 'sup-1', name: 'Kofi Trading Co' });
  unmount();
});

it('updates a supplier through the versioned inventory PATCH route', async () => {
  mock.onPatch('/api/v1/inventory/suppliers/sup-1', { phone: '0244000002' }).reply(200, {
    id: 'sup-1',
    name: 'Kofi Trading Co',
    phone: '0244000002',
    email: null,
    address: null,
  });

  const { result, unmount } = renderHook(() => useUpdateSupplier(), { wrapper: createWrapper() });

  await expect(
    act(() => result.current.mutateAsync({ id: 'sup-1', body: { phone: '0244000002' } }))
  ).resolves.toMatchObject({ phone: '0244000002' });
  unmount();
});

it('deletes a supplier through the versioned inventory DELETE route', async () => {
  mock.onDelete('/api/v1/inventory/suppliers/sup-1').reply(204);

  const { result, unmount } = renderHook(() => useDeleteSupplier(), { wrapper: createWrapper() });

  await expect(act(() => result.current.mutateAsync('sup-1'))).resolves.toBeUndefined();
  unmount();
});

it('creates a purchase order through the versioned inventory route', async () => {
  mock.onPost('/api/v1/inventory/purchase-orders', {
    supplier_id: 'sup-1',
    expected_delivery_date: '2026-07-01',
    line_items: [{ item_id: 'item-1', qty: 10, cost_price: 25 }],
  }).reply(201, {
    id: 'po-1',
    supplier_id: 'sup-1',
    status: 'draft',
    expected_delivery_date: '2026-07-01',
    line_items: [{ item_id: 'item-1', qty: 10, cost_price: 25 }],
  });

  const { result, unmount } = renderHook(() => useCreatePurchaseOrder(), {
    wrapper: createWrapper(),
  });

  await expect(
    act(() =>
      result.current.mutateAsync({
        supplier_id: 'sup-1',
        expected_delivery_date: '2026-07-01',
        line_items: [{ item_id: 'item-1', qty: 10, cost_price: 25 }],
      })
    )
  ).resolves.toMatchObject({ id: 'po-1', status: 'draft' });
  unmount();
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App/mobile
npx jest __tests__/api/featureHooksRoutes.test.tsx --no-coverage
```

Expected: all tests pass (including the 4 new ones).

- [ ] **Step 4: Commit**

```bash
git add __tests__/api/featureHooksRoutes.test.tsx
git commit -m "test(hooks): add route contract tests for supplier and PO hooks"
```

---

## Task 5: Suppliers Tab in inventory.tsx

**Files:**
- Modify: `app/owner/inventory.tsx`

This task adds the Suppliers tab: list view with add/edit/delete. The current tab state type is `'all' | 'low' | 'cat'` — extend it.

- [ ] **Step 1: Add hook imports and extend tab type**

At the top of `inventory.tsx`, add to the existing `featureHooks` import:

```typescript
import {
  useAdjustStock,
  useCreateItem,
  useCreateSupplier,
  useDeleteSupplier,
  usePurchaseOrders,
  useSalesHistory,
  useSuppliers,
  useUpdateSupplier,
} from '@/api/hooks/featureHooks';
```

Also add the new type imports:

```typescript
import type { CreateSupplierDto, SupplierDto } from '@/types/inventory';
```

Change the tab type at line 305 from:

```typescript
const [tab, setTab] = useState<'all' | 'low' | 'cat'>('all');
```

to:

```typescript
const [tab, setTab] = useState<'all' | 'low' | 'cat' | 'suppliers' | 'orders'>('all');
```

- [ ] **Step 2: Add supplier hooks and state inside InventoryScreen**

After the existing `const createItem = useCreateItem();` line, add:

```typescript
const suppliers = useSuppliers();
const createSupplier = useCreateSupplier();
const updateSupplier = useUpdateSupplier();
const deleteSupplier = useDeleteSupplier();

// Supplier form state
const [showAddSupplier, setShowAddSupplier] = useState(false);
const [editingSupplier, setEditingSupplier] = useState<SupplierDto | null>(null);
const [supName, setSupName] = useState('');
const [supPhone, setSupPhone] = useState('');
const [supEmail, setSupEmail] = useState('');
const [supAddress, setSupAddress] = useState('');

function resetSupplierForm() {
  setSupName('');
  setSupPhone('');
  setSupEmail('');
  setSupAddress('');
}

function openEditSupplier(s: SupplierDto) {
  setEditingSupplier(s);
  setSupName(s.name);
  setSupPhone(s.phone ?? '');
  setSupEmail(s.email ?? '');
  setSupAddress(s.address ?? '');
}
```

- [ ] **Step 3: Add "Suppliers" and "Orders" to the tab bar**

Find the tab map array (around line 427–430) which currently contains:

```typescript
{ id: 'all' as const, label: 'All', count: items.length, warn: false },
{ id: 'low' as const, label: 'Low stock', count: lowCount, warn: true },
{ id: 'cat' as const, label: 'Categories', count: null, warn: false },
```

Replace with:

```typescript
{ id: 'all' as const, label: 'All', count: items.length, warn: false },
{ id: 'low' as const, label: 'Low stock', count: lowCount, warn: true },
{ id: 'cat' as const, label: 'Categories', count: null, warn: false },
{ id: 'suppliers' as const, label: 'Suppliers', count: suppliers.data?.length ?? null, warn: false },
{ id: 'orders' as const, label: 'Orders', count: null, warn: false },
```

- [ ] **Step 4: Update the header "+" button**

The header currently always shows a "+" button that opens `showAddItem`. Change it to context-aware:

```typescript
<TouchableOpacity
  onPress={() => {
    if (tab === 'suppliers') { resetSupplierForm(); setShowAddSupplier(true); }
    else if (tab === 'orders') { /* handled in Task 6 */ }
    else setShowAddItem(true);
  }}
  style={{
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center',
  }}>
  <MaterialCommunityIcons name="plus" size={18} color="#fdf7eb" />
</TouchableOpacity>
```

- [ ] **Step 5: Add the Suppliers tab view**

After the closing `</ScrollView>` of the item list (around line 515) and before `{/* Modals */}`, add:

```typescript
{/* ── SUPPLIERS TAB ── */}
{tab === 'suppliers' && (
  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}>
    {suppliers.isLoading && (
      <ActivityIndicator color={colors.brand} style={{ marginTop: 32 }} />
    )}
    {!suppliers.isLoading && (suppliers.data ?? []).length === 0 && (
      <View style={{ alignItems: 'center', paddingTop: 48 }}>
        <MaterialCommunityIcons name="truck-outline" size={36} color={colors.border} />
        <Text style={{ fontSize: 14, color: colors.muted, marginTop: 10 }}>No suppliers yet</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Tap + to add your first supplier</Text>
      </View>
    )}
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
  </ScrollView>
)}
```

- [ ] **Step 6: Add the Add Supplier modal**

Inside the Modal section at the bottom of the component (after existing modals), add:

```typescript
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
                    onPress: () => deleteSupplier.mutate(String(editingSupplier.id), {
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
        {[
          { label: 'NAME', value: supName, set: setSupName, placeholder: 'Kofi Trading Co', required: true, keyboard: 'default' as const },
          { label: 'PHONE (OPTIONAL)', value: supPhone, set: setSupPhone, placeholder: '0244000000', required: false, keyboard: 'phone-pad' as const },
          { label: 'EMAIL (OPTIONAL)', value: supEmail, set: setSupEmail, placeholder: 'supplier@example.com', required: false, keyboard: 'email-address' as const },
          { label: 'ADDRESS (OPTIONAL)', value: supAddress, set: setSupAddress, placeholder: 'Accra, Ghana', required: false, keyboard: 'default' as const },
        ].map((f) => (
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
          disabled={(createSupplier.isPending || updateSupplier.isPending || deleteSupplier.isPending) || !supName.trim()}
          onPress={() => {
            const body: CreateSupplierDto = {
              name: supName.trim(),
              ...(supPhone.trim() ? { phone: supPhone.trim() } : {}),
              ...(supEmail.trim() ? { email: supEmail.trim() } : {}),
              ...(supAddress.trim() ? { address: supAddress.trim() } : {}),
            };
            if (editingSupplier) {
              updateSupplier.mutate({ id: String(editingSupplier.id), body }, {
                onSuccess: () => { setEditingSupplier(null); },
                onError: (e: Error) => Alert.alert('Error', e.message),
              });
            } else {
              createSupplier.mutate(body, {
                onSuccess: () => { setShowAddSupplier(false); resetSupplierForm(); },
                onError: (e: Error) => Alert.alert('Error', e.message),
              });
            }
          }}
          style={{
            height: 46, borderRadius: 12, backgroundColor: colors.brand,
            alignItems: 'center', justifyContent: 'center',
            opacity: (createSupplier.isPending || updateSupplier.isPending || !supName.trim()) ? 0.6 : 1,
          }}
        >
          {(createSupplier.isPending || updateSupplier.isPending) ? (
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
```

- [ ] **Step 7: Commit**

```bash
git add app/owner/inventory.tsx
git commit -m "feat(inventory): add Suppliers tab with add/edit/delete"
```

---

## Task 6: Orders Tab — PO List with Expand

**Files:**
- Modify: `app/owner/inventory.tsx`

- [ ] **Step 1: Add PO hooks and state**

After the supplier state block (added in Task 5), add:

```typescript
const purchaseOrders = usePurchaseOrders();
const [expandedPoId, setExpandedPoId] = useState<string | null>(null);

function poStatusColor(status: string) {
  if (status === 'received') return colors.brand;
  if (status === 'submitted') return '#3b82f6';
  if (status === 'cancelled') return colors.danger;
  return colors.muted; // draft
}

function poStatusLabel(status: string) {
  const map: Record<string, string> = {
    draft: 'Draft', submitted: 'Submitted', received: 'Received', cancelled: 'Cancelled',
  };
  return map[status] ?? status;
}
```

Also add to the hook imports at the top:

```typescript
import {
  // existing...
  useCreatePurchaseOrder,
  useReceivePurchaseOrder,
} from '@/api/hooks/featureHooks';
```

Add inside the component:

```typescript
const createPO = useCreatePurchaseOrder();
const receivePO = useReceivePurchaseOrder();
```

- [ ] **Step 2: Update the "+" button to open Create PO modal for the orders tab**

Update the header "+" button `onPress` from Task 5's placeholder `/* handled in Task 6 */` to:

```typescript
else if (tab === 'orders') { setPoStep(1); setShowCreatePO(true); }
```

Add the Create PO state (needed here, fully wired in Task 7):

```typescript
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
}
```

- [ ] **Step 3: Add the Orders tab view**

After the Suppliers tab closing `)}` (added in Task 5), add:

```typescript
{/* ── ORDERS TAB ── */}
{tab === 'orders' && (
  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 }}>
    {purchaseOrders.isLoading && (
      <ActivityIndicator color={colors.brand} style={{ marginTop: 32 }} />
    )}
    {!purchaseOrders.isLoading && (purchaseOrders.data ?? []).length === 0 && (
      <View style={{ alignItems: 'center', paddingTop: 48 }}>
        <MaterialCommunityIcons name="clipboard-list-outline" size={36} color={colors.border} />
        <Text style={{ fontSize: 14, color: colors.muted, marginTop: 10 }}>No purchase orders yet</Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Tap + to create your first PO</Text>
      </View>
    )}
    {(purchaseOrders.data ?? []).map((po) => {
      const isExpanded = expandedPoId === String(po.id);
      const lineCount = po.line_items?.length ?? 0;
      const supplierName = po.supplier_name
        ?? (suppliers.data ?? []).find((s) => String(s.id) === String(po.supplier_id))?.name
        ?? 'Unknown supplier';
      const canReceive = po.status === 'draft' || po.status === 'submitted';
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
                  onPress={() => {/* Mark Received modal — wired in Task 7 */}}
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
```

- [ ] **Step 4: Commit**

```bash
git add app/owner/inventory.tsx
git commit -m "feat(inventory): add Orders tab with PO list and expand"
```

---

## Task 7: Create PO Modal (3-Step)

**Files:**
- Modify: `app/owner/inventory.tsx`

- [ ] **Step 1: Add item search state for PO line items**

Inside `InventoryScreen`, add after the PO state block:

```typescript
const [poItemQuery, setPoItemQuery] = useState('');
const inventoryItemsQuery = useInventoryItems(poStep === 2 ? { search: poItemQuery || undefined, page_size: 20 } : undefined);
```

Add `useInventoryItems` to the featureHooks import if not already imported.

- [ ] **Step 2: Add the Create PO modal**

Inside the Modals section (after the Add Supplier modal), add:

```typescript
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
              const existing = poLineItems.find((l) => l.item_id === String(item.id));
              return (
                <TouchableOpacity
                  key={String(item.id)}
                  onPress={() => {
                    if (!existing) {
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
                    borderColor: existing ? colors.brand : colors.border,
                    backgroundColor: existing ? `${colors.brand}08` : colors.bg,
                    marginBottom: 6,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{item.name}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>Cost GH₵{Number(item.cost_price ?? 0).toFixed(2)}</Text>
                  </View>
                  {existing
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
            {[
              { label: 'EXPECTED DELIVERY DATE', value: poDeliveryDate, set: setPoDeliveryDate, placeholder: 'YYYY-MM-DD', required: true, keyboard: 'default' as const },
              { label: 'REFERENCE NUMBER (OPTIONAL)', value: poRef, set: setPoRef, placeholder: 'PO-2026-001', required: false, keyboard: 'default' as const },
              { label: 'PAYMENT TERMS (OPTIONAL)', value: poTerms, set: setPoTerms, placeholder: 'Net 30', required: false, keyboard: 'default' as const },
              { label: 'NOTES (OPTIONAL)', value: poNotes, set: setPoNotes, placeholder: 'Internal notes…', required: false, keyboard: 'default' as const },
            ].map((f) => (
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
            // Submit
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
```

- [ ] **Step 3: Commit**

```bash
git add app/owner/inventory.tsx
git commit -m "feat(inventory): add 3-step Create PO modal"
```

---

## Task 8: Mark Received Modal (with Input VAT Auto-Record)

**Files:**
- Modify: `app/owner/inventory.tsx`

- [ ] **Step 1: Add state and imports for the receive flow**

Inside `InventoryScreen`, add after the PO state:

```typescript
import { recordInputVAT } from '@/api/tax.api';

// Mark Received state
const [receivingPoId, setReceivingPoId] = useState<string | null>(null);
const [receiveInvoiceRef, setReceiveInvoiceRef] = useState('');
const [receiveVatAmount, setReceiveVatAmount] = useState('');
const [receiveSubtotal, setReceiveSubtotal] = useState('');
const [receiveSupplierName, setReceiveSupplierName] = useState('');
```

Add `recordInputVAT` to the tax.api import at the top:

```typescript
import { recordInputVAT } from '@/api/tax.api';
```

- [ ] **Step 2: Wire the "Mark received" button in the Orders tab**

In Task 6, Step 3, the Mark received button has `onPress={() => {/* Mark Received modal — wired in Task 7 */}}`. Replace that with:

```typescript
onPress={() => {
  const lineItems = po.line_items ?? [];
  const subtotal = lineItems.reduce((sum, li) => sum + li.qty * Number(li.cost_price), 0);
  const vat = subtotal * 0.15;
  const supplierName = po.supplier_name
    ?? (suppliers.data ?? []).find((s) => String(s.id) === String(po.supplier_id))?.name
    ?? '';
  setReceivingPoId(String(po.id));
  setReceiveInvoiceRef(po.reference_number ?? '');
  setReceiveSubtotal(subtotal.toFixed(2));
  setReceiveVatAmount(vat.toFixed(2));
  setReceiveSupplierName(supplierName);
}}
```

- [ ] **Step 3: Add the Mark Received modal**

Inside the Modals section (after the Create PO modal), add:

```typescript
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
        Receiving from {receiveSupplierName || 'supplier'} · Subtotal GH₵{receiveSubtotal}
      </Text>

      {/* Invoice ref */}
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

      {/* VAT amount */}
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
        <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>Pre-filled at 15% of subtotal. Adjust if your invoice shows a different amount.</Text>
      </View>

      <TouchableOpacity
        disabled={receivePO.isPending}
        onPress={async () => {
          if (!receivingPoId) return;
          try {
            // 1. Mark PO received (updates stock)
            await receivePO.mutateAsync(receivingPoId);

            // 2. Record input VAT (best-effort)
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
```

- [ ] **Step 4: Commit**

```bash
git add app/owner/inventory.tsx
git commit -m "feat(inventory): add Mark Received modal with input VAT auto-record"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Suppliers tab: list, add, edit, delete (Tasks 1–5)
- ✅ Orders tab: PO list with status, expand to see line items (Task 6)
- ✅ Create PO: 3-step modal — supplier picker, line items, details (Task 7)
- ✅ Mark Received: pre-filled VAT, calls receive + input-vat in sequence (Task 8)
- ✅ Empty states: both tabs have empty-state UI (Tasks 5, 6)
- ✅ No supplier guard on Create PO: empty supplier list shows "Add a supplier first" message (Task 7)
- ✅ Partial receive failure: shows partial-success alert if VAT recording fails (Task 8)
- ✅ Route contract tests: 4 new mutation tests (Task 4)

**Type consistency:**
- `CreateSupplierDto` defined in Task 1, used in Tasks 3, 5 ✅
- `PurchaseOrderDto` defined in Task 1, used in Tasks 3, 6 ✅
- `CreatePurchaseOrderDto` defined in Task 1, used in Tasks 3, 7 ✅
- `useReceivePurchaseOrder` defined in Task 3, called in Task 8 ✅
- `useCreatePurchaseOrder` defined in Task 3, wired in Tasks 6, 7 ✅
- `recordInputVAT` imported from `@/api/tax.api`, signature: `recordInputVAT({ supplier_name, invoice_ref?, purchase_date, subtotal, vat_amount })` ✅

**Placeholder scan:** No TBDs. Task 6 has an inline comment `/* Mark Received modal — wired in Task 7 */` which is resolved in Task 8, Step 2.
