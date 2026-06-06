# Group A Quick Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three small mobile–backend gaps: chat clear history, agent wallet withdrawal, and ML-based inventory threshold suggestions.

**Architecture:** Each feature adds one API function, one React Query hook, one route contract test, and one UI element. No new screens. All changes follow existing patterns in the codebase.

**Tech Stack:** Expo React Native, TypeScript, React Query (TanStack), Axios (`apiClient`), `useTheme()`, `MaterialCommunityIcons`, WatermelonDB (`serverId` for item IDs)

---

## File Map

| File | Change |
|---|---|
| `src/api/chat.api.ts` | Add `clearChatHistory()` |
| `src/types/agents.ts` | Add `AgentWithdrawRequestDto`, `AgentWithdrawResponseDto` |
| `src/api/agents.api.ts` | Add `withdrawAgentWallet()` |
| `src/api/inventory.api.ts` | Add `ThresholdSuggestionDto`, `getThresholdSuggestion()` |
| `src/api/hooks/featureHooks.ts` | Add `useClearChatHistory`, `useWithdrawAgentWallet`, `useThresholdSuggestion` |
| `__tests__/api/featureHooksRoutes.test.tsx` | Add 3 route contract tests |
| `app/owner/assistant.tsx` | Add trash icon button to header |
| `app/agent/index.tsx` | Add "Withdraw funds" button + bottom-sheet modal |
| `app/owner/inventory.tsx` | Add "Suggest" button in `ItemDetail` component |

---

## Task 1: API Functions + Types

**Files:**
- Modify: `src/api/chat.api.ts`
- Modify: `src/types/agents.ts`
- Modify: `src/api/agents.api.ts`
- Modify: `src/api/inventory.api.ts`

- [ ] **Step 1: Add clearChatHistory to chat.api.ts**

Append after the last function in `src/api/chat.api.ts`:

```typescript
export async function clearChatHistory(): Promise<void> {
  await apiClient.delete('/api/v1/chat/history');
}
```

- [ ] **Step 2: Add withdrawal types to agents.ts**

Append after the last interface in `src/types/agents.ts`:

```typescript
export interface AgentWithdrawRequestDto {
  amount: number;
}

export interface AgentWithdrawResponseDto {
  transfer_code?: string | null;
  status: string;
  amount: number;
  message?: string | null;
}
```

- [ ] **Step 3: Add withdrawAgentWallet to agents.api.ts**

First, add the new types to the import block at the top of `src/api/agents.api.ts` (find the `import type { ... } from '@/types/agents'` line and add `AgentWithdrawRequestDto` and `AgentWithdrawResponseDto`).

Then append after the last function:

```typescript
export async function withdrawAgentWallet(
  body: AgentWithdrawRequestDto
): Promise<AgentWithdrawResponseDto> {
  const response = await apiClient.post<AgentWithdrawResponseDto>(
    '/api/v1/payouts/withdraw',
    body
  );
  return response.data;
}
```

- [ ] **Step 4: Add ThresholdSuggestionDto and getThresholdSuggestion to inventory.api.ts**

Append after the last function in `src/api/inventory.api.ts`:

```typescript
export interface ThresholdSuggestionDto {
  suggested_threshold: number;
  reasoning?: string;
}

export async function getThresholdSuggestion(itemId: string): Promise<ThresholdSuggestionDto> {
  const response = await apiClient.get<ThresholdSuggestionDto>(
    `/api/v1/inventory/items/${itemId}/threshold-suggestion`
  );
  return response.data;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/api/chat.api.ts src/types/agents.ts src/api/agents.api.ts src/api/inventory.api.ts
git commit -m "feat(api): add clearChatHistory, withdrawAgentWallet, getThresholdSuggestion"
```

---

## Task 2: React Query Hooks

**Files:**
- Modify: `src/api/hooks/featureHooks.ts`

- [ ] **Step 1: Add clearChatHistory import and useClearChatHistory hook**

Find the existing chat.api import in `featureHooks.ts` (search for `getChatHistory` or `processChatMessage`). Add `clearChatHistory` to it.

Then find `useProcessChatMessage` function and add `useClearChatHistory` immediately after it:

```typescript
export function useClearChatHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: clearChatHistory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chat-history'] }),
  });
}
```

- [ ] **Step 2: Add withdrawAgentWallet import and useWithdrawAgentWallet hook**

Find the existing agents.api import in `featureHooks.ts` (search for `getAgentWallet` or `listAgentCommissions`). Add `withdrawAgentWallet` to it.

