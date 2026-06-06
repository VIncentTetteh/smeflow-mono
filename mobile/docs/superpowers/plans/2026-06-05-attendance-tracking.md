# Attendance Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Attendance tab to the payroll screen with a monthly summary table and a bulk mark-attendance modal.

**Architecture:** All attendance UI lives in the existing `payroll.tsx` (follows the same pattern as the Team and History tabs). Two new API functions, two new hooks, and a new tab are the only additions. The `payroll.tsx` is already ~1517 lines; this adds ~250 more lines.

**Tech Stack:** Expo React Native, TypeScript, React Query (TanStack), Axios, `useTheme()`, `MaterialCommunityIcons`

---

## File Map

| File | Change |
|---|---|
| `src/types/payroll.ts` | Add `AttendanceStatusType`, `AttendanceSummaryDto`, `BulkAttendanceRecord`, `BulkAttendanceRequestDto` |
| `src/api/payroll.api.ts` | Add `getAttendanceSummary()`, `bulkRecordAttendance()` |
| `src/api/hooks/featureHooks.ts` | Add `useAttendanceSummary()`, `useBulkRecordAttendance()` |
| `__tests__/api/featureHooksRoutes.test.tsx` | Add 2 route contract tests |
| `app/owner/payroll.tsx` | Add `'attendance'` tab + summary table + period picker + mark button + modal |

---

## Task 1: Types

**Files:**
- Modify: `src/types/payroll.ts`

- [ ] **Step 1: Append 4 new types to src/types/payroll.ts**

Append after the existing `PayrollWorkspaceDto` interface (end of file):

```typescript
export type AttendanceStatusType = 'present' | 'absent' | 'half_day';

export interface AttendanceSummaryDto {
  employee_id: UUID;
  employee_name: string;
  present: number;
  half_day: number;
  absent: number;
  total_days: number;
  effective_days: number;
}

export interface BulkAttendanceRecord {
  employee_id: string;
  date: string;
  status: AttendanceStatusType;
  hours_worked?: number;
}

export interface BulkAttendanceRequestDto {
  records: BulkAttendanceRecord[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/payroll.ts
git commit -m "feat(types): add attendance types to payroll"
```

---

## Task 2: API Functions

**Files:**
- Modify: `src/api/payroll.api.ts`

- [ ] **Step 1: Add type imports**

Find the existing `import type { EmployeeDto, PayrollRunDto, PayslipDto } from '@/types/payroll'` line. Add the new types:

```typescript
import type {
  AttendanceSummaryDto,
  BulkAttendanceRequestDto,
  EmployeeDto,
  PayrollRunDto,
  PayslipDto,
} from '@/types/payroll';
```

- [ ] **Step 2: Append 2 new functions after the last function in payroll.api.ts**

```typescript
export async function getAttendanceSummary(params: {
  period_start: string;
  period_end: string;
}): Promise<AttendanceSummaryDto[]> {
  const response = await apiClient.get<AttendanceSummaryDto[]>(
    '/api/v1/payroll/attendance/summary',
    { params }
  );
  return response.data;
}

export async function bulkRecordAttendance(
  body: BulkAttendanceRequestDto
): Promise<{ saved: number; errors?: unknown[] }> {
  const response = await apiClient.post<{ saved: number; errors?: unknown[] }>(
    '/api/v1/payroll/attendance/bulk',
    body
  );
  return response.data;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/api/payroll.api.ts
git commit -m "feat(api): add getAttendanceSummary and bulkRecordAttendance"
```

---

## Task 3: Hooks

**Files:**
- Modify: `src/api/hooks/featureHooks.ts`

- [ ] **Step 1: Add API imports**

Find the existing payroll.api import (search for `approvePayrollRun` or `runPayroll`). Add the 2 new functions:

```typescript
import {
  approvePayrollRun,
  bulkRecordAttendance,
  createEmployee,
  downloadP9A,
  downloadP9B,
  getAttendanceSummary,
  getRunPayslips,
  listEmployees,
  listPayrollRuns,
  payPayslip,
  runPayroll,
  updateEmployee,
} from '@/api/payroll.api';
```

Also add the new types to the payroll types import:

```typescript
import type {
  AttendanceSummaryDto,
  BulkAttendanceRequestDto,
  EmployeeDto,
  PayrollRunDto,
  PayslipDto,
} from '@/types/payroll';
```

