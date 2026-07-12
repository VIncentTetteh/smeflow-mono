jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({ set: jest.fn(), getString: jest.fn(), delete: jest.fn() })),
}));

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import TaxScreen from '../../app/owner/tax';
import {
  useFileTaxReturn,
  useGenerateTaxReturn,
  useInputVATList,
  useRecordInputVAT,
  useTaxRates,
  useTaxWorkspace,
} from '@/api/hooks/featureHooks';

jest.mock('@/api/hooks/featureHooks', () => ({
  useTaxWorkspace: jest.fn(),
  useGenerateTaxReturn: jest.fn(),
  useFileTaxReturn: jest.fn(),
  useRecordInputVAT: jest.fn(),
  useTaxRates: jest.fn(),
  useInputVATList: jest.fn(),
}));

jest.mock('@/lib/taxPdfGenerator', () => ({
  generateAndShareTaxPDF: jest.fn(),
}));

jest.mock('@/store/auth', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ business: { name: 'Test Shop', type: 'shop', tin: 'C001', address: 'Accra' } }),
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
      bg: '#faf8f3', surface: '#fff', border: '#e8e5de', brand: '#1f6a4f', gold: '#c9a13b',
      ink: '#2a2a22', muted: '#6b6860', danger: '#b42318',
    },
    fonts: { body: 'Inter', bodySemiBold: 'InterSemiBold', displaySemiBold: 'Serif', mono: 'Mono' },
  }),
}));

const mockWorkspace = useTaxWorkspace as jest.Mock;
const mockGenerate = useGenerateTaxReturn as jest.Mock;
const mockFile = useFileTaxReturn as jest.Mock;
const mockRecordInputVAT = useRecordInputVAT as jest.Mock;
const mockTaxRates = useTaxRates as jest.Mock;
const mockInputVATList = useInputVATList as jest.Mock;

describe('Tax (GRA) screen', () => {
  let generateMutate: jest.Mock;
  let fileMutate: jest.Mock;

  beforeEach(() => {
    generateMutate = jest.fn();
    fileMutate = jest.fn();
    mockGenerate.mockReturnValue({ mutate: generateMutate, isPending: false });
    mockFile.mockReturnValue({ mutate: fileMutate, isPending: false });
    mockRecordInputVAT.mockReturnValue({ mutate: jest.fn(), isPending: false });
    mockTaxRates.mockReturnValue({ data: undefined, refetch: jest.fn() });
    mockInputVATList.mockReturnValue({ isLoading: false, isError: false, data: [], refetch: jest.fn() });
    mockWorkspace.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      data: {
        summary: {
          year: 2026, month: 7, total_tax: '340.00', vat_payable: '250.00',
          due_date: '2026-08-31', filing_readiness: { has_generated_return: true, can_file: true, has_gra_ref: false },
        },
        returns: [{ id: 'ret-1', period_start: '2026-07-01', status: 'draft' }],
        calendar: [],
      },
    });
  });

  it('renders a zeroed summary without crashing while the workspace is loading (no full-screen replace)', () => {
    mockWorkspace.mockReturnValue({ isLoading: true, isError: false, refetch: jest.fn(), data: undefined });
    const { getAllByText, queryByText } = render(<TaxScreen />);
    // tax.tsx overlays a spinner above the summary card rather than replacing
    // the whole screen, so the (zeroed) total still renders underneath.
    expect(getAllByText('GH₵ 0.00').length).toBeGreaterThan(0);
    expect(queryByText('Could not load tax workspace')).toBeNull();
  });

  it('shows a retryable error banner without hiding the rest of the screen', () => {
    mockWorkspace.mockReturnValue({ isLoading: false, isError: true, refetch: jest.fn(), data: undefined });
    const { getByText } = render(<TaxScreen />);
    expect(getByText('Could not load tax workspace')).toBeTruthy();
    expect(getByText('Pull down to retry.')).toBeTruthy();
  });

  it('shows the total due for the period and filing readiness pills', () => {
    const { getByText } = render(<TaxScreen />);
    expect(getByText('GH₵ 340.00')).toBeTruthy();
    expect(getByText('Draft ready')).toBeTruthy();
    expect(getByText('Ready to file')).toBeTruthy();
    expect(getByText('No GRA ref')).toBeTruthy();
  });

  it('disables File to GRA when the return is not ready to file', () => {
    mockWorkspace.mockReturnValue({
      isLoading: false, isError: false, refetch: jest.fn(),
      data: {
        summary: { year: 2026, month: 7, total_tax: '0.00', filing_readiness: { has_generated_return: false, can_file: false, has_gra_ref: false } },
        returns: [],
        calendar: [],
      },
    });
    const { getByText } = render(<TaxScreen />);
    fireEvent.press(getByText('File to GRA'));
    expect(fileMutate).not.toHaveBeenCalled();
  });

  it('refreshes the draft return for the current period', async () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    generateMutate.mockImplementation((_vars, { onSuccess }: { onSuccess: () => void }) => onSuccess());

    const { getByText } = render(<TaxScreen />);
    fireEvent.press(getByText('Refresh draft'));

    await waitFor(() => {
      expect(generateMutate).toHaveBeenCalledWith({ year: 2026, month: 7 }, expect.anything());
    });
    expect(alertSpy).toHaveBeenCalledWith('Draft refreshed', expect.any(String));
    alertSpy.mockRestore();
  });

  it('files the current return and shows the not-yet-filed dry-run message with the GRA ref', async () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    fileMutate.mockImplementation((_id, { onSuccess }: { onSuccess: (r: unknown) => void }) =>
      onSuccess({ is_dry_run: true, gra_ref: 'GRA-REF-1' })
    );

    const { getByText } = render(<TaxScreen />);
    fireEvent.press(getByText('File to GRA'));

    await waitFor(() => {
      expect(fileMutate).toHaveBeenCalledWith('ret-1', expect.anything());
    });
    expect(alertSpy).toHaveBeenCalledWith(
      'Return exported — not yet filed',
      expect.stringContaining('GRA-REF-1')
    );
    alertSpy.mockRestore();
  });
});
