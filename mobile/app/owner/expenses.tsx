import { useMemo, useState } from 'react';
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
import { Text } from '@/components/ui/Text';
import {
  useDeleteExpense,
  useExpenseCategories,
  useExpenseSummary,
  useExpenses,
  useRecordExpense,
} from '@/api/hooks/featureHooks';
import { useTheme } from '@/lib/theme';
import type { ExpenseDto, ExpensePaymentMethod } from '@/types/expenses';

const PAYMENT_METHODS: { key: ExpensePaymentMethod; label: string }[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'momo', label: 'MoMo' },
  { key: 'bank', label: 'Bank' },
  { key: 'credit', label: 'Owing' },
  { key: 'other', label: 'Other' },
];

function money(value?: number | null) {
  return `GH₵ ${Number(value ?? 0).toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' });
}

/** First and last day of the month `offset` months back from today. */
function monthRange(offset: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 0);
  return {
    from_date: start.toISOString().slice(0, 10),
    to_date: end.toISOString().slice(0, 10),
    label: start.toLocaleDateString('en-GH', { month: 'long', year: 'numeric' }),
  };
}

export default function ExpensesScreen() {
  const { colors, fonts } = useTheme();

  const [monthOffset, setMonthOffset] = useState(0);
  const range = useMemo(() => monthRange(monthOffset), [monthOffset]);
  const params = useMemo(
    () => ({ from_date: range.from_date, to_date: range.to_date }),
    [range.from_date, range.to_date],
  );

  const summary = useExpenseSummary(params);
  const expenses = useExpenses(params);
  const categories = useExpenseCategories();
  const recordExpense = useRecordExpense();
  const deleteExpense = useDeleteExpense();

  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [category, setCategory] = useState('rent');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('cash');
  const [vendorName, setVendorName] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  const categoryOptions = categories.data ?? [];
  const selectedCategory = categoryOptions.find((c) => c.key === category);
  const items = expenses.data?.items ?? [];
  const canSubmit = Boolean(amount) && Number(amount) > 0 && Boolean(expenseDate);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([summary.refetch(), expenses.refetch()]);
    setRefreshing(false);
  };

  const resetForm = () => {
    setCategory('rent');
    setAmount('');
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setPaymentMethod('cash');
    setVendorName('');
    setReference('');
    setNotes('');
  };

  const submit = () => {
    recordExpense.mutate(
      {
        category,
        amount: Number(amount),
        expense_date: expenseDate,
        payment_method: paymentMethod,
        vendor_name: vendorName || undefined,
        reference: reference || undefined,
        notes: notes || undefined,
      },
      {
        onSuccess: () => {
          setShowAdd(false);
          resetForm();
        },
        onError: (e: Error) => Alert.alert('Could not save', e.message),
      },
    );
  };

  const confirmDelete = (expense: ExpenseDto) => {
    if (!expense.is_editable) {
      Alert.alert(
        'Automatic entry',
        'This expense came from a payroll run, so it cannot be deleted here.',
      );
      return;
    }
    Alert.alert('Delete expense?', `${expense.category_label} — ${money(expense.amount)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteExpense.mutate(expense.id, {
            onError: (e: Error) => Alert.alert('Could not delete', e.message),
          }),
      },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brand} />
        }
      >
        {/* Month selector */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity
            onPress={() => setMonthOffset((m) => m + 1)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialCommunityIcons name="chevron-left" size={26} color={colors.muted} />
          </TouchableOpacity>
          <Text style={{ fontSize: 15, fontFamily: fonts.displaySemiBold, color: colors.ink }}>
            {range.label}
          </Text>
          <TouchableOpacity
            disabled={monthOffset === 0}
            onPress={() => setMonthOffset((m) => Math.max(0, m - 1))}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MaterialCommunityIcons
              name="chevron-right"
              size={26}
              color={monthOffset === 0 ? colors.border : colors.muted}
            />
          </TouchableOpacity>
        </View>

        {/* Total */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            padding: 18,
          }}
        >
          <Text
            style={{
              fontSize: 10.5,
              color: colors.muted,
              fontFamily: fonts.bodySemiBold,
              letterSpacing: 0.6,
            }}
          >
            SPENT THIS MONTH
          </Text>
          <Text
            style={{
              fontSize: 30,
              fontFamily: fonts.displaySemiBold,
              color: colors.ink,
              marginTop: 4,
            }}
          >
            {money(summary.data?.total)}
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>
            {money(summary.data?.operating_total)} counts against your profit
            {(summary.data?.excluded_total ?? 0) > 0
              ? ` · ${money(summary.data?.excluded_total)} excluded (stock & drawings)`
              : ''}
          </Text>
        </View>

        {/* Add button */}
        <TouchableOpacity
          onPress={() => setShowAdd(true)}
          style={{
            height: 48,
            borderRadius: 12,
            backgroundColor: colors.brand,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
          }}
        >
          <MaterialCommunityIcons name="plus" size={18} color="#fff" />
          <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>
            Record an expense
          </Text>
        </TouchableOpacity>

        {/* Breakdown */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            padding: 16,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.bodySemiBold,
              fontSize: 14,
              color: colors.ink,
              marginBottom: 10,
            }}
          >
            Where the money went
          </Text>
          {summary.isLoading && <ActivityIndicator color={colors.brand} style={{ marginVertical: 16 }} />}
          {!summary.isLoading && (summary.data?.by_category.length ?? 0) === 0 && (
            <Text style={{ fontSize: 13, color: colors.muted, paddingVertical: 10 }}>
              Nothing recorded for {range.label} yet.
            </Text>
          )}
          {(summary.data?.by_category ?? []).map((row) => {
            const share = summary.data?.total ? (row.total / summary.data.total) * 100 : 0;
            return (
              <View key={row.category} style={{ paddingVertical: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                  <Text style={{ fontSize: 13, color: colors.ink }}>
                    {row.label}
                    {row.kind !== 'operating' ? ' *' : ''}
                  </Text>
                  <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                    {money(row.total)}
                  </Text>
                </View>
                <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.border }}>
                  <View
                    style={{
                      height: 5,
                      borderRadius: 3,
                      width: `${Math.min(100, share)}%`,
                      backgroundColor: row.kind === 'operating' ? colors.brand : colors.muted,
                    }}
                  />
                </View>
              </View>
            );
          })}
          {(summary.data?.excluded_total ?? 0) > 0 && (
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 8 }}>
              * Not counted as an expense — stock cost is already in your cost of goods, and drawings
              are not a business cost.
            </Text>
          )}
        </View>

        {/* List */}
        <View
          style={{
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            padding: 16,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.bodySemiBold,
              fontSize: 14,
              color: colors.ink,
              marginBottom: 4,
            }}
          >
            All expenses
          </Text>
          {expenses.isLoading && <ActivityIndicator color={colors.brand} style={{ marginVertical: 16 }} />}
          {!expenses.isLoading && items.length === 0 && (
            <Text style={{ fontSize: 13, color: colors.muted, paddingVertical: 10 }}>
              No expenses yet this month.
            </Text>
          )}
          {items.map((expense) => (
            <TouchableOpacity
              key={expense.id}
              onLongPress={() => confirmDelete(expense)}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 10,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={{ fontSize: 13.5, color: colors.ink }}>
                  {expense.category_label}
                  {!expense.is_editable ? '  ·  from payroll' : ''}
                </Text>
                <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 2 }}>
                  {formatDate(expense.expense_date)}
                  {expense.vendor_name ? ` · ${expense.vendor_name}` : ''}
                  {` · ${expense.payment_method}`}
                </Text>
              </View>
              <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                {money(expense.amount)}
              </Text>
            </TouchableOpacity>
          ))}
          {items.length > 0 && (
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 10 }}>
              Press and hold an expense to delete it.
            </Text>
          )}
        </View>
      </ScrollView>

      {/* Add expense sheet */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
            activeOpacity={1}
            onPress={() => setShowAdd(false)}
          />
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: '86%',
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
                Record an expense
              </Text>

              <Text
                style={{
                  fontSize: 10.5,
                  color: colors.muted,
                  fontFamily: fonts.bodySemiBold,
                  letterSpacing: 0.6,
                  marginBottom: 6,
                }}
              >
                WHAT WAS IT FOR
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 4 }}>
                {categoryOptions.map((option) => {
                  const active = option.key === category;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      onPress={() => setCategory(option.key)}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: active ? colors.brand : colors.border,
                        backgroundColor: active ? colors.brand : 'transparent',
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontFamily: active ? fonts.bodySemiBold : fonts.body,
                          color: active ? '#fff' : colors.ink,
                        }}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {selectedCategory && selectedCategory.kind !== 'operating' && (
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 10 }}>
                  {selectedCategory.kind === 'cogs'
                    ? 'Stock cost is already counted through your item cost prices, so this will not reduce your profit again.'
                    : 'Money you take out of the business is not a business cost, so this will not reduce your profit.'}
                </Text>
              )}

              <Text
                style={{
                  fontSize: 10.5,
                  color: colors.muted,
                  fontFamily: fonts.bodySemiBold,
                  letterSpacing: 0.6,
                  marginTop: 10,
                  marginBottom: 6,
                }}
              >
                HOW YOU PAID
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
                {PAYMENT_METHODS.map((option) => {
                  const active = option.key === paymentMethod;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      onPress={() => setPaymentMethod(option.key)}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 7,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: active ? colors.brand : colors.border,
                        backgroundColor: active ? colors.brand : 'transparent',
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontFamily: active ? fonts.bodySemiBold : fonts.body,
                          color: active ? '#fff' : colors.ink,
                        }}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {[
                {
                  label: 'AMOUNT (GH₵)',
                  value: amount,
                  onChange: setAmount,
                  placeholder: '150.00',
                  keyboard: 'numeric' as const,
                },
                {
                  label: 'DATE (YYYY-MM-DD)',
                  value: expenseDate,
                  onChange: setExpenseDate,
                  placeholder: new Date().toISOString().slice(0, 10),
                  keyboard: 'default' as const,
                },
                {
                  label: 'PAID TO (OPTIONAL)',
                  value: vendorName,
                  onChange: setVendorName,
                  placeholder: 'Landlord, ECG, Shell…',
                  keyboard: 'default' as const,
                },
                {
                  label: 'RECEIPT NO. (OPTIONAL)',
                  value: reference,
                  onChange: setReference,
                  placeholder: 'RCT-001',
                  keyboard: 'default' as const,
                },
                {
                  label: 'NOTE (OPTIONAL)',
                  value: notes,
                  onChange: setNotes,
                  placeholder: 'Anything worth remembering',
                  keyboard: 'default' as const,
                },
              ].map((field) => (
                <View key={field.label} style={{ marginBottom: 9 }}>
                  <Text
                    style={{
                      fontSize: 10.5,
                      color: colors.muted,
                      fontFamily: fonts.bodySemiBold,
                      letterSpacing: 0.6,
                      marginBottom: 3,
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
                      paddingVertical: 9,
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
                disabled={recordExpense.isPending || !canSubmit}
                onPress={submit}
                style={{
                  height: 46,
                  borderRadius: 12,
                  backgroundColor: colors.brand,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: recordExpense.isPending || !canSubmit ? 0.6 : 1,
                }}
              >
                {recordExpense.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>
                    Save expense
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