- [ ] **Step 2: Add 2 hooks after the existing payroll hooks**

Find `useDisbursePayroll` (the last payroll hook). Add after it:

```typescript
// ── Attendance ────────────────────────────────────────────────────────────────

export function useAttendanceSummary(params: {
  period_start: string;
  period_end: string;
} | null) {
  return useQuery({
    enabled: !!params,
    queryKey: ['attendance-summary', params],
    queryFn: () => getAttendanceSummary(params!),
    staleTime: 30_000,
    retry: 1,
  });
}

export function useBulkRecordAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkAttendanceRequestDto) => bulkRecordAttendance(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance-summary'] }),
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/api/hooks/featureHooks.ts
git commit -m "feat(hooks): add useAttendanceSummary and useBulkRecordAttendance"
```

---

## Task 4: Route Contract Tests

**Files:**
- Modify: `__tests__/api/featureHooksRoutes.test.tsx`

- [ ] **Step 1: Add imports**

Add to the existing hook import block:
- `useAttendanceSummary`
- `useBulkRecordAttendance`

- [ ] **Step 2: Add 2 tests**

```typescript
  it('loads attendance summary through the versioned payroll route', async () => {
    mock
      .onGet('/api/v1/payroll/attendance/summary', {
        params: { period_start: '2026-06-01', period_end: '2026-06-30' },
      })
      .reply(200, [
        {
          employee_id: 'emp-1',
          employee_name: 'Kofi Adu',
          present: 15,
          half_day: 2,
          absent: 3,
          total_days: 20,
          effective_days: 16,
        },
      ]);

    const { result, unmount } = renderHook(
      () => useAttendanceSummary({ period_start: '2026-06-01', period_end: '2026-06-30' }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([
        expect.objectContaining({ employee_name: 'Kofi Adu', effective_days: 16 }),
      ]);
    });
    unmount();
  });

  it('bulk records attendance through the versioned payroll route', async () => {
    mock
      .onPost('/api/v1/payroll/attendance/bulk', {
        records: [
          { employee_id: 'emp-1', date: '2026-06-05', status: 'present' },
          { employee_id: 'emp-2', date: '2026-06-05', status: 'absent' },
        ],
      })
      .reply(201, { saved: 2 });

    const { result, unmount } = renderHook(() => useBulkRecordAttendance(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(() =>
        result.current.mutateAsync({
          records: [
            { employee_id: 'emp-1', date: '2026-06-05', status: 'present' },
            { employee_id: 'emp-2', date: '2026-06-05', status: 'absent' },
          ],
        })
      )
    ).resolves.toMatchObject({ saved: 2 });
    unmount();
  });
```

- [ ] **Step 3: Run tests**

```bash
npx jest __tests__/api/featureHooksRoutes.test.tsx --no-coverage
```

Expected: 33 tests passing (31 existing + 2 new). Fix any failures.

- [ ] **Step 4: Commit**

```bash
git add __tests__/api/featureHooksRoutes.test.tsx
git commit -m "test(hooks): add route contract tests for attendance"
```

---

## Task 5: Attendance Tab UI in payroll.tsx

**Files:**
- Modify: `app/owner/payroll.tsx`

Context: The file is ~1517 lines. Tab type is `'team' | 'history'` at line 32. The tab bar renders at lines ~294–316. `activeTab === 'team'` section is ~lines 322–591. `activeTab === 'history'` section is ~lines 596–1091.

- [ ] **Step 1: Update Tab type and imports**

Find `type Tab = 'team' | 'history'` (line 32). Change to:

```typescript
type Tab = 'team' | 'attendance' | 'history';
```

Add to the featureHooks import (find `useApprovePayrollRun` etc.):
```typescript
import {
  useApprovePayrollRun,
  useAttendanceSummary,
  useBulkRecordAttendance,
  useCreateEmployee,
  useDisbursePayroll,
  useDownloadP9A,
  useDownloadP9B,
  usePayPayslip,
  usePayroll,
  useRunPayroll,
  useRunPayslips,
  useUpdateEmployee,
} from '@/api/hooks/featureHooks';
```

Also add to the types import:
```typescript
import type { AttendanceStatusType, AttendanceSummaryDto, BulkAttendanceRequestDto, EmployeeDto, PayrollRunDto } from '@/types/payroll';
```

