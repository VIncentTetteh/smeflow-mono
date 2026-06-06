export const MOBILE_ANALYTICS_EVENTS = {
  ONBOARDING_COMPLETED: 'onboarding_completed',
  FIRST_ITEM_ADDED: 'first_item_added',
  FIRST_SALE_RECORDED: 'first_sale_recorded',
  INVOICE_SENT: 'invoice_sent',
  PAYMENT_REQUESTED: 'payment_requested',
  SYNC_FAILED: 'sync_failed',
  KYC_SUBMITTED: 'kyc_submitted',
} as const;

export type MobileAnalyticsEvent =
  (typeof MOBILE_ANALYTICS_EVENTS)[keyof typeof MOBILE_ANALYTICS_EVENTS];

export type AnalyticsProperties = Record<string, boolean | number | string | null | undefined>;

export interface AnalyticsEnvelope {
  name: MobileAnalyticsEvent;
  properties: AnalyticsProperties;
  timestamp: string;
}

type AnalyticsSink = (event: AnalyticsEnvelope) => void;

const trackedEventsForTest: AnalyticsEnvelope[] = [];

let sink: AnalyticsSink = (event) => {
  trackedEventsForTest.push(event);
  if (typeof __DEV__ !== 'undefined' && __DEV__ && process.env.NODE_ENV !== 'test') {
    console.info('[analytics]', event.name, event.properties);
  }
};

export function setAnalyticsSinkForTest(nextSink: AnalyticsSink) {
  sink = nextSink;
}

export function resetTrackedEventsForTest() {
  trackedEventsForTest.length = 0;
  sink = (event) => {
    trackedEventsForTest.push(event);
    if (typeof __DEV__ !== 'undefined' && __DEV__ && process.env.NODE_ENV !== 'test') {
      console.info('[analytics]', event.name, event.properties);
    }
  };
}

export function getTrackedEventsForTest() {
  return [...trackedEventsForTest];
}

export function trackEvent(
  name: MobileAnalyticsEvent,
  properties: AnalyticsProperties = {}
) {
  sink({
    name,
    properties,
    timestamp: new Date().toISOString(),
  });
}
