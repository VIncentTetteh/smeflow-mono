# Attendance Tracking Design

**Date:** 2026-06-05
**Status:** Approved

## Context

The backend has 4 attendance endpoints. The mobile payroll screen (`payroll.tsx`) has two tabs — Team and History — with zero attendance functionality. This spec adds a 3rd tab and a mark-attendance modal.

---

## Navigation

Add `'attendance'` to the payroll tab type:

```typescript
type Tab = 'team' | 'attendance' | 'history';
```

Tab bar order: **Team → Attendance → History**

---

## Attendance Tab

### Period Selector

A simple month picker row (chevron left/right + "Month Year" label) at the top of the tab, similar to the period picker in the existing payroll run flow. Defaults to the current month. Controls `period_start` / `period_end` used for the summary query.

### Summary Table

API: `GET /api/v1/payroll/attendance/summary?period_start=YYYY-MM-DD&period_end=YYYY-MM-DD`

Response: array of `AttendanceSummaryDto`:
```json
{
  "employee_id": "uuid",
  "employee_name": "Ama Mensah",
  "present": 15,
  "half_day": 2,
  "absent": 3,
  "total_days": 20,
  "effective_days": 16.0
}
```

Display: card/table with one row per employee. Columns:
| Employee | Present | Half | Absent | Effective |
|---|---|---|---|---|
| Ama Mensah | 15 | 2 | 3 | 16.0 |

Loading state: `ActivityIndicator`. Error state: message + Retry button. Empty state: "No attendance recorded for this period. Tap 'Mark attendance' to start."

### Mark Attendance Button

Primary action button at the bottom of the tab (fixed, above safe area). Label: "Mark attendance". Opens the Mark Attendance modal.

---

## Mark Attendance Modal

Bottom-sheet modal. Contains:

1. **Date picker row** — chevron left/right + current date label. Defaults to today. Merchant can move backward/forward by one day.

2. **Employee list** — one row per active employee. Each row has:
   - Employee name + role
   - 3-segment toggle: `P` (Present, green), `H` (Half-day, amber), `A` (Absent, red)
   - Default: all employees start as `P` (Present) when modal opens

3. **Submit button** — "Save attendance". On press:
   - Calls `POST /api/v1/payroll/attendance/bulk` with body:
     ```json
     {
       "records": [
         { "employee_id": "uuid", "date": "2026-06-05", "status": "present" },
         { "employee_id": "uuid", "date": "2026-06-05", "status": "absent" }
       ]
     }
     ```
   - On success: close modal, invalidate attendance summary query, show `Alert.alert('Saved', 'X attendance records saved.')`
   - On error: `Alert.alert('Error', message)`
   - Loading state: `ActivityIndicator` on submit button

---

## New Types — additions to `src/types/payroll.ts`

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

---

## New API Functions — additions to `src/api/payroll.api.ts`

```typescript
export async function getAttendanceSummary(params: {
  period_start: string;
  period_end: string;
}): Promise<AttendanceSummaryDto[]>
// GET /api/v1/payroll/attendance/summary

export async function bulkRecordAttendance(
  body: BulkAttendanceRequestDto
): Promise<{ saved: number; errors?: unknown[] }>
// POST /api/v1/payroll/attendance/bulk
```

---

## New Hooks — additions to `src/api/hooks/featureHooks.ts`

```typescript
useAttendanceSummary(params)  // useQuery, queryKey ['attendance-summary', params], staleTime 30_000, retry 1
useBulkRecordAttendance()     // useMutation, onSuccess invalidates ['attendance-summary']
```

---

## Changes to `app/owner/payroll.tsx`

1. Change `type Tab = 'team' | 'history'` → `'team' | 'attendance' | 'history'`
2. Add `Attendance` button to the tab bar (between Team and History)
3. Add attendance tab state variables:
   - `attendanceYear`, `attendanceMonth` (int states for period picker)
   - `showMarkModal` (bool for the mark attendance modal)
   - `markDate` (string, default today YYYY-MM-DD)
   - `markStatuses` (Record<string, AttendanceStatusType> — employee_id → status)
4. Import and instantiate `useAttendanceSummary` and `useBulkRecordAttendance`
5. Add `{activeTab === 'attendance' && (...)}` section with period picker, summary table, and mark button
6. Add the mark attendance Modal

---

## Out of Scope

- Per-employee day-by-day history view (`GET /payroll/employees/{id}/attendance`)
- Hours-worked field on individual records (status only)
- CSV bulk import of attendance
- Attendance-linked payroll calculation (the summary data feeds into this, but automatic deductions from base salary are backend logic)

---

## Verification

1. Open Payroll → Attendance tab → summary loads for current month
2. Change month using chevron → summary refreshes
3. Tap "Mark attendance" → modal opens with today's date and all employees defaulting to Present
4. Toggle Ama Mensah to Absent → tap Save → `POST /payroll/attendance/bulk` fires → summary refreshes
5. Network tab: confirm `GET /payroll/attendance/summary` and `POST /payroll/attendance/bulk` hit versioned routes