- [ ] **Step 2: Add attendance state and hooks inside PayrollScreen**

After the existing `const paySlip = usePayPayslip()` (find it in the hook declarations section), add:

```typescript
const recordAttendance = useBulkRecordAttendance();

// Attendance period state — default to current month
const nowDate = new Date();
const [attYear, setAttYear] = useState(nowDate.getFullYear());
const [attMonth, setAttMonth] = useState(nowDate.getMonth() + 1);

const attPeriodStart = `${attYear}-${String(attMonth).padStart(2, '0')}-01`;
const attPeriodEnd = (() => {
  const last = new Date(attYear, attMonth, 0);
  return last.toISOString().slice(0, 10);
})();

const attendanceSummary = useAttendanceSummary({ period_start: attPeriodStart, period_end: attPeriodEnd });

// Mark attendance modal state
const [showMarkModal, setShowMarkModal] = useState(false);
const [markDate, setMarkDate] = useState(() => new Date().toISOString().slice(0, 10));
const [markStatuses, setMarkStatuses] = useState<Record<string, AttendanceStatusType>>({});

function openMarkModal() {
  const today = new Date().toISOString().slice(0, 10);
  setMarkDate(today);
  const defaults: Record<string, AttendanceStatusType> = {};
  employees.forEach((e) => { defaults[String(e.id)] = 'present'; });
  setMarkStatuses(defaults);
  setShowMarkModal(true);
}
```

- [ ] **Step 3: Add Attendance to the tab bar**

Find the tab bar mapping. It currently maps over `(['team', 'history'] as Tab[])`. Change to:

```typescript
{(['team', 'attendance', 'history'] as Tab[]).map((tab) => (
  <TouchableOpacity
    key={tab}
    onPress={() => setActiveTab(tab)}
    style={{
      paddingVertical: 10,
      marginRight: 24,
      borderBottomWidth: 2,
      borderBottomColor: activeTab === tab ? colors.brand : 'transparent',
    }}
  >
    <Text
      style={{
        fontSize: 13,
        fontFamily: activeTab === tab ? fonts.bodySemiBold : fonts.body,
        color: activeTab === tab ? colors.brand : colors.muted,
        textTransform: 'capitalize',
      }}
    >
      {tab === 'team' ? 'Team' : tab === 'attendance' ? 'Attendance' : 'History'}
    </Text>
  </TouchableOpacity>
))}
```

- [ ] **Step 4: Add the Attendance tab content**

After the closing `)}` of the Team tab (`{activeTab === 'team' && (...)}`) and before the History tab (`{activeTab === 'history' && (...)}`), add:

