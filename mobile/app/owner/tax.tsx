import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { useFileTaxReturn, useGenerateTaxReturn, useInputVATList, useRecordInputVAT, useTaxRates, useTaxWorkspace } from '@/api/hooks/featureHooks';
import { useTheme } from '@/lib/theme';
import { generateAndShareTaxPDF } from '@/lib/taxPdfGenerator';
import { useAuthStore } from '@/store/auth';
import type { TaxReturnDto, TaxSummaryDto } from '@/types/tax';

function money(value?: string | number | null) {
  return `GH₵ ${Number(value ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value?: string | null) {
  if (!value) return 'Not set';
  return new Date(value).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function TaxScreen() {
  const { colors, fonts } = useTheme();
  const taxWorkspace = useTaxWorkspace();
  const { data } = taxWorkspace;
  const business = useAuthStore((s) => s.business);

  const summary = data?.summary;
  const returns = data?.returns ?? [];
  const calendar = data?.calendar ?? [];

  const now = new Date();
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const periodLabel = summary?.month != null && summary?.year != null
    ? `${monthNames[(summary.month - 1) % 12]} ${summary.year}`
    : `${monthNames[now.getMonth()]} ${now.getFullYear()}`;

  const generateReturn = useGenerateTaxReturn();
  const fileReturn = useFileTaxReturn();
  const recordInputVAT = useRecordInputVAT();
  const taxRates = useTaxRates();
  const inputVATList = useInputVATList();
  const [pdfGenerating, setPdfGenerating] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [showInputVAT, setShowInputVAT] = useState(false);
  const [ivSupplier, setIvSupplier] = useState('');
  const [ivSupplierTin, setIvSupplierTin] = useState('');
  const [ivInvoiceRef, setIvInvoiceRef] = useState('');
  const [ivSubtotal, setIvSubtotal] = useState('');
  const [ivVatAmount, setIvVatAmount] = useState('');
  const [ivDate, setIvDate] = useState(() => new Date().toISOString().slice(0, 10));

  const sortedReturns = [...returns].sort((a, b) => {
    const aTime = new Date(a.period_start ?? a.created_at ?? 0).getTime();
    const bTime = new Date(b.period_start ?? b.created_at ?? 0).getTime();
    return bTime - aTime;
  });
  const currentReturn = sortedReturns.find((r) => {
    if (!summary?.year || !summary?.month || !r.period_start) return false;
    const period = new Date(r.period_start);
    return period.getFullYear() === summary.year && period.getMonth() + 1 === summary.month;
  }) ?? sortedReturns.find((r) => r.status === 'draft')
    ?? sortedReturns.find((r) => r.status === 'exported')
    ?? sortedReturns[0];
  const readiness = summary?.filing_readiness;
  const hasDraft = readiness?.has_generated_return ?? !!currentReturn;
  const canFile = readiness?.can_file ?? !!currentReturn;
  const dueDate = summary?.due_date ?? calendar.find((c) => c.due_date)?.due_date ?? null;
  const upcomingDeadlines = calendar.filter((c) => c.due_date);

  const breakdown = [
    { label: 'Output VAT', value: summary?.vat_output, tone: colors.ink, icon: 'receipt-text-outline' },
    { label: 'Input VAT', value: summary?.vat_input, tone: colors.brand, icon: 'receipt-outline' },
    { label: 'Net VAT', value: summary?.vat_payable, tone: '#b6831e', icon: 'scale-balance' },
    { label: 'NHIL', value: summary?.nhil, tone: colors.ink, icon: 'bank-outline' },
    { label: 'GETFund', value: summary?.getfund, tone: colors.ink, icon: 'school-outline' },
    { label: 'COVID levy', value: summary?.covid_levy, tone: colors.ink, icon: 'shield-plus-outline' },
    { label: 'PAYE withheld', value: summary?.paye_withheld, tone: colors.brand, icon: 'account-cash-outline' },
    { label: 'Est. income tax', value: summary?.estimated_income_tax, tone: colors.ink, icon: 'chart-timeline-variant' },
  ];

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([
      taxWorkspace.refetch(),
      inputVATList.refetch(),
      taxRates.refetch(),
    ]);
    setRefreshing(false);
  }

  function handleGenerateReturn() {
    const year = summary?.year ?? now.getFullYear();
    const month = summary?.month ?? now.getMonth() + 1;
    generateReturn.mutate(
      { year, month },
      {
        onSuccess: () => Alert.alert('Draft refreshed', 'Your tax return now reflects the latest invoices, sales, and input VAT.'),
        onError: (e: Error) => Alert.alert('Error', e.message),
      }
    );
  }

  function handleFileReturn() {
    if (!currentReturn) {
      Alert.alert('Prepare draft first', 'Refresh the draft return before filing so the latest sales and purchase VAT are included.');
      return;
    }
    fileReturn.mutate(currentReturn.id, {
      onSuccess: (result) => {
        if (result.is_dry_run) {
          Alert.alert(
            'Return exported — not yet filed',
            `Your return has been prepared and saved.\n\nTo file officially, log in to GRA e-Services (eTax.gra.gov.gh) and submit the return, or contact GRA for direct e-filing access.\n\nRef: ${result.gra_ref ?? ''}`
          );
        } else {
          Alert.alert('Filed with GRA', `Return submitted successfully.\nGRA Ref: ${result.gra_ref ?? 'pending'}`);
        }
        void taxWorkspace.refetch();
      },
      onError: (e: Error) => Alert.alert('Error', e.message),
    });
  }

  async function handleDownloadPdf(r: TaxReturnDto, s?: TaxSummaryDto) {
    if (pdfGenerating) return;
    setPdfGenerating(true);
    try {
      const periodDate = r.period_start ? new Date(r.period_start) : now;
      const pLabel = periodDate.toLocaleString('default', { month: 'long', year: 'numeric' });
      await generateAndShareTaxPDF({
        businessName: business?.name ?? 'Your Business',
        businessType: business?.type ?? null,
        businessTin: business?.tin ?? null,
        businessAddress: business?.address ?? null,
        periodLabel: pLabel,
        periodStart: r.period_start ?? '',
        periodEnd: r.period_end ?? '',
        dueDate: s?.due_date ?? null,
        vatOutput: Number(r.vat_output ?? s?.vat_output ?? 0),
        vatInput: Number(r.vat_input ?? s?.vat_input ?? 0),
        vatPayable: Number(r.vat_payable ?? s?.vat_payable ?? 0),
        nhil: Number(r.nhil_amount ?? s?.nhil ?? 0),
        getfund: Number(r.getfund_amount ?? s?.getfund ?? 0),
        covidLevy: Number(r.covid_levy ?? s?.covid_levy ?? 0),
        totalTax: Number(r.total_tax ?? s?.total_tax ?? 0),
        status: r.status ?? 'draft',
        graRef: r.gra_ref ?? null,
        submittedAt: r.submitted_at ?? null,
        generatedAt: new Date().toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' }),
      });
    } catch (err) {
      Alert.alert('PDF Error', String(err));
    } finally {
      setPdfGenerating(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Tax · GRA</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>Auto-prepared from sales, invoices, and input VAT</Text>
          </View>
          <TouchableOpacity
            onPress={() => setShowInputVAT(true)}
            style={{
              paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10,
              borderWidth: 1, borderColor: colors.border,
              flexDirection: 'row', alignItems: 'center', gap: 5,
            }}
          >
            <MaterialCommunityIcons name="receipt-outline" size={14} color={colors.ink} />
            <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Input VAT</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 14 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />}
      >
        {taxWorkspace.isLoading && (
          <View style={{ paddingVertical: 28, alignItems: 'center' }}>
            <ActivityIndicator color={colors.brand} />
          </View>
        )}
        {taxWorkspace.isError && (
          <View style={{ backgroundColor: `${colors.danger}10`, borderWidth: 1, borderColor: `${colors.danger}30`, borderRadius: 12, padding: 12 }}>
            <Text style={{ fontSize: 13, color: colors.danger, fontFamily: fonts.bodySemiBold }}>Could not load tax workspace</Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>Pull down to retry.</Text>
          </View>
        )}

        <View style={{ backgroundColor: colors.ink, borderRadius: 18, padding: 18, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(212,162,58,0.15)' }} />
          <Text style={{ fontSize: 10.5, fontFamily: fonts.bodySemiBold, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(245,239,225,0.55)' }}>
            {periodLabel} return · due {formatDate(dueDate)}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 6 }}>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 34, color: '#f5efe1' }}>
              {money(summary?.total_tax ?? summary?.vat_payable)}
            </Text>
            <Text style={{ fontSize: 12, color: 'rgba(245,239,225,0.6)' }}>total due</Text>
          </View>
          <Text style={{ fontSize: 12, color: 'rgba(245,239,225,0.72)', marginTop: 6 }}>
            Sales receipts add output VAT automatically. Purchase invoices recorded as input VAT reduce the amount due.
          </Text>

          <View style={{ marginTop: 13, flexDirection: 'row', gap: 8 }}>
            {[
              { label: hasDraft ? 'Draft ready' : 'Draft needed', ok: hasDraft },
              { label: canFile ? 'Ready to file' : 'Review first', ok: canFile },
              { label: readiness?.has_gra_ref ? 'GRA ref saved' : 'No GRA ref', ok: !!readiness?.has_gra_ref },
            ].map((item) => (
              <View key={item.label} style={{ flex: 1, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 10, backgroundColor: item.ok ? 'rgba(255,255,255,0.12)' : 'rgba(212,162,58,0.16)' }}>
                <Text style={{ fontSize: 10.5, color: '#f5efe1', fontFamily: fonts.bodySemiBold }}>{item.label}</Text>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 14, flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              disabled={fileReturn.isPending || !canFile}
              onPress={handleFileReturn}
              style={{
                paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10,
                backgroundColor: fileReturn.isPending || !canFile ? 'rgba(212,162,58,0.5)' : colors.gold,
                flexDirection: 'row', alignItems: 'center', gap: 6,
              }}>
              <MaterialCommunityIcons name="send" size={14} color={colors.ink} />
              <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                {fileReturn.isPending ? 'Filing...' : 'File to GRA'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={generateReturn.isPending}
              onPress={handleGenerateReturn}
              style={{
                paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10,
                borderWidth: 1, borderColor: 'rgba(245,239,225,0.3)',
                opacity: generateReturn.isPending ? 0.5 : 1,
              }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: '#fdf7eb' }}>
                {generateReturn.isPending ? 'Refreshing...' : 'Refresh draft'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={pdfGenerating || !currentReturn}
              onPress={() => currentReturn && void handleDownloadPdf(currentReturn, summary)}
              style={{
                width: 38, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(245,239,225,0.3)',
                alignItems: 'center', justifyContent: 'center', opacity: (pdfGenerating || !currentReturn) ? 0.5 : 1,
              }}>
              {pdfGenerating
                ? <ActivityIndicator size="small" color="#fdf7eb" />
                : <MaterialCommunityIcons name="file-pdf-box" size={18} color="#fdf7eb" />
              }
            </TouchableOpacity>
          </View>

          {taxRates.data && (
            <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(245,239,225,0.15)', paddingTop: 12 }}>
              <Text style={{ fontSize: 10, fontFamily: fonts.bodySemiBold, letterSpacing: 0.7, textTransform: 'uppercase', color: 'rgba(245,239,225,0.5)', marginBottom: 8 }}>
                Effective rates
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[
                  { label: 'VAT', value: taxRates.data.vat },
                  { label: 'NHIL', value: taxRates.data.nhil },
                  { label: 'GETFund', value: taxRates.data.getfund },
                  { label: 'COVID Levy', value: taxRates.data.covid_levy },
                ].map((rate) => (
                  <View key={rate.label} style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)' }}>
                    <Text style={{ fontSize: 10, color: 'rgba(245,239,225,0.55)', fontFamily: fonts.bodySemiBold }}>{rate.label}</Text>
                    <Text style={{ fontSize: 12, color: '#f5efe1', fontFamily: fonts.displaySemiBold }}>
                      {(rate.value * 100).toFixed(1)}%
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {breakdown.map((item) => (
            <View key={item.label} style={{
              width: '48%',
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 14,
              padding: 12,
            }}>
              <MaterialCommunityIcons name={item.icon as never} size={16} color={item.tone} />
              <Text style={{ fontSize: 10, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 7 }}>
                {item.label}
              </Text>
              <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 15, color: item.tone, marginTop: 2 }}>
                {money(item.value)}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14, gap: 10 }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 15, color: colors.ink }}>How this return is built</Text>
          {[
            { icon: 'cash-register', text: 'Every recorded sale creates a receipt and adds output VAT to this period.' },
            { icon: 'receipt-outline', text: 'Record supplier VAT here so legitimate input VAT is deducted automatically.' },
            { icon: 'file-check-outline', text: 'SMEflow prepares the draft return; you review, export, or file when ready.' },
          ].map((row) => (
            <View key={row.text} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
              <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: `${colors.brand}12`, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name={row.icon as never} size={15} color={colors.brand} />
              </View>
              <Text style={{ flex: 1, fontSize: 12.5, color: colors.muted, lineHeight: 18 }}>{row.text}</Text>
            </View>
          ))}
        </View>

        {upcomingDeadlines.length > 0 && (
          <>
            <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7 }}>
              Upcoming deadlines
            </Text>
            <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}>
              {upcomingDeadlines.map((c, i) => (
                <View key={c.id ?? i} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  paddingHorizontal: 12, paddingVertical: 11,
                  borderBottomWidth: i < upcomingDeadlines.length - 1 ? 1 : 0, borderBottomColor: colors.border,
                }}>
                  <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: '#fff5cc', alignItems: 'center', justifyContent: 'center' }}>
                    <MaterialCommunityIcons name="calendar-clock" size={15} color="#b6831e" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{c.tax_type ?? 'Tax deadline'}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      Due {formatDate(c.due_date)}
                    </Text>
                    {c.description && (
                      <Text style={{ fontSize: 10, color: colors.muted, marginTop: 1 }} numberOfLines={1}>{c.description}</Text>
                    )}
                  </View>
                  <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: '#fff5cc' }}>
                    <Text style={{ fontSize: 10, fontFamily: fonts.bodySemiBold, color: '#b6831e' }}>upcoming</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7 }}>
          Input VAT records
        </Text>
        {inputVATList.isLoading ? (
          <View style={{ paddingVertical: 14, alignItems: 'center' }}>
            <ActivityIndicator color={colors.brand} size="small" />
          </View>
        ) : inputVATList.isError ? (
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 16, alignItems: 'center' }}>
            <Text style={{ fontSize: 13, color: colors.muted }}>Could not load input VAT records</Text>
          </View>
        ) : inputVATList.data && inputVATList.data.length === 0 ? (
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 16, alignItems: 'center' }}>
            <MaterialCommunityIcons name="receipt-outline" size={26} color={colors.border} />
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6 }}>No input VAT recorded yet</Text>
            <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 2 }}>Tap "Input VAT" above to record a supplier invoice.</Text>
          </View>
        ) : inputVATList.data && inputVATList.data.length > 0 ? (
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}>
            {inputVATList.data.slice(0, 10).map((record, i) => (
              <View
                key={record.id}
                style={{
                  paddingHorizontal: 12, paddingVertical: 11,
                  borderBottomWidth: i < Math.min(inputVATList.data!.length, 10) - 1 ? 1 : 0,
                  borderBottomColor: colors.border,
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                }}
              >
                <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: `${colors.brand}12`, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name="receipt-outline" size={15} color={colors.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>
                    {record.supplier_name}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {formatDate(record.purchase_date)} · Subtotal {money(record.subtotal)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 12, fontFamily: fonts.displaySemiBold, color: colors.ink }}>
                    {money(record.vat_amount)}
                  </Text>
                  <Text style={{ fontSize: 10, color: colors.muted }}>VAT</Text>
                </View>
              </View>
            ))}
            {inputVATList.data.length > 10 && (
              <View style={{ paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={{ fontSize: 11, color: colors.muted, textAlign: 'center' }}>
                  Showing 10 of {inputVATList.data.length} records
                </Text>
              </View>
            )}
          </View>
        ) : null}

        <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7 }}>
          Filing history
        </Text>
        {returns.length === 0 ? (
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 16, alignItems: 'center' }}>
            <MaterialCommunityIcons name="file-document-outline" size={26} color={colors.border} />
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6 }}>No draft or filed returns yet</Text>
            <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 2 }}>Tap Refresh draft to prepare this month from current data.</Text>
          </View>
        ) : (
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}>
            {sortedReturns.map((r, i) => {
              const isFiled = r.status === 'submitted' || r.status === 'accepted';
              const isExported = r.status === 'exported';
              const isDraft = r.status === 'draft';
              const itemPeriodLabel = r.period_start
                ? new Date(r.period_start).toLocaleString('default', { month: 'long', year: 'numeric' })
                : 'Period';

              // Icon + colour per status
              const iconName = isFiled ? 'check-circle' : isExported ? 'file-export-outline' : 'file-clock-outline';
              const iconBg = isFiled ? `${colors.brand}15` : isExported ? '#e0f2e9' : '#fff5cc';
              const iconColor = isFiled ? colors.brand : isExported ? '#2e7d52' : '#b6831e';

              // Sub-label per status
              const subLabel = isFiled
                ? `Filed · ${r.gra_ref ?? 'GRA confirmed'}`
                : isExported
                ? 'Exported · Pending GRA submission'
                : 'Draft · Not yet exported';

              return (
                <View key={r.id} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  paddingHorizontal: 12, paddingVertical: 11,
                  borderBottomWidth: i < sortedReturns.length - 1 ? 1 : 0, borderBottomColor: colors.border,
                }}>
                  <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
                    <MaterialCommunityIcons name={iconName as never} size={15} color={iconColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                      VAT · {itemPeriodLabel}
                    </Text>
                    <Text style={{ fontSize: 11, color: isFiled ? colors.brand : isExported ? '#2e7d52' : colors.muted }}>
                      {subLabel}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 13, color: colors.ink }}>
                    {money(r.total_tax)}
                  </Text>
                  {(isFiled || isExported || isDraft) && (
                    <TouchableOpacity
                      disabled={pdfGenerating}
                      onPress={() => void handleDownloadPdf(r, r.id === currentReturn?.id ? summary : undefined)}
                      style={{ padding: 6, opacity: pdfGenerating ? 0.4 : 1 }}
                    >
                      <MaterialCommunityIcons name="file-pdf-box" size={20} color={colors.brand} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal visible={showInputVAT} transparent animationType="slide" onRequestClose={() => setShowInputVAT(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} activeOpacity={1} onPress={() => setShowInputVAT(false)} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
            <ScrollView bounces={false} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 8 }}>
              <Text style={{ fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink, marginBottom: 4 }}>Record Purchase Invoice</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 14 }}>VAT you paid on purchases reduces your net VAT payable to GRA</Text>

              {[
                { label: 'SUPPLIER NAME', value: ivSupplier, onChange: setIvSupplier, placeholder: 'Accra Supplies Ltd', keyboard: 'default' as const },
                { label: 'SUPPLIER TIN (OPTIONAL)', value: ivSupplierTin, onChange: setIvSupplierTin, placeholder: 'C0012345678', keyboard: 'default' as const },
                { label: 'INVOICE REF (OPTIONAL)', value: ivInvoiceRef, onChange: setIvInvoiceRef, placeholder: 'INV-2024-001', keyboard: 'default' as const },
                { label: 'PURCHASE DATE (YYYY-MM-DD)', value: ivDate, onChange: setIvDate, placeholder: new Date().toISOString().slice(0, 10), keyboard: 'default' as const },
                { label: 'SUBTOTAL (GH₵, excl. VAT)', value: ivSubtotal, onChange: setIvSubtotal, placeholder: '800.00', keyboard: 'numeric' as const },
                { label: 'VAT AMOUNT (GH₵)', value: ivVatAmount, onChange: setIvVatAmount, placeholder: '100.00', keyboard: 'numeric' as const },
              ].map((field) => (
                <View key={field.label} style={{ marginBottom: 9 }}>
                  <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 3 }}>{field.label}</Text>
                  <TextInput
                    value={field.value}
                    onChangeText={field.onChange}
                    keyboardType={field.keyboard}
                    placeholder={field.placeholder}
                    placeholderTextColor={colors.muted}
                    style={{
                      borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                      paddingHorizontal: 12, paddingVertical: 9,
                      fontSize: 14, color: colors.ink, backgroundColor: colors.bg,
                    }}
                  />
                </View>
              ))}
            </ScrollView>
            <View style={{ paddingHorizontal: 20, paddingBottom: 34, paddingTop: 4 }}>
              <TouchableOpacity
                disabled={recordInputVAT.isPending || !ivSupplier || !ivSubtotal || !ivVatAmount || !ivDate}
                onPress={() => {
                  recordInputVAT.mutate(
                    {
                      supplier_name: ivSupplier,
                      supplier_tin: ivSupplierTin || undefined,
                      invoice_ref: ivInvoiceRef || undefined,
                      purchase_date: ivDate,
                      subtotal: Number(ivSubtotal),
                      vat_amount: Number(ivVatAmount),
                    },
                    {
                      onSuccess: () => {
                        setShowInputVAT(false);
                        setIvSupplier(''); setIvSupplierTin(''); setIvInvoiceRef('');
                        setIvSubtotal(''); setIvVatAmount('');
                        setIvDate(new Date().toISOString().slice(0, 10));
                        Alert.alert('Recorded', `GH₵ ${ivVatAmount} input VAT recorded. It will reduce your net VAT this period.`);
                      },
                      onError: (e: Error) => Alert.alert('Error', e.message),
                    }
                  );
                }}
                style={{
                  height: 46, borderRadius: 12, backgroundColor: colors.brand,
                  alignItems: 'center', justifyContent: 'center',
                  opacity: (recordInputVAT.isPending || !ivSupplier || !ivSubtotal || !ivVatAmount || !ivDate) ? 0.6 : 1,
                }}
              >
                {recordInputVAT.isPending
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>Record Invoice</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
