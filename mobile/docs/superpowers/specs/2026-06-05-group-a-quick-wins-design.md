# Group A Quick Wins: Chat Clear, Agent Withdrawal, ML Threshold Suggestion

**Date:** 2026-06-05
**Status:** Approved

## Context

Three small gaps between backend and mobile that each require ≤ 2 files of change. No new screens needed.

---

## Feature 1: Chat Clear History

**Problem:** `DELETE /api/v1/chat/history` exists on the backend. There is no button or API call on mobile — users cannot clear their conversation history.

**Change:**

`src/api/chat.api.ts` — add:
```typescript
export async function clearChatHistory(): Promise<void> {
  await apiClient.delete('/api/v1/chat/history');
}
```

`src/api/hooks/featureHooks.ts` — add `useClearChatHistory()` mutation that:
- Calls `clearChatHistory()`
- On success: invalidates `['chat-history']`

`app/owner/assistant.tsx` — add a `delete-outline` icon button to the header right side (next to the existing translate icon). On press:
- Show `Alert.alert('Clear history?', 'This will permanently delete your conversation history.', [Cancel, Clear (destructive)])`
- On confirm: call `clearChatHistory.mutate()`, and clear the local `messages` state immediately so the screen shows empty without waiting for a refetch

---

## Feature 2: Agent Wallet Withdrawal

**Problem:** Agents can view their wallet balance but cannot initiate a withdrawal. `POST /api/v1/payouts/withdraw` exists on the backend but has no mobile UI or API call.

**Change:**

`src/types/agents.ts` — add:
```typescript
export interface AgentWithdrawRequestDto {
  amount: number;
}

export interface AgentWithdrawResponseDto {
  transfer_code?: string;
  status: string;
  amount: number;
  message?: string;
}
```

`src/api/agents.api.ts` — add:
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

`src/api/hooks/featureHooks.ts` — add `useWithdrawAgentWallet()` mutation that:
- Calls `withdrawAgentWallet(body)`
- On success: invalidates `['agent-wallet-workspace']`

`app/agent/index.tsx` — in the CTAs section (below the "Onboard new trader" button):
- Add a "Withdraw funds" `TouchableOpacity` button
- Enabled only when `wallet?.eligible_for_payout === true`; disabled + dimmed otherwise
- When `eligible_for_payout` is false, show a subtitle: "Available after GH₵{wallet.payout_threshold}"
- Tapping the button opens a **bottom-sheet Modal** with:
  - Title: "Withdraw funds"
  - Subtitle: "Available: GH₵{wallet.available_balance}"
  - TextInput for amount (numeric, max = `available_balance`, placeholder = available_balance)
  - "Withdraw" button: calls `withdrawAgentWallet.mutate({ amount: Number(amountInput) })`
  - Loading state during pending, success Alert, error Alert on failure
  - Closes modal on success

---

## Feature 3: ML Inventory Threshold Suggestion

**Problem:** `GET /api/v1/inventory/items/{id}/threshold-suggestion` returns an ML-based reorder point. On mobile, thresholds are set manually with no intelligent guidance.

**Backend response shape:**
```json
{ "suggested_threshold": 15, "reasoning": "Based on 7-day sales velocity" }
```

**Change:**

`src/api/inventory.api.ts` — add:
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

`src/api/hooks/featureHooks.ts` — add `useThresholdSuggestion()` mutation (not query — fetched on-demand):
```typescript
export function useThresholdSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => getThresholdSuggestion(itemId),
  });
}
```

`app/owner/inventory.tsx` — in `ItemDetail` component, near the threshold display (around line 158):
- Add a small "Suggest" text button or chip icon next to "Threshold: {item.lowStockThreshold}"
- On press: call `suggestion.mutate(item.serverId!)` (use WatermelonDB's `serverId` field)
- Guard: if `item.serverId` is null (item not yet synced), show Alert "Sync required before getting suggestions"
- Show `ActivityIndicator` while pending
- On success: `Alert.alert('Suggested threshold: {suggested_threshold}', reasoning, [Cancel, Apply])`
- Apply: calls `updateItem.mutate({ itemId: item.serverId!, body: { low_stock_threshold: String(suggested_threshold) } })`

`useUpdateItem` already exists in `featureHooks.ts` at lines 786–795. Import and use it inside `ItemDetail`.

---

## Out of Scope

- Withdrawal history screen (separate feature)
- Partial withdrawals (full available_balance withdrawal is the primary use case)
- Threshold suggestion auto-apply without confirmation

---

## Verification

1. **Chat clear**: Send a message, tap the trash icon, confirm → history disappears; call to `DELETE /api/v1/chat/history` observed in network
2. **Agent withdrawal**: Log in as agent, navigate to agent dashboard, tap "Withdraw funds" → enter amount → confirm → success alert shown
3. **Threshold suggestion**: Open any inventory item detail → tap "Suggest" → suggested value appears in alert with reasoning → tap Apply → threshold updates
