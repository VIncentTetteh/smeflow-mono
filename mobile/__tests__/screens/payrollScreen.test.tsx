jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({ set: jest.fn(), getString: jest.fn(), delete: jest.fn() })),
}));

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import PayrollScreen from '../../app/owner/payroll';
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

jest.mock('@/api/hooks/featureHooks', () => ({
  usePayroll: jest.fn(),
  useRunPayroll: jest.fn(),
  useCreateEmployee: jest.fn(),
  useUpdateEmployee: jest.fn(),
  useDisbursePayroll: jest.fn(),
  usePayPayslip: jest.fn(),
  useApprovePayrollRun: jest.fn(),
  useDownloadP9A: jest.fn(),
  useDownloadP9B: jest.fn(),
  useRunPayslips: jest.fn(),
}));

jest.mock('@/components/ui/PlanGatedScreen', () => {
  const ReactActual = require('react');
  return { PlanGatedScreen: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(ReactActual.Fragment, null, children) };
});

jest.mock('@expo/vector-icons', () => {
  const ReactActual = require('react');
  const { Text } = require('react-native');
  return { MaterialCommunityIcons: ({ name }: { name: string }) => ReactActual.createElement(Text, null, name) };
});

jest.mock('@/lib/theme', () => ({
  useTheme: () => ({
    colors: {
      bg: '#faf8f3', surface: '#fff', border: '#e8e5de', brand: '#1f6a4f',
      ink: '#2a2a22', muted: '#6b6860', danger: '#b42318', gold: '#d97706', info: '#3b82f6',
    },
    fonts: { body: 'Inter', bodySemiBold: 'InterSemiBold', displaySemiBold: 'Serif', mono: 'Mono' },
    radii: { full: 999 },
    spacing: { xs: 4, sm: 8 },
  }),
}));

const mockUsePayroll = usePayroll as jest.Mock;
const mockUseRunPayroll = useRunPayroll as jest.Mock;
const mockUseCreateEmployee = useCreateEmployee as jest.Mock;
const mockUseUpdateEmployee = useUpdateEmployee as jest.Mock;
const mockUseDisbursePayroll = useDisbursePayroll as jest.Mock;
const mockUsePayPayslip = usePayPayslip as jest.Mock;
const mockUseApprovePayrollRun = useApprovePayrollRun as jest.Mock;
const mockUseDownloadP9A = useDownloadP9A as jest.Mock;
const mockUseDownloadP9B = useDownloadP9B as jest.Mock;
const mockUseRunPayslips = useRunPayslips as jest.Mock;

describe('Payroll screen', () => {
  let createMutate: jest.Mock;

  beforeEach(() => {
    createMutate = jest.fn();
    mockUsePayroll.mockReturnValue({
      isLoading: false,
      data: {
        employees: [{ id: 'e1', name: 'Ama Owusu', role: 'Cashier', base_pay: '1200.00', momo_phone: '+233244000000' }],
        runs: [],
      },
    });
    mockUseRunPayroll.mockReturnValue({ mutate: jest.fn(), isPending: false });
    mockUseCreateEmployee.mockReturnValue({ mutate: createMutate, isPending: false });
    mockUseUpdateEmployee.mockReturnValue({ mutate: jest.fn(), isPending: false });
    mockUseDisbursePayroll.mockReturnValue({ mutate: jest.fn(), isPending: false });
    mockUsePayPayslip.mockReturnValue({ mutate: jest.fn(), isPending: false });
    mockUseApprovePayrollRun.mockReturnValue({ mutate: jest.fn(), isPending: false });
    mockUseDownloadP9A.mockReturnValue({ mutate: jest.fn(), isPending: false });
    mockUseDownloadP9B.mockReturnValue({ mutate: jest.fn(), isPending: false });
    mockUseRunPayslips.mockReturnValue({ data: undefined, isFetching: false });
  });

  it('shows a loading spinner while payroll data is being fetched', () => {
    mockUsePayroll.mockReturnValue({ isLoading: true, data: undefined });
    const { queryByText } = render(<PayrollScreen />);
    expect(queryByText('Payroll')).toBeNull();
  });

  it('shows the net payout estimate from current employees when no run has been made yet', () => {
    const { getByText, getAllByText } = render(<PayrollScreen />);
    expect(getByText('Net payout estimate')).toBeTruthy();
    // Both the headline figure and the "Gross" stat read GH₵ 1,200 with a
    // single GH₵1200/mo employee and no run yet.
    expect(getAllByText('GH₵ 1,200').length).toBeGreaterThanOrEqual(1);
  });

  it('does not submit the add-employee form until name, role, and salary are all filled', () => {
    const { getByText, getByPlaceholderText, getAllByText } = render(<PayrollScreen />);
    fireEvent.press(getByText('plus'));
    fireEvent.changeText(getByPlaceholderText('Abena Asante'), 'Kofi Mensah');
    // Role and salary still blank — submit must be a no-op.
    fireEvent.press(getAllByText('Add Employee')[1]);
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric or zero salary when adding an employee', () => {
    const { getByText, getByPlaceholderText, getAllByText } = render(<PayrollScreen />);
    fireEvent.press(getByText('plus'));
    fireEvent.changeText(getByPlaceholderText('Abena Asante'), 'Kofi Mensah');
    fireEvent.changeText(getByPlaceholderText('Sales Associate'), 'Cashier');
    fireEvent.changeText(getByPlaceholderText('1200'), '0');
    fireEvent.press(getAllByText('Add Employee')[1]);
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('adds a new employee with a valid form and shows a confirmation', async () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    createMutate.mockImplementation((_vars, { onSuccess }: { onSuccess: () => void }) => onSuccess());

    const { getByText, getByPlaceholderText, getAllByText } = render(<PayrollScreen />);
    fireEvent.press(getByText('plus'));
    fireEvent.changeText(getByPlaceholderText('Abena Asante'), 'Kofi Mensah');
    fireEvent.changeText(getByPlaceholderText('Sales Associate'), 'Cashier');
    fireEvent.changeText(getByPlaceholderText('1200'), '1500');
    fireEvent.press(getAllByText('Add Employee')[1]);

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledWith(
        { name: 'Kofi Mensah', role: 'Cashier', base_pay: 1500, momo_phone: undefined },
        expect.anything()
      );
    });
    expect(alertSpy).toHaveBeenCalledWith('Added', 'Kofi Mensah added to payroll.');
    alertSpy.mockRestore();
  });

  it('shows employees in the team list', () => {
    const { getByText } = render(<PayrollScreen />);
    expect(getByText('Ama Owusu')).toBeTruthy();
    expect(getByText('Cashier')).toBeTruthy();
  });
});