Also add `AgentWithdrawRequestDto` to the `@/types/agents` import block.

Then find `useRequestAgentPayout` and add `useWithdrawAgentWallet` after it:

```typescript
export function useWithdrawAgentWallet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AgentWithdrawRequestDto) => withdrawAgentWallet(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-wallet-workspace'] }),
  });
}
```

- [ ] **Step 3: Add getThresholdSuggestion import and useThresholdSuggestion hook**

Find the existing inventory.api import in `featureHooks.ts` (search for `createItem`, `listItems`, etc.). Add `getThresholdSuggestion` to it.

Also add `ThresholdSuggestionDto` to the `@/types/inventory` import block (or if `ThresholdSuggestionDto` is defined in `inventory.api.ts` not `types/inventory.ts`, import it from `@/api/inventory.api` instead).

Then find `useDeleteItem` or `useAdjustStock` and add `useThresholdSuggestion` after the inventory hooks section:

```typescript
export function useThresholdSuggestion() {
  return useMutation({
    mutationFn: (itemId: string) => getThresholdSuggestion(itemId),
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/api/hooks/featureHooks.ts
git commit -m "feat(hooks): add useClearChatHistory, useWithdrawAgentWallet, useThresholdSuggestion"
```

---

## Task 3: Route Contract Tests

**Files:**
- Modify: `__tests__/api/featureHooksRoutes.test.tsx`

- [ ] **Step 1: Add hook imports**

Find the existing import from `@/api/hooks/featureHooks` and add:
- `useClearChatHistory`
- `useWithdrawAgentWallet`
- `useThresholdSuggestion`

- [ ] **Step 2: Add 3 tests inside the existing describe block**

Add after the existing tests, inside `describe('feature hook route contracts', () => { ... })`:

```typescript
  it('clears chat history through the versioned DELETE route', async () => {
    mock.onDelete('/api/v1/chat/history').reply(204);

    const { result, unmount } = renderHook(() => useClearChatHistory(), {
      wrapper: createWrapper(),
    });

    await expect(act(() => result.current.mutateAsync())).resolves.toBeUndefined();
    unmount();
  });

  it('withdraws agent wallet balance through the payouts route', async () => {
    mock.onPost('/api/v1/payouts/withdraw', { amount: 100 }).reply(200, {
      status: 'pending',
      amount: 100,
      transfer_code: 'TRF_abc123',
    });

    const { result, unmount } = renderHook(() => useWithdrawAgentWallet(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync({ amount: 100 }))
    ).resolves.toMatchObject({ status: 'pending', amount: 100 });
    unmount();
  });

  it('fetches ML threshold suggestion through the versioned inventory route', async () => {
    mock
      .onGet('/api/v1/inventory/items/item-abc/threshold-suggestion')
      .reply(200, { suggested_threshold: 15, reasoning: 'Based on 7-day sales velocity' });

    const { result, unmount } = renderHook(() => useThresholdSuggestion(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() => result.current.mutateAsync('item-abc'))
    ).resolves.toMatchObject({ suggested_threshold: 15 });
    unmount();
  });
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/vincenttetteh/Desktop/SMEflow-App/mobile
npx jest __tests__/api/featureHooksRoutes.test.tsx --no-coverage
```

Expected: all tests pass (27 total — 24 existing + 3 new).

- [ ] **Step 4: Commit**

```bash
git add __tests__/api/featureHooksRoutes.test.tsx
git commit -m "test(hooks): add route contract tests for Group A features"
```

---

## Task 4: Chat Clear History UI

**Files:**
- Modify: `app/owner/assistant.tsx`

Context: The assistant screen has `msgs` state (`const [msgs, setMsgs] = useState<Msg[]>([])`). The header is a `<View>` at the top of the return statement with a translate icon button as the last element (line ~350). `Alert`, `TouchableOpacity`, `MaterialCommunityIcons` are already imported.

- [ ] **Step 1: Import and instantiate the hook**

At the top of the component (search for `const processMessage = useProcessChatMessage()`), add:

```typescript
import { useClearChatHistory, useGetChatHistory, useProcessChatMessage } from '@/api/hooks/featureHooks';
```

Inside the component function, after other hook declarations, add:

```typescript
const clearHistory = useClearChatHistory();
```

- [ ] **Step 2: Add the clear button to the header**

Find the header section (the `<View>` containing the translate button). The translate button is:
```tsx
<TouchableOpacity onPress={() => setShowLangPicker(true)} hitSlop={8} style={{ padding: 4 }}>
  <MaterialCommunityIcons name="translate" size={20} color={colors.muted} />
</TouchableOpacity>
```

