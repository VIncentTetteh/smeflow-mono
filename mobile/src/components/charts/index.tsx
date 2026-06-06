import { View, type ViewStyle } from 'react-native';
import type React from 'react';
import { Area, Bar, CartesianChart, Line } from 'victory-native';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';

export interface ChartPoint {
  label: string;
  value: number;
}

interface ChartProps {
  data: ChartPoint[];
  height?: number;
  style?: ViewStyle;
}

function normalizeData(data: ChartPoint[]) {
  return data.map((point, index) => ({
    x: index,
    label: point.label,
    value: Number.isFinite(point.value) ? point.value : 0,
  }));
}

function EmptyChart({ height }: { height: number }) {
  const { colors, radii, spacing } = useTheme();

  return (
    <View
      style={{
        alignItems: 'center',
        backgroundColor: `${colors.ink}08`,
        borderRadius: radii.md,
        height,
        justifyContent: 'center',
        padding: spacing.md,
      }}
    >
      <Text style={{ color: colors.muted }}>No chart data yet</Text>
    </View>
  );
}

function ChartShell({
  children,
  height,
  style,
}: {
  children: React.ReactNode;
  height: number;
  style?: ViewStyle;
}) {
  return <View style={[{ height, width: '100%' }, style]}>{children}</View>;
}

export function RevenueSparkline({ data, height = 96, style }: ChartProps) {
  const { colors } = useTheme();
  const chartData = normalizeData(data);

  if (chartData.length === 0) {
    return <EmptyChart height={height} />;
  }

  return (
    <ChartShell height={height} style={style}>
      <CartesianChart
        data={chartData}
        domainPadding={{ left: 4, right: 4, top: 12, bottom: 4 }}
        frame={{ lineColor: 'transparent' }}
        padding={{ left: 0, right: 0, top: 8, bottom: 0 }}
        xKey="x"
        yKeys={['value']}
      >
        {({ chartBounds, points }) => (
          <>
            <Area
              color={`${colors.brand}30`}
              curveType="natural"
              points={points.value}
              y0={chartBounds.bottom}
            />
            <Line
              color={colors.brand}
              curveType="natural"
              points={points.value}
              strokeWidth={3}
            />
          </>
        )}
      </CartesianChart>
    </ChartShell>
  );
}

export function StockTrendBars({ data, height = 120, style }: ChartProps) {
  const { colors } = useTheme();
  const chartData = normalizeData(data);

  if (chartData.length === 0) {
    return <EmptyChart height={height} />;
  }

  return (
    <ChartShell height={height} style={style}>
      <CartesianChart
        data={chartData}
        domainPadding={{ left: 12, right: 12, top: 16, bottom: 4 }}
        frame={{ lineColor: 'transparent' }}
        padding={{ left: 0, right: 0, top: 8, bottom: 0 }}
        xKey="x"
        yKeys={['value']}
      >
        {({ chartBounds, points }) => (
          <Bar
            chartBounds={chartBounds}
            color={colors.info}
            points={points.value}
            roundedCorners={{ topLeft: 4, topRight: 4 }}
          />
        )}
      </CartesianChart>
    </ChartShell>
  );
}

export function MonthlyRevenueBars({ data, height = 160, style }: ChartProps) {
  const { colors } = useTheme();
  const chartData = normalizeData(data);

  if (chartData.length === 0) {
    return <EmptyChart height={height} />;
  }

  return (
    <ChartShell height={height} style={style}>
      <CartesianChart
        data={chartData}
        domainPadding={{ left: 14, right: 14, top: 18, bottom: 4 }}
        frame={{ lineColor: 'transparent' }}
        padding={{ left: 0, right: 0, top: 8, bottom: 0 }}
        xKey="x"
        yKeys={['value']}
      >
        {({ chartBounds, points }) => (
          <Bar
            chartBounds={chartBounds}
            color={colors.brand}
            points={points.value}
            roundedCorners={{ topLeft: 5, topRight: 5 }}
          />
        )}
      </CartesianChart>
    </ChartShell>
  );
}

interface CreditScoreGaugeProps {
  score: number;
  maxScore?: number;
  style?: ViewStyle;
}

export function CreditScoreGauge({ score, maxScore = 1000, style }: CreditScoreGaugeProps) {
  const { colors, fonts, radii, spacing } = useTheme();
  const safeMax = Math.max(Math.round(maxScore), 1);
  const safeScore = Math.min(Math.max(Math.round(score), 0), safeMax);
  const normalized = Math.min(Math.max(safeScore / safeMax, 0), 1);
  const band =
    normalized >= 0.75
      ? 'Strong'
      : normalized >= 0.55
      ? 'Good'
      : normalized >= 0.35
      ? 'Fair'
      : 'Poor';
  const bandColor =
    band === 'Strong'
      ? colors.brand
      : band === 'Good'
      ? colors.info
      : band === 'Fair'
      ? colors.gold
      : colors.danger;

  return (
    <View style={[{ gap: spacing.sm }, style]}>
      <View
        accessibilityLabel={`Credit score ${safeScore}, ${band}`}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: safeMax, now: safeScore }}
        style={{
          backgroundColor: `${colors.ink}10`,
          borderRadius: radii.full,
          height: 18,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            backgroundColor: bandColor,
            borderRadius: radii.full,
            height: '100%',
            width: `${normalized * 100}%`,
          }}
        />
      </View>
      <View style={{ alignItems: 'baseline', flexDirection: 'row', gap: spacing.sm }}>
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 34 }}>{safeScore}</Text>
        <Text style={{ color: bandColor, fontFamily: fonts.bodySemiBold }}>{band}</Text>
      </View>
    </View>
  );
}
