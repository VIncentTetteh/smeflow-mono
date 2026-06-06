import { useEffect, useRef } from 'react';

export interface SSEEvent {
  business_id: string;
  event_type: string;
  message: string;
}

export function useSSE(
  businessId: string | null | undefined,
  onEvent: (event: SSEEvent) => void
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!businessId) return;

    const es = new EventSource(`/api/stream?business_id=${businessId}`);

    es.onmessage = (e) => {
      try {
        const parsed: SSEEvent = JSON.parse(e.data as string);
        onEventRef.current(parsed);
      } catch {
        // keepalive comment or non-JSON — ignore
      }
    };

    es.onerror = () => {
      // Browser will auto-reconnect EventSource
    };

    return () => {
      es.close();
    };
  }, [businessId]);
}