**After** this TouchableOpacity (before the closing `</View>` of the header), add:

```tsx
<TouchableOpacity
  hitSlop={8}
  style={{ padding: 4 }}
  onPress={() => {
    Alert.alert(
      'Clear history?',
      'This will permanently delete your conversation history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () =>
            clearHistory.mutate(undefined, {
              onSuccess: () => setMsgs([]),
              onError: (e: Error) =>
                Alert.alert('Error', e.message ?? 'Could not clear history.'),
            }),
        },
      ]
    );
  }}
>
  <MaterialCommunityIcons name="delete-outline" size={20} color={colors.muted} />
</TouchableOpacity>
```

- [ ] **Step 3: Commit**

```bash
git add app/owner/assistant.tsx
git commit -m "feat(chat): add clear history button to assistant header"
```

---

## Task 5: Agent Wallet Withdrawal UI

**Files:**
- Modify: `app/agent/index.tsx`

Context: The agent dashboard has `const wallet = walletWorkspace?.wallet` available. The CTAs section is a `<View style={{ flexDirection: 'row', gap: 8 }}>` containing the "Onboard new trader" button. `Modal`, `KeyboardAvoidingView`, `TextInput`, `Platform`, `Alert`, `ActivityIndicator`, `TouchableOpacity`, `View` are already imported (check imports; add any missing ones). `useTheme()` is already used.

- [ ] **Step 1: Import the hook and add state**

Add `useWithdrawAgentWallet` to the existing featureHooks import.

Inside the component, after other hook declarations (find `const { data: walletWorkspace } = useAgentWalletWorkspace()`), add:

```typescript
const withdraw = useWithdrawAgentWallet();
const [showWithdrawModal, setShowWithdrawModal] = useState(false);
const [withdrawAmount, setWithdrawAmount] = useState('');
```

- [ ] **Step 2: Add "Withdraw funds" button to the CTAs row**

The CTAs section has a single button inside a `<View style={{ flexDirection: 'row', gap: 8 }}>`. Add the withdraw button inside that row, **before** the "Onboard new trader" button:

```tsx
<TouchableOpacity
  onPress={() => {
    setWithdrawAmount(String(wallet?.available_balance ?? ''));
    setShowWithdrawModal(true);
  }}
  disabled={!wallet?.eligible_for_payout}
  style={{
    flex: 1, height: 50, borderRadius: 14,
    borderWidth: 1, borderColor: wallet?.eligible_for_payout ? colors.gold : colors.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    opacity: wallet?.eligible_for_payout ? 1 : 0.5,
  }}
>
  <MaterialCommunityIcons
    name="bank-transfer-out"
    size={17}
    color={wallet?.eligible_for_payout ? colors.gold : colors.muted}
  />
  <Text style={{
    fontFamily: fonts.bodySemiBold, fontSize: 13,
    color: wallet?.eligible_for_payout ? colors.gold : colors.muted,
  }}>
    Withdraw
  </Text>
</TouchableOpacity>
```

- [ ] **Step 3: Add the withdrawal modal**

Before the final closing `</ScrollView>` or `</SafeAreaView>` of the component, add:

```tsx
<Modal
  visible={showWithdrawModal}
  transparent
  animationType="slide"
  onRequestClose={() => setShowWithdrawModal(false)}
>
  <KeyboardAvoidingView
    style={{ flex: 1 }}
    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
  >
    <TouchableOpacity
      style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
      activeOpacity={1}
      onPress={() => setShowWithdrawModal(false)}
    />
    <View style={{
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20, borderTopRightRadius: 20,
      padding: 20, paddingBottom: 34,
    }}>
      <Text style={{ fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink, marginBottom: 4 }}>
        Withdraw funds
      </Text>
      <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 16 }}>
        Available: GH₵{wallet?.available_balance ?? '0.00'}
      </Text>
      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 4 }}>
          AMOUNT (GH₵)
        </Text>
        <TextInput
          value={withdrawAmount}
          onChangeText={setWithdrawAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={colors.muted}
          style={{
            borderWidth: 1, borderColor: colors.border, borderRadius: 10,
            paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
            color: colors.ink, backgroundColor: colors.bg,
          }}
        />
      </View>
      <TouchableOpacity
        disabled={withdraw.isPending || !withdrawAmount || Number(withdrawAmount) <= 0}
        onPress={() => {
          const amt = Number(withdrawAmount);
          const max = Number(wallet?.available_balance ?? 0);
          if (amt > max) {
            Alert.alert('Exceeds balance', `Maximum withdrawal is GH₵${max.toFixed(2)}.`);
            return;
          }
          withdraw.mutate({ amount: amt }, {
            onSuccess: () => {
              setShowWithdrawModal(false);
              setWithdrawAmount('');
              Alert.alert('Withdrawal initiated', 'Funds will be sent to your registered MoMo account.');
            },
            onError: (e: Error) => Alert.alert('Error', e.message ?? 'Withdrawal failed.'),
          });
        }}
        style={{
          height: 46, borderRadius: 12, backgroundColor: colors.gold,
          alignItems: 'center', justifyContent: 'center',
          opacity: (withdraw.isPending || !withdrawAmount || Number(withdrawAmount) <= 0) ? 0.6 : 1,
        }}
      >
        {withdraw.isPending ? (
          <ActivityIndicator size="small" color={colors.ink} />
        ) : (
          <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
            Withdraw
          </Text>
        )}
      </TouchableOpacity>
    </View>
  </KeyboardAvoidingView>
</Modal>
```

