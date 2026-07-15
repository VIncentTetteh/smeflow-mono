import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { Text } from '@/components/ui/Text';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { useTheme } from '@/lib/theme';
import {
  useApprovePayrollRun,
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
import type { EmployeeDto, PayrollRunDto } from '@/types/payroll';
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';

type Tab = 'team' | 'history';

export default function PayrollScreen() {
  const { colors, fonts } = useTheme();
  const payrollQuery = usePayroll();
  const { data, isLoading } = payrollQuery;
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    await payrollQuery.refetch();
    setRefreshing(false);
  }
  const runPayroll = useRunPayroll();
  const createEmp = useCreateEmployee();
  const updateEmp = useUpdateEmployee();
  const disburse = useDisbursePayroll();
  const paySlip = usePayPayslip();
  const approveRun = useApprovePayrollRun();
  const downloadP9A = useDownloadP9A();
  const downloadP9B = useDownloadP9B();

  // ── Tab ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('team');

  // ── Add employee form ─────────────────────────────────────────────────────
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [empName, setEmpName] = useState('');
  const [empRole, setEmpRole] = useState('');
  const [empSalary, setEmpSalary] = useState('');
  const [empMomo, setEmpMomo] = useState('');

  // ── Edit employee form ────────────────────────────────────────────────────
  const [editingEmp, setEditingEmp] = useState<EmployeeDto | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editSalary, setEditSalary] = useState('');
  const [editMomo, setEditMomo] = useState('');

  // ── Run payroll period picker ─────────────────────────────────────────────
  const [showRunPicker, setShowRunPicker] = useState(false);
  const now = new Date();
  const [pickerYear, setPickerYear] = useState(now.getFullYear());
  const [pickerMonth, setPickerMonth] = useState(now.getMonth() + 1);

  // ── History ───────────────────────────────────────────────────────────────
  const [filterEmpId, setFilterEmpId] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const { data: expandedPayslips, isFetching: payslipsFetching } = useRunPayslips(expandedRunId);

  const employees = data?.employees ?? [];
  const runs = data?.runs ?? [];
  const latestRun = runs[0];

  const grossEstimate = employees.reduce((s, e) => s + Number(e.base_pay ?? 0), 0);
  const grossDisplay = latestRun ? Number(latestRun.total_gross ?? grossEstimate) : grossEstimate;
  const netDisplay = latestRun ? Number(latestRun.total_net ?? 0) : 0;
  const deductionsDisplay = latestRun
    ? Number(latestRun.total_deductions ?? (grossDisplay - netDisplay))
    : grossDisplay - netDisplay;

  function initials(name: string) {
    return name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  }

  function latestRunStatus(): 'paid' | 'pending' {
    if (!latestRun) return 'pending';
    return latestRun.status === 'disbursed' ? 'paid' : 'pending';
  }

  function runLabel(run: PayrollRunDto) {
    if (!run.period_start) return 'Unknown period';
    const d = new Date(run.period_start);
    return d.toLocaleString('default', { month: 'long', year: 'numeric' });
  }

  function statusColor(status?: string) {
    if (status === 'disbursed') return colors.brand;
    if (status === 'completed') return colors.gold;
    if (status === 'approved') return colors.brand;
    if (status === 'processing') return colors.info;
    return colors.muted;
  }

  function statusLabel(status?: string) {
    if (status === 'disbursed') return 'Disbursed';
    if (status === 'completed') return 'Completed';
    if (status === 'approved') return 'Approved';
    if (status === 'processing') return 'Processing';
    if (status === 'submitted') return 'Submitted';
    if (status === 'draft') return 'Draft';
    return status ?? 'Unknown';
  }

  function payslipStatus(
    slip: { payment_id?: string | null },
    runStatus?: string
  ): 'paid' | 'pending' | 'skipped' {
    if (slip.payment_id) return 'paid';
    if (runStatus === 'disbursed') return 'skipped'; // run was sent, but employee was skipped (no phone)
    return 'pending';
  }

  function openEdit(emp: EmployeeDto) {
    setEditingEmp(emp);
    setEditName(emp.name ?? '');
    setEditRole(emp.role ?? '');
    setEditSalary(String(emp.base_pay ?? ''));
    setEditMomo(emp.momo_phone ?? '');
  }

  function handleRunPayroll() {
    const start = new Date(pickerYear, pickerMonth - 1, 1);
    const end = new Date(pickerYear, pickerMonth, 0);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const monthName = start.toLocaleString('default', { month: 'long' });
    Alert.alert(
      'Run payroll?',
      `This will calculate and commit payroll for ${employees.length} employee(s) for ${monthName} ${pickerYear}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Run',
          style: 'default',
          onPress: () => {
            runPayroll.mutate(
              { period_start: fmt(start), period_end: fmt(end) },
              {
                onSuccess: () => {
                  setShowRunPicker(false);
                  Alert.alert('Payroll run', `Payroll for ${monthName} ${pickerYear} is being processed.`);
                },
                onError: (e: Error) => Alert.alert('Error', e.message),
              }
            );
          },
        },
      ]
    );
  }

  function handleSaveEdit() {
    if (!editingEmp) return;
    if (editSalary && (isNaN(Number(editSalary)) || Number(editSalary) <= 0)) {
      Alert.alert('Invalid salary', 'Enter a valid positive number.');
      return;
    }
    updateEmp.mutate(
      {
        id: String(editingEmp.id),
        body: {
          name: editName || undefined,
          role: editRole || undefined,
          base_pay: editSalary ? Number(editSalary) : undefined,
          momo_phone: editMomo || undefined,
        },
      },
      {
        onSuccess: () => {
          setEditingEmp(null);
          Alert.alert('Updated', `${editName} has been updated.`);
        },
        onError: (e: Error) => Alert.alert('Error', e.message),
      }
    );
  }

  function toggleExpand(runId: string) {
    setExpandedRunId((prev) => (prev === runId ? null : runId));
  }

  // Payslips filtered by selected employee (for history detail)
  const filteredPayslips = expandedPayslips
    ? filterEmpId
      ? expandedPayslips.filter((p) => String(p.employee_id) === filterEmpId)
      : expandedPayslips
    : [];

  // Employee map for name lookup in payslips
  const empMap = Object.fromEntries(employees.map((e) => [String(e.id), e]));

  if (isLoading) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}
        edges={['top']}
      >
        <ActivityIndicator color={colors.brand} size="large" />
      </SafeAreaView>
    );
  }

  const monthYear = now.toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {/* ── Header ── */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>
            Payroll
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>
            {monthYear} · {employees.length} staff · MoMo direct
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            onPress={() => setShowAddEmp(true)}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons name="plus" size={18} color={colors.ink} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowRunPicker(true)}
            disabled={runPayroll.isPending || employees.length === 0}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 10,
              backgroundColor: colors.brand,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              opacity: runPayroll.isPending || employees.length === 0 ? 0.6 : 1,
            }}
          >
            {runPayroll.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <MaterialCommunityIcons name="send" size={14} color="#fff" />
                <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: '#fff' }}>
                  Run
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <PlanGatedScreen feature="payroll">
      {/* ── Tab bar ── */}
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          paddingHorizontal: 16,
        }}
      >
        {(['team', 'history'] as Tab[]).map((tab) => (
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
              {tab === 'team' ? 'Team' : 'History'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ═══════════════════════════════════════════════════════════════
          TEAM TAB
      ═══════════════════════════════════════════════════════════════ */}
      {activeTab === 'team' && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />}
        >
          {/* Summary card */}
          <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
            <View
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 16,
                padding: 14,
              }}
            >
              <Text
                style={{
                  fontSize: 10.5,
                  color: colors.muted,
                  fontFamily: fonts.bodySemiBold,
                  textTransform: 'uppercase',
                  letterSpacing: 0.8,
                }}
              >
                {latestRun
                  ? `Last run · ${latestRun.status === 'disbursed' ? 'disbursed ✓' : latestRun.status}`
                  : 'Net payout estimate'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 2 }}>
                <Text
                  style={{
                    fontFamily: fonts.displaySemiBold,
                    fontSize: 30,
                    color: colors.ink,
                    letterSpacing: -0.5,
                  }}
                >
                  GH₵ {Math.round(latestRun ? netDisplay : grossEstimate).toLocaleString()}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
                {[
                  { label: 'Gross', value: `GH₵ ${Math.round(grossDisplay).toLocaleString()}` },
                  ...(latestRun
                    ? [{ label: 'Deductions', value: `GH₵ ${Math.round(deductionsDisplay).toLocaleString()}` }]
                    : []),
                ].map((s) => (
                  <Text key={s.label} style={{ fontSize: 11, color: colors.muted }}>
                    {s.label}{' '}
                    <Text style={{ fontFamily: fonts.mono, color: colors.ink } as never}>
                      {s.value}
                    </Text>
                  </Text>
                ))}
              </View>
              {(latestRun?.status === 'draft' || latestRun?.status === 'submitted') && (
                <TouchableOpacity
                  disabled={approveRun.isPending}
                  onPress={() => {
                    Alert.alert(
                      'Approve payroll?',
                      'This will lock the run and make it ready for disbursement.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Approve',
                          style: 'default',
                          onPress: () => {
                            approveRun.mutate(String(latestRun.id), {
                              onSuccess: () =>
                                Alert.alert('Approved', 'Payroll run has been approved.'),
                              onError: (e: Error) => Alert.alert('Error', e.message),
                            });
                          },
                        },
                      ]
                    );
                  }}
                  style={{
                    marginTop: 12,
                    height: 44,
                    borderRadius: 12,
                    backgroundColor: colors.brand,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    opacity: approveRun.isPending ? 0.6 : 1,
                  }}
                >
                  {approveRun.isPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <MaterialCommunityIcons name="check-circle-outline" size={15} color="#fff" />
                      <Text
                        style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#fff' }}
                      >
                        Approve payroll
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              {latestRun?.status === 'completed' && (
                <TouchableOpacity
                  disabled={disburse.isPending}
                  onPress={() => {
                    Alert.alert(
                      'Disburse payroll?',
                      `GH₵ ${Number(latestRun.total_net ?? 0).toLocaleString('en-GH')} will be sent to employees via MoMo. This cannot be undone.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Disburse',
                          style: 'destructive',
                          onPress: () => {
                            disburse.mutate(String(latestRun.id), {
                              onSuccess: () =>
                                Alert.alert('Disbursed', 'Payroll has been disbursed to all employees.'),
                              onError: (e: Error) => Alert.alert('Error', e.message),
                            });
                          },
                        },
                      ]
                    );
                  }}
                  style={{
                    marginTop: 12,
                    height: 44,
                    borderRadius: 12,
                    backgroundColor: colors.gold,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    opacity: disburse.isPending ? 0.6 : 1,
                  }}
                >
                  {disburse.isPending ? (
                    <ActivityIndicator size="small" color={colors.ink} />
                  ) : (
                    <>
                      <MaterialCommunityIcons name="send" size={15} color={colors.ink} />
                      <Text
                        style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink }}
                      >
                        Disburse payroll
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Employee list */}
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <Text
              style={{
                fontSize: 11,
                color: colors.muted,
                fontFamily: fonts.bodySemiBold,
                textTransform: 'uppercase',
                letterSpacing: 0.7,
                marginBottom: 6,
              }}
            >
              Team
            </Text>
            {employees.length === 0 && (
              <Text
                style={{ fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 32 }}
              >
                No employees yet
              </Text>
            )}
            {employees.map((emp) => {
              const status = latestRunStatus();
              return (
                <View
                  key={String(emp.id)}
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 14,
                    padding: 12,
                    marginBottom: 7,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 11,
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: colors.ink,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: '#fdf7eb' }}
                    >
                      {initials(emp.name ?? emp.phone ?? '??')}
                    </Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={{
                        fontSize: 13.5,
                        fontFamily: fonts.bodySemiBold,
                        color: colors.ink,
                      }}
                    >
                      {emp.name ?? emp.phone}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
                      {emp.role ?? 'Staff'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text
                      style={{
                        fontFamily: fonts.displaySemiBold,
                        fontSize: 14,
                        color: colors.ink,
                      }}
                    >
                      GH₵ {Number(emp.base_pay ?? 0).toLocaleString()}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Badge tone={status === 'paid' ? 'success' : 'warning'} label={status === 'paid' ? 'Paid' : 'Pending'} />
                      <TouchableOpacity onPress={() => openEdit(emp)} hitSlop={8}>
                        <MaterialCommunityIcons
                          name="pencil-outline"
                          size={15}
                          color={colors.muted}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          HISTORY TAB
      ═══════════════════════════════════════════════════════════════ */}
      {activeTab === 'history' && (
        <View style={{ flex: 1 }}>
          {/* Employee filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}
            style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border }}
          >
            <TouchableOpacity
              onPress={() => setFilterEmpId(null)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: !filterEmpId ? colors.brand : colors.surface,
                borderWidth: 1,
                borderColor: !filterEmpId ? colors.brand : colors.border,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: fonts.bodySemiBold,
                  color: !filterEmpId ? '#fff' : colors.muted,
                }}
              >
                All employees
              </Text>
            </TouchableOpacity>
            {employees.map((emp) => {
              const active = filterEmpId === String(emp.id);
              return (
                <TouchableOpacity
                  key={String(emp.id)}
                  onPress={() =>
                    setFilterEmpId(active ? null : String(emp.id))
                  }
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: active ? colors.brand : colors.surface,
                    borderWidth: 1,
                    borderColor: active ? colors.brand : colors.border,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: fonts.bodySemiBold,
                      color: active ? '#fff' : colors.muted,
                    }}
                  >
                    {emp.name ?? emp.phone ?? 'Staff'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Runs list */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />}
          >
            {/* Tax reports section */}
            <View
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 14,
                padding: 12,
                marginBottom: 14,
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  color: colors.muted,
                  fontFamily: fonts.bodySemiBold,
                  textTransform: 'uppercase',
                  letterSpacing: 0.7,
                  marginBottom: 10,
                }}
              >
                Tax Reports
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  disabled={downloadP9A.isPending}
                  onPress={() => downloadP9A.mutate(undefined, {
                    onError: (e: Error) => Alert.alert('Download failed', e.message),
                  })}
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    paddingVertical: 10,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.bg,
                    opacity: downloadP9A.isPending ? 0.6 : 1,
                  }}
                >
                  {downloadP9A.isPending ? (
                    <ActivityIndicator size="small" color={colors.brand} />
                  ) : (
                    <>
                      <MaterialCommunityIcons name="file-download-outline" size={15} color={colors.brand} />
                      <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.brand }}>
                        P9A Report
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={downloadP9B.isPending}
                  onPress={() => downloadP9B.mutate(undefined, {
                    onError: (e: Error) => Alert.alert('Download failed', e.message),
                  })}
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    paddingVertical: 10,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.bg,
                    opacity: downloadP9B.isPending ? 0.6 : 1,
                  }}
                >
                  {downloadP9B.isPending ? (
                    <ActivityIndicator size="small" color={colors.brand} />
                  ) : (
                    <>
                      <MaterialCommunityIcons name="file-download-outline" size={15} color={colors.brand} />
                      <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.brand }}>
                        P9B Report
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {runs.length === 0 && (
              <Text
                style={{
                  fontSize: 13,
                  color: colors.muted,
                  textAlign: 'center',
                  marginTop: 48,
                }}
              >
                No payroll runs yet
              </Text>
            )}
            {runs.map((run) => {
              const isExpanded = expandedRunId === String(run.id);
              const runNet = Number(run.total_net ?? 0);
              const runGross = Number(run.total_gross ?? 0);
              return (
                <View
                  key={String(run.id)}
                  style={{
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 14,
                    marginBottom: 10,
                    overflow: 'hidden',
                  }}
                >
                  {/* Run header row */}
                  <TouchableOpacity
                    onPress={() => toggleExpand(String(run.id))}
                    style={{
                      padding: 14,
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: 14,
                          fontFamily: fonts.bodySemiBold,
                          color: colors.ink,
                        }}
                      >
                        {runLabel(run)}
                      </Text>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          marginTop: 2,
                        }}
                      >
                        <View
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: statusColor(run.status),
                          }}
                        />
                        <Text style={{ fontSize: 11, color: colors.muted }}>
                          {statusLabel(run.status)}
                        </Text>
                        <Text style={{ fontSize: 11, color: colors.muted }}>·</Text>
                        <Text style={{ fontSize: 11, color: colors.muted }}>
                          Gross GH₵ {Math.round(runGross).toLocaleString()}
                        </Text>
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Text
                        style={{
                          fontFamily: fonts.displaySemiBold,
                          fontSize: 16,
                          color: colors.ink,
                        }}
                      >
                        GH₵ {Math.round(runNet).toLocaleString()}
                      </Text>
                      <Text style={{ fontSize: 10, color: colors.muted }}>net pay</Text>
                    </View>
                    <MaterialCommunityIcons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={colors.muted}
                      style={{ marginLeft: 8 }}
                    />
                  </TouchableOpacity>

                  {/* Expanded payslips */}
                  {isExpanded && (
                    <View
                      style={{
                        borderTopWidth: 1,
                        borderTopColor: colors.border,
                        paddingHorizontal: 14,
                        paddingBottom: 10,
                        paddingTop: 8,
                      }}
                    >
                      {payslipsFetching && (
                        <ActivityIndicator
                          size="small"
                          color={colors.brand}
                          style={{ marginVertical: 12 }}
                        />
                      )}
                      {!payslipsFetching && filteredPayslips.length === 0 && (
                        <Text
                          style={{
                            fontSize: 12,
                            color: colors.muted,
                            textAlign: 'center',
                            paddingVertical: 12,
                          }}
                        >
                          {filterEmpId
                            ? 'This employee was not in this payroll run'
                            : 'No payslip data'}
                        </Text>
                      )}
                      {filteredPayslips.map((slip) => {
                        const emp = empMap[String(slip.employee_id)];
                        const net = Number(slip.net_pay);
                        const gross = Number(slip.gross_pay);
                        const deductions = gross - net;
                        const slipStatus = payslipStatus(slip, run.status);
                        const isPaying = paySlip.isPending && paySlip.variables === String(slip.id);

                        const statusStyles: Record<string, { tone: BadgeTone; label: string }> = {
                          paid:    { tone: 'success', label: 'Paid' },
                          pending: { tone: 'warning', label: 'Pending' },
                          skipped: { tone: 'danger',  label: 'Skipped' },
                        };
                        const ss = statusStyles[slipStatus];

                        return (
                          <View
                            key={String(slip.id)}
                            style={{
                              paddingVertical: 10,
                              borderBottomWidth: 1,
                              borderBottomColor: colors.border,
                              gap: 6,
                            }}
                          >
                            {/* Employee row */}
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <View
                                style={{
                                  width: 30,
                                  height: 30,
                                  borderRadius: 15,
                                  backgroundColor: `${colors.brand}20`,
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  marginRight: 10,
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 10,
                                    fontFamily: fonts.bodySemiBold,
                                    color: colors.brand,
                                  }}
                                >
                                  {initials(emp?.name ?? emp?.phone ?? '??')}
                                </Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text
                                  style={{
                                    fontSize: 12.5,
                                    fontFamily: fonts.bodySemiBold,
                                    color: colors.ink,
                                  }}
                                >
                                  {emp?.name ?? emp?.phone ?? 'Employee'}
                                </Text>
                                <Text style={{ fontSize: 10.5, color: colors.muted }}>
                                  Gross GH₵ {Math.round(gross).toLocaleString()} · Deductions GH₵{' '}
                                  {Math.round(deductions).toLocaleString()}
                                </Text>
                                {!(emp?.momo_phone ?? emp?.phone) && (
                                  <Text style={{ fontSize: 10, color: '#dc2626', marginTop: 1 }}>
                                    No MoMo number — edit on Team tab
                                  </Text>
                                )}
                              </View>
                              <View style={{ alignItems: 'flex-end', gap: 3 }}>
                                <Text
                                  style={{
                                    fontSize: 13,
                                    fontFamily: fonts.displaySemiBold,
                                    color: colors.ink,
                                  }}
                                >
                                  GH₵ {Math.round(net).toLocaleString()}
                                </Text>
                                <Badge tone={ss.tone} label={ss.label} />
                              </View>
                            </View>

                            {/* Pay / Repay action + Open PDF */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-end' }}>
                              {slip.pdf_url != null && (
                                <TouchableOpacity
                                  onPress={() =>
                                    Linking.openURL(slip.pdf_url!).catch(() =>
                                      Alert.alert('Cannot open PDF', 'The PDF could not be opened on this device.')
                                    )
                                  }
                                  style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    gap: 4,
                                    paddingHorizontal: 10,
                                    paddingVertical: 5,
                                    borderRadius: 8,
                                    borderWidth: 1,
                                    borderColor: colors.border,
                                    backgroundColor: 'transparent',
                                  }}
                                >
                                  <MaterialCommunityIcons
                                    name="file-pdf-box"
                                    size={12}
                                    color={colors.muted}
                                  />
                                  <Text
                                    style={{
                                      fontSize: 11,
                                      fontFamily: fonts.bodySemiBold,
                                      color: colors.muted,
                                    }}
                                  >
                                    Open PDF
                                  </Text>
                                </TouchableOpacity>
                              )}
                              <TouchableOpacity
                                disabled={isPaying}
                                onPress={() => {
                                  const action = slipStatus === 'paid' ? 'Repay' : 'Pay';
                                  const empName = emp?.name ?? emp?.phone ?? 'this employee';
                                  const momoPhone = emp?.momo_phone ?? emp?.phone;

                                  // Guard: employee has no MoMo number — direct user to fix it
                                  if (!momoPhone) {
                                    Alert.alert(
                                      'No MoMo number',
                                      `${empName} has no MoMo number on file. Edit their record on the Team tab to add one.`,
                                      [{ text: 'OK' }]
                                    );
                                    return;
                                  }

                                  Alert.alert(
                                    `${action} ${empName}`,
                                    `Send GH₵ ${Math.round(net).toLocaleString()} to ${momoPhone} via MoMo?`,
                                    [
                                      { text: 'Cancel', style: 'cancel' },
                                      {
                                        text: action,
                                        onPress: () =>
                                          paySlip.mutate(String(slip.id), {
                                            onSuccess: () =>
                                              Alert.alert('Sent', `Payment sent to ${empName}.`),
                                            onError: (e: Error) =>
                                              Alert.alert('Payment failed', e.message),
                                          }),
                                      },
                                    ]
                                  );
                                }}
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: 4,
                                  paddingHorizontal: 10,
                                  paddingVertical: 5,
                                  borderRadius: 8,
                                  borderWidth: 1,
                                  borderColor: slipStatus === 'paid' ? colors.border : colors.brand,
                                  backgroundColor:
                                    slipStatus === 'paid' ? 'transparent' : `${colors.brand}10`,
                                  opacity: isPaying ? 0.5 : 1,
                                }}
                              >
                                {isPaying ? (
                                  <ActivityIndicator size="small" color={colors.brand} />
                                ) : (
                                  <>
                                    <MaterialCommunityIcons
                                      name="send-outline"
                                      size={12}
                                      color={slipStatus === 'paid' ? colors.muted : colors.brand}
                                    />
                                    <Text
                                      style={{
                                        fontSize: 11,
                                        fontFamily: fonts.bodySemiBold,
                                        color: slipStatus === 'paid' ? colors.muted : colors.brand,
                                      }}
                                    >
                                      {slipStatus === 'paid' ? 'Repay' : 'Pay now'}
                                    </Text>
                                  </>
                                )}
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* ─── Period picker modal ─────────────────────────────────────────── */}
      <Modal
        visible={showRunPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRunPicker(false)}
      >
        <View style={{ flex: 1 }}>
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
            activeOpacity={1}
            onPress={() => setShowRunPicker(false)}
          />
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: 20,
              paddingBottom: 34,
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontFamily: fonts.displaySemiBold,
                color: colors.ink,
                marginBottom: 4,
              }}
            >
              Select payroll period
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 16 }}>
              Choose the month to process payroll for
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                marginBottom: 20,
              }}
            >
              <TouchableOpacity
                onPress={() => {
                  if (pickerMonth === 1) {
                    setPickerMonth(12);
                    setPickerYear((y) => y - 1);
                  } else {
                    setPickerMonth((m) => m - 1);
                  }
                }}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <MaterialCommunityIcons name="chevron-left" size={20} color={colors.ink} />
              </TouchableOpacity>
              <View style={{ alignItems: 'center', minWidth: 120 }}>
                <Text
                  style={{
                    fontSize: 20,
                    fontFamily: fonts.displaySemiBold,
                    color: colors.ink,
                  }}
                >
                  {new Date(pickerYear, pickerMonth - 1, 1).toLocaleString('default', {
                    month: 'long',
                  })}
                </Text>
                <Text style={{ fontSize: 13, color: colors.muted }}>{pickerYear}</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  if (pickerMonth === 12) {
                    setPickerMonth(1);
                    setPickerYear((y) => y + 1);
                  } else {
                    setPickerMonth((m) => m + 1);
                  }
                }}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.ink} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              disabled={runPayroll.isPending}
              onPress={handleRunPayroll}
              style={{
                height: 46,
                borderRadius: 12,
                backgroundColor: colors.brand,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: runPayroll.isPending ? 0.6 : 1,
              }}
            >
              {runPayroll.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>
                  Run payroll
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── Add employee modal ──────────────────────────────────────────── */}
      <Modal
        visible={showAddEmp}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddEmp(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
            activeOpacity={1}
            onPress={() => setShowAddEmp(false)}
          />
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
            }}
          >
            <ScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ padding: 20, paddingBottom: 8 }}
            >
              <Text
                style={{
                  fontSize: 16,
                  fontFamily: fonts.displaySemiBold,
                  color: colors.ink,
                  marginBottom: 14,
                }}
              >
                Add Employee
              </Text>
              {[
                {
                  label: 'FULL NAME',
                  value: empName,
                  onChange: setEmpName,
                  placeholder: 'Abena Asante',
                  keyboard: 'default' as const,
                },
                {
                  label: 'ROLE / TITLE',
                  value: empRole,
                  onChange: setEmpRole,
                  placeholder: 'Sales Associate',
                  keyboard: 'default' as const,
                },
                {
                  label: 'MONTHLY SALARY (GH₵)',
                  value: empSalary,
                  onChange: setEmpSalary,
                  placeholder: '1200',
                  keyboard: 'numeric' as const,
                },
                {
                  label: 'MOMO NUMBER (OPTIONAL)',
                  value: empMomo,
                  onChange: setEmpMomo,
                  placeholder: '0244000000',
                  keyboard: 'phone-pad' as const,
                },
              ].map((field) => (
                <View key={field.label} style={{ marginBottom: 10 }}>
                  <Text
                    style={{
                      fontSize: 11,
                      color: colors.muted,
                      fontFamily: fonts.bodySemiBold,
                      letterSpacing: 0.6,
                      marginBottom: 4,
                    }}
                  >
                    {field.label}
                  </Text>
                  <TextInput
                    value={field.value}
                    onChangeText={field.onChange}
                    keyboardType={field.keyboard}
                    placeholder={field.placeholder}
                    placeholderTextColor={colors.muted}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      fontSize: 14,
                      color: colors.ink,
                      backgroundColor: colors.bg,
                    }}
                  />
                </View>
              ))}
            </ScrollView>
            <View style={{ paddingHorizontal: 20, paddingBottom: 34, paddingTop: 4 }}>
              <TouchableOpacity
                disabled={createEmp.isPending || !empName || !empRole || !empSalary}
                onPress={() => {
                  if (isNaN(Number(empSalary)) || Number(empSalary) <= 0) {
                    Alert.alert('Invalid salary', 'Enter a valid positive number.');
                    return;
                  }
                  createEmp.mutate(
                    { name: empName, role: empRole, base_pay: Number(empSalary), momo_phone: empMomo || undefined },
                    {
                      onSuccess: () => {
                        setShowAddEmp(false);
                        setEmpName('');
                        setEmpRole('');
                        setEmpSalary('');
                        setEmpMomo('');
                        Alert.alert('Added', `${empName} added to payroll.`);
                      },
                      onError: (e: Error) => Alert.alert('Error', e.message),
                    }
                  );
                }}
                style={{
                  height: 46,
                  borderRadius: 12,
                  backgroundColor: colors.brand,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: createEmp.isPending || !empName || !empRole || !empSalary ? 0.6 : 1,
                }}
              >
                {createEmp.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>
                    Add Employee
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Edit employee modal ─────────────────────────────────────────── */}
      <Modal
        visible={!!editingEmp}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingEmp(null)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
            activeOpacity={1}
            onPress={() => setEditingEmp(null)}
          />
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
            }}
          >
            <ScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ padding: 20, paddingBottom: 8 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                <Text
                  style={{
                    flex: 1,
                    fontSize: 16,
                    fontFamily: fonts.displaySemiBold,
                    color: colors.ink,
                  }}
                >
                  Edit Employee
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    Alert.alert(
                      'Deactivate employee',
                      `Remove ${editingEmp?.name ?? 'this employee'} from payroll?`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Deactivate',
                          style: 'destructive',
                          onPress: () => {
                            updateEmp.mutate(
                              { id: String(editingEmp?.id), body: { is_active: false } },
                              {
                                onSuccess: () => {
                                  setEditingEmp(null);
                                  Alert.alert('Deactivated', 'Employee removed from payroll.');
                                },
                                onError: (e: Error) => Alert.alert('Error', e.message),
                              }
                            );
                          },
                        },
                      ]
                    );
                  }}
                >
                  <MaterialCommunityIcons name="account-remove-outline" size={20} color="#ef4444" />
                </TouchableOpacity>
              </View>
              {[
                {
                  label: 'FULL NAME',
                  value: editName,
                  onChange: setEditName,
                  placeholder: 'Abena Asante',
                  keyboard: 'default' as const,
                },
                {
                  label: 'ROLE / TITLE',
                  value: editRole,
                  onChange: setEditRole,
                  placeholder: 'Sales Associate',
                  keyboard: 'default' as const,
                },
                {
                  label: 'MONTHLY SALARY (GH₵)',
                  value: editSalary,
                  onChange: setEditSalary,
                  placeholder: '1200',
                  keyboard: 'numeric' as const,
                },
                {
                  label: 'MOMO NUMBER',
                  value: editMomo,
                  onChange: setEditMomo,
                  placeholder: '0244000000',
                  keyboard: 'phone-pad' as const,
                },
              ].map((field) => (
                <View key={field.label} style={{ marginBottom: 10 }}>
                  <Text
                    style={{
                      fontSize: 11,
                      color: colors.muted,
                      fontFamily: fonts.bodySemiBold,
                      letterSpacing: 0.6,
                      marginBottom: 4,
                    }}
                  >
                    {field.label}
                  </Text>
                  <TextInput
                    value={field.value}
                    onChangeText={field.onChange}
                    keyboardType={field.keyboard}
                    placeholder={field.placeholder}
                    placeholderTextColor={colors.muted}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      fontSize: 14,
                      color: colors.ink,
                      backgroundColor: colors.bg,
                    }}
                  />
                </View>
              ))}
            </ScrollView>
            <View style={{ paddingHorizontal: 20, paddingBottom: 34, paddingTop: 4 }}>
              <TouchableOpacity
                disabled={updateEmp.isPending || !editName || !editRole || !editSalary}
                onPress={handleSaveEdit}
                style={{
                  height: 46,
                  borderRadius: 12,
                  backgroundColor: colors.brand,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: updateEmp.isPending || !editName || !editRole || !editSalary ? 0.6 : 1,
                }}
              >
                {updateEmp.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>
                    Save changes
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      </PlanGatedScreen>
    </SafeAreaView>
  );
}