```tsx
{/* ═══════════════════════════════════════════════════════════════
    ATTENDANCE TAB
═══════════════════════════════════════════════════════════════ */}
{activeTab === 'attendance' && (
  <View style={{ flex: 1 }}>
    {/* Period picker */}
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      paddingVertical: 12, gap: 16,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    }}>
      <TouchableOpacity
        onPress={() => {
          if (attMonth === 1) { setAttMonth(12); setAttYear((y) => y - 1); }
          else setAttMonth((m) => m - 1);
        }}
        style={{ padding: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}
      >
        <MaterialCommunityIcons name="chevron-left" size={20} color={colors.ink} />
      </TouchableOpacity>
      <Text style={{ fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink, minWidth: 130, textAlign: 'center' }}>
        {new Date(attYear, attMonth - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })}
      </Text>
      <TouchableOpacity
        onPress={() => {
          if (attMonth === 12) { setAttMonth(1); setAttYear((y) => y + 1); }
          else setAttMonth((m) => m + 1);
        }}
        style={{ padding: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}
      >
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.ink} />
      </TouchableOpacity>
    </View>

    {/* Summary table */}
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 100 }}>
      {attendanceSummary.isLoading && (
        <ActivityIndicator color={colors.brand} style={{ marginTop: 32 }} />
      )}
      {attendanceSummary.isError && (
        <View style={{ alignItems: 'center', paddingTop: 32 }}>
          <Text style={{ fontSize: 13, color: colors.muted }}>Could not load attendance</Text>
          <TouchableOpacity
            onPress={() => void attendanceSummary.refetch()}
            style={{ marginTop: 10, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
      {!attendanceSummary.isLoading && !attendanceSummary.isError && (attendanceSummary.data ?? []).length === 0 && (
        <View style={{ alignItems: 'center', paddingTop: 48 }}>
          <MaterialCommunityIcons name="calendar-check-outline" size={36} color={colors.border} />
          <Text style={{ fontSize: 14, color: colors.muted, marginTop: 10 }}>No attendance recorded</Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>Tap "Mark attendance" to start</Text>
        </View>
      )}
      {(attendanceSummary.data ?? []).length > 0 && (
        <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}>
          {/* Table header */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ flex: 1, fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold }}>Employee</Text>
            <Text style={{ width: 36, fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textAlign: 'center' }}>P</Text>
            <Text style={{ width: 36, fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textAlign: 'center' }}>H</Text>
            <Text style={{ width: 36, fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textAlign: 'center' }}>A</Text>
            <Text style={{ width: 48, fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textAlign: 'right' }}>Eff.</Text>
          </View>
          {(attendanceSummary.data ?? []).map((row: AttendanceSummaryDto, i: number) => (
            <View
              key={row.employee_id}
              style={{
                flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10,
                borderBottomWidth: i < (attendanceSummary.data ?? []).length - 1 ? 1 : 0,
                borderBottomColor: colors.border,
              }}
            >
              <Text style={{ flex: 1, fontSize: 13, color: colors.ink, fontFamily: fonts.bodySemiBold }} numberOfLines={1}>{row.employee_name}</Text>
              <Text style={{ width: 36, fontSize: 12, color: colors.brand, textAlign: 'center', fontFamily: fonts.mono }}>{row.present}</Text>
              <Text style={{ width: 36, fontSize: 12, color: '#b6831e', textAlign: 'center', fontFamily: fonts.mono }}>{row.half_day}</Text>
              <Text style={{ width: 36, fontSize: 12, color: colors.danger, textAlign: 'center', fontFamily: fonts.mono }}>{row.absent}</Text>
              <Text style={{ width: 48, fontSize: 12, color: colors.ink, textAlign: 'right', fontFamily: fonts.mono }}>{Number(row.effective_days).toFixed(1)}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>

    {/* Fixed mark button */}
    <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: 28, backgroundColor: colors.bg }}>
      <TouchableOpacity
        onPress={openMarkModal}
        disabled={employees.length === 0}
        style={{
          height: 48, borderRadius: 14, backgroundColor: colors.brand,
          alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
          opacity: employees.length === 0 ? 0.5 : 1,
        }}
      >
        <MaterialCommunityIcons name="calendar-check-outline" size={18} color="#fff" />
        <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>Mark attendance</Text>
      </TouchableOpacity>
    </View>
  </View>
)}
```

- [ ] **Step 5: Commit**

```bash
git add app/owner/payroll.tsx
git commit -m "feat(payroll): add Attendance tab with summary table and period picker"
```

---

## Task 6: Mark Attendance Modal in payroll.tsx

**Files:**
- Modify: `app/owner/payroll.tsx`

- [ ] **Step 1: Add the modal**

Find the modals section (near the end of the file, before the closing `</SafeAreaView>`). Add the mark attendance modal after the existing modals:

