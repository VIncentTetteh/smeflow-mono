import React from 'react';
import { render } from '@testing-library/react-native';
import {
  CreditScoreGauge,
  MonthlyRevenueBars,
  RevenueSparkline,
  StockTrendBars,
} from '@/components/charts';

jest.mock('victory-native', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    Area: () => <View testID="chart-area" />,
    Bar: () => <View testID="chart-bar" />,
    CartesianChart: ({ children }: { children: (args: unknown) => React.ReactNode }) => (
      <View testID="cartesian-chart">
        {children({
          chartBounds: { bottom: 100, left: 0, right: 100, top: 0 },
          points: { value: [] },
        })}
      </View>
    ),
    Line: () => <View testID="chart-line" />,
  };
});

jest.mock('@/lib/theme', () => ({
  useTheme: () => ({
    colors: {
      brand: '#1f6a4f',
      border: '#e8e5de',
      danger: '#d03514',
      gold: '#e8c25a',
      info: '#5b6be5',
      ink: '#2a2a22',
      muted: '#6b6860',
      surface: '#fff',
      text: '#2a2a22',
    },
    fonts: {
      body: 'Inter_400Regular',
      bodySemiBold: 'Inter_600SemiBold',
      displaySemiBold: 'SourceSerif4_600SemiBold',
    },
    radii: { full: 999, md: 10 },
    spacing: { sm: 8, md: 16 },
  }),
}));

const sampleData = [
  { label: 'Mon', value: 120 },
  { label: 'Tue', value: 180 },
];

describe('chart components', () => {
  it('renders revenue area and line series', () => {
    const { getByTestId } = render(<RevenueSparkline data={sampleData} />);
    expect(getByTestId('chart-area')).toBeTruthy();
    expect(getByTestId('chart-line')).toBeTruthy();
  });

  it('renders stock trend bars', () => {
    const { getByTestId } = render(<StockTrendBars data={sampleData} />);
    expect(getByTestId('chart-bar')).toBeTruthy();
  });

  it('renders monthly revenue bars', () => {
    const { getByTestId } = render(<MonthlyRevenueBars data={sampleData} />);
    expect(getByTestId('chart-bar')).toBeTruthy();
  });

  it('renders empty chart state', () => {
    const { getByText } = render(<RevenueSparkline data={[]} />);
    expect(getByText('No chart data yet')).toBeTruthy();
  });

  it('labels credit score bands', () => {
    const { getByText } = render(<CreditScoreGauge score={780} />);
    expect(getByText('780')).toBeTruthy();
    expect(getByText('Strong')).toBeTruthy();
  });

  it('rounds decimal credit scores before passing native progress values', () => {
    const { getByLabelText, getByText } = render(<CreditScoreGauge score={19.74} />);
    expect(getByText('20')).toBeTruthy();
    expect(getByLabelText('Credit score 20, Poor')).toBeTruthy();
  });
});
