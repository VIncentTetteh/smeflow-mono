# Sales Notifications

Daily sales summaries are sent by the Celery beat task `daily-sales-summary`.

Required runtime pieces:

- `beat` must be running so the 8 AM Ghana-time schedule is emitted.
- `worker` must be running and subscribed to the default queue.
- WhatsApp credentials must be configured for WhatsApp delivery.
- Business notification preferences must allow `sales.daily.summary`.
- SMS fallback is available only when SMS is enabled and the event preference allows SMS.

The task skips businesses with zero sales for the day. The message includes total sales,
revenue, cash, MoMo, credit revenue, and the top sold items.