```tsx
{/* ─── Mark Attendance modal ─────────────────────────────────────────── */}
<Modal
  visible={showMarkModal}
  transparent
  animationType="slide"
  onRequestClose={() => setShowMarkModal(false)}
>
  <TouchableOpacity
    style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
    activeOpacity={1}
    onPress={() => setShowMarkModal(false)}
  />
  <View style={{
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '80%',
  }}>
    {/* Header */}
    <View style={{ padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink, marginBottom: 10 }}>
        Mark attendance
      </Text>
      {/* Date picker row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <TouchableOpacity
          onPress={() => {
            const d = new Date(markDate);
            d.setDate(d.getDate() - 1);
            setMarkDate(d.toISOString().slice(0, 10));
          }}
          style={{ padding: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}
        >
          <MaterialCommunityIcons name="chevron-left" size={18} color={colors.ink} />
        </TouchableOpacity>
        <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink, minWidth: 130, textAlign: 'center' }}>
          {new Date(markDate + 'T00:00:00').toLocaleDateString('en-GH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
        </Text>
        <TouchableOpacity
          onPress={() => {
            const d = new Date(markDate);
            d.setDate(d.getDate() + 1);
            setMarkDate(d.toISOString().slice(0, 10));
          }}
          style={{ padding: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}
        >
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.ink} />
        </TouchableOpacity>
      </View>
    </View>

    {/* Employee list */}
    <ScrollView bounces={false} contentContainerStyle={{ padding: 16, gap: 10 }}>
      {employees.map((emp) => {
        const status = markStatuses[String(emp.id)] ?? 'present';
        return (
          <View
            key={String(emp.id)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 10,
              backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border,
              borderRadius: 12, padding: 10,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{emp.name ?? emp.phone ?? '—'}</Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>{emp.role ?? 'Staff'}</Text>
            </View>
            {/* 3-segment toggle */}
            <View style={{ flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
              {(['present', 'half_day', 'absent'] as AttendanceStatusType[]).map((s) => {
                const selected = status === s;
                const bg = s === 'present' ? colors.brand : s === 'half_day' ? '#b6831e' : colors.danger;
                const label = s === 'present' ? 'P' : s === 'half_day' ? 'H' : 'A';
                return (
                  <TouchableOpacity
                    key={s}
                    onPress={() => setMarkStatuses((prev) => ({ ...prev, [String(emp.id)]: s }))}
                    style={{
                      width: 36, height: 32, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: selected ? bg : colors.surface,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: selected ? '#fff' : colors.muted }}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}
    </ScrollView>

    {/* Submit */}
    <View style={{ padding: 16, paddingBottom: 34 }}>
      <TouchableOpacity
        disabled={recordAttendance.isPending || employees.length === 0}
        onPress={() => {
          const records: BulkAttendanceRequestDto['records'] = employees.map((e) => ({
            employee_id: String(e.id),
            date: markDate,
            status: markStatuses[String(e.id)] ?? 'present',
          }));
          recordAttendance.mutate({ records }, {
            onSuccess: (data) => {
              setShowMarkModal(false);
              Alert.alert('Saved', `${data.saved} attendance record${data.saved !== 1 ? 's' : ''} saved.`);
            },
            onError: (e: Error) => Alert.alert('Error', e.message ?? 'Could not save attendance.'),
          });
        }}
        style={{
          height: 46, borderRadius: 12, backgroundColor: colors.brand,
          alignItems: 'center', justifyContent: 'center',
          opacity: recordAttendance.isPending || employees.length === 0 ? 0.6 : 1,
        }}
      >
        {recordAttendance.isPending ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>Save attendance</Text>
        )}
      </TouchableOpacity>
    </View>
  </View>
</Modal>
```

- [ ] **Step 2: Commit**

```bash
git add app/owner/payroll.tsx
git commit -m "feat(payroll): add mark attendance modal with bulk record"
```

---

## Self-Review

**Spec coverage:**
- ✅ `AttendanceStatusType`, `AttendanceSummaryDto`, `BulkAttendanceRecord`, `BulkAttendanceRequestDto` — Task 1
- ✅ `getAttendanceSummary()`, `bulkRecordAttendance()` — Task 2
- ✅ `useAttendanceSummary()`, `useBulkRecordAttendance()` — Task 3
- ✅ Route contract tests (2) — Task 4
- ✅ `'attendance'` tab added to type and tab bar — Task 5
- ✅ Period picker (month/year with chevrons) — Task 5
- ✅ Summary table with P/H/A/Eff columns, loading/error/empty states — Task 5
- ✅ Fixed "Mark attendance" button at bottom — Task 5
- ✅ Mark attendance modal with date picker + employee status toggles + submit — Task 6

**Type consistency:**
- `AttendanceStatusType` defined in Task 1; used in `markStatuses` (Task 5) and `BulkAttendanceRequestDto['records']` (Task 6) ✅
- `AttendanceSummaryDto` defined in Task 1; annotated in the `attendanceSummary.data` map in Task 5 ✅
- `BulkAttendanceRequestDto` defined in Task 1; used in `recordAttendance.mutate({ records })` in Task 6 ✅
- `useAttendanceSummary` called with `{ period_start: attPeriodStart, period_end: attPeriodEnd }` in Task 5 — matches signature in Task 3 ✅
- `useBulkRecordAttendance` called as `recordAttendance.mutate({ records })` in Task 6 — matches Task 3 ✅

**Placeholder scan:** None found.