- [ ] **Step 4: Check that needed imports exist** — `Modal`, `KeyboardAvoidingView`, `TextInput`, `Platform`, `ActivityIndicator` must be imported from `react-native`. Add any that are missing.

- [ ] **Step 5: Commit**

```bash
git add app/agent/index.tsx
git commit -m "feat(agent): add wallet withdrawal button and modal"
```

---

## Task 6: ML Inventory Threshold Suggestion UI

**Files:**
- Modify: `app/owner/inventory.tsx`

Context: `ItemDetail` is a function component at the top of `inventory.tsx`, defined as `function ItemDetail({ item, onBack }: { item: LocalItem; onBack: () => void })`. The threshold display is around line 158 (search for `lowStockThreshold` or `Threshold:`). `item.serverId` is the WatermelonDB server-side UUID (type `string | null`). `useUpdateItem` is available from featureHooks (already imported in the file since the main `InventoryScreen` uses it).

- [ ] **Step 1: Import the new hooks**

At the top of `inventory.tsx`, find the existing featureHooks import and add `useThresholdSuggestion` to it:

```typescript
import {
  useAdjustStock,
  useCreateItem,
  // ... other existing imports ...
  useThresholdSuggestion,
  useUpdateItem,
} from '@/api/hooks/featureHooks';
```

Check if `useUpdateItem` is already imported; add it if not.

- [ ] **Step 2: Add hooks inside ItemDetail**

Inside the `ItemDetail` function body, after the existing hook calls (find `const adjustStock = useAdjustStock()`), add:

```typescript
const suggestion = useThresholdSuggestion();
const updateItem = useUpdateItem();
```

- [ ] **Step 3: Add "Suggest" button next to the threshold display**

Find the line that displays the threshold (search for `lowStockThreshold` in `ItemDetail`). It should look something like:

```tsx
<Text style={{ ... }}>Threshold: {item.lowStockThreshold}</Text>
```

Replace or augment that section to add a "Suggest" chip button:

```tsx
<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
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
```

- [ ] **Step 4: Commit**

```bash
git add app/owner/inventory.tsx
git commit -m "feat(inventory): add ML threshold suggestion button to item detail"
```

---

## Self-Review

**Spec coverage:**
- ✅ Chat clear: `clearChatHistory()` in Task 1, `useClearChatHistory` in Task 2, test in Task 3, trash button in Task 4
- ✅ Agent withdrawal: types + `withdrawAgentWallet()` in Task 1, `useWithdrawAgentWallet` in Task 2, test in Task 3, UI in Task 5
- ✅ Threshold suggestion: `getThresholdSuggestion()` + DTO in Task 1, `useThresholdSuggestion` in Task 2, test in Task 3, Suggest button in Task 6

**Type consistency:**
- `AgentWithdrawRequestDto` defined in Task 1 (`types/agents.ts`), imported in `agents.api.ts` (Task 1), imported in featureHooks (Task 2) ✅
- `ThresholdSuggestionDto` defined in Task 1 (`inventory.api.ts`), used in hook (Task 2) ✅
- `useThresholdSuggestion` defined in Task 2, used in Task 6 with `mutate(itemId: string)` ✅
- `useUpdateItem` already exists in featureHooks at lines 786-795, called in Task 6 with `{ itemId: string, body: ItemUpdateDto }` ✅

**Placeholder scan:** No TBDs. All code is complete.
