import {
  MOBILE_ANALYTICS_EVENTS,
  getTrackedEventsForTest,
  resetTrackedEventsForTest,
  trackEvent,
} from '@/lib/analytics';

describe('mobile analytics events', () => {
  beforeEach(() => resetTrackedEventsForTest());

  it('records structured pilot events with timestamped properties', () => {
    trackEvent(MOBILE_ANALYTICS_EVENTS.FIRST_SALE_RECORDED, {
      mode: 'online',
      paymentMethod: 'cash',
    });

    expect(getTrackedEventsForTest()).toEqual([
      expect.objectContaining({
        name: 'first_sale_recorded',
        properties: expect.objectContaining({
          mode: 'online',
          paymentMethod: 'cash',
        }),
        timestamp: expect.any(String),
      }),
    ]);
  });
});
