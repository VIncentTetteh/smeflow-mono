"""Africa's Talking Integration Points Documentation.

This file documents all the places in SME Flow where Africa's Talking SMS is used.
"""

# ============================================================================
# LOCATION 1: Authentication Module - OTP Delivery
# ============================================================================
# File: apps/api/modules/auth/router.py
# 
# When user requests OTP:
#   POST /api/v1/auth/otp/request
#   {
#     "phone": "+233244000000"
#   }
#
# Flow:
#   1. AuthService generates 6-digit OTP
#   2. OTP stored in Redis (expires in 5 minutes)
#   3. NotificationDispatcher sends SMS via Africa's Talking
#   4. User receives: "Your SME Flow OTP is 123456. It expires in 5 minutes."
#
# Configuration Required:
#   - AT_API_KEY: Your Africa's Talking API Key
#   - AT_USERNAME: Your Africa's Talking username
#   - AT_SENDER_ID: Your approved sender ID (e.g., "SMEFlow")

# ============================================================================
# LOCATION 2: Notifications Module - Event-Based SMS
# ============================================================================
# File: apps/api/modules/notifications/service.py
#
# Supported Events (configurable per business):
#   - sale.recorded: When a new sale is recorded
#   - payment.confirmed: When payment is received
#   - stock.low: When stock falls below threshold
#   - stock.low.digest: Daily digest of low stock items
#   - sales.daily.summary: Daily sales summary
#   - tax.deadline: Tax filing deadline reminder
#   - credit.offer: Credit limit increase offer
#   - payroll.run_complete: Payroll processing completed
#   - invoice.sent: When invoice is sent to customer
#
# Example Usage:
#   from apps.api.modules.notifications.service import (
#       NotificationDispatcher,
#       NotificationMessage
#   )
#
#   message = NotificationMessage(
#       phone="+233244000000",
#       text="Payment of GHS 500 received from John Doe"
#   )
#   result = await NotificationDispatcher().send(message, channel="sms")

# ============================================================================
# LOCATION 3: Bulk SMS Endpoint
# ============================================================================
# File: apps/api/modules/notifications/router.py
#
# Users can send bulk messages to customers, staff, or all contacts:
#   POST /api/v1/notifications/bulk
#   Authorization: Bearer <token>
#   {
#     "recipient_type": "customers",  # customers | staff | all
#     "message": "Your business tax is due soon",
#     "channel": "sms"  # sms | whatsapp | auto
#   }
#
# Response includes:
#   - Number of messages sent
#   - Number of failures
#   - Cost (if paid plan)

# ============================================================================
# LOCATION 4: Payment Confirmations (via Celery Workers)
# ============================================================================
# File: apps/api/workers/tasks/payment_tasks.py
#
# When payment is processed:
#   1. Payment task executed in background worker
#   2. NotificationDispatcher sends SMS confirmation
#   3. Message format: "Payment of GHS [amount] confirmed. Ref: [ref_number]"
#   4. Asynchronous - doesn't block API response

# ============================================================================
# LOCATION 5: Sales Recording
# ============================================================================
# File: apps/api/modules/sales/service.py
#
# When business records a new sale:
#   1. Sale is saved to database
#   2. If SMS enabled for event "sale.recorded"
#   3. Customer SMS sent: "[Customer] purchased [items] for GHS [amount]"
#   4. Asynchronous delivery

# ============================================================================
# LOCATION 6: Inventory Alerts
# ============================================================================
# File: apps/api/modules/inventory/service.py
#
# When stock falls below minimum threshold:
#   1. Inventory service detects low stock
#   2. Sends alert SMS to business owner
#   3. Message: "Low stock alert: [item] down to [quantity] units"
#   4. Can be configured for immediate or digest mode

# ============================================================================
# ENVIRONMENT CONFIGURATION
# ============================================================================
#
# In .env file, configure:
#
#   # SMS (Africa's Talking)
#   AT_API_KEY=your_actual_api_key_from_africastalking
#   AT_USERNAME=your_at_username
#   AT_SENDER_ID=SMEFlow
#
# For Testing (Sandbox):
#
#   AT_API_KEY=test-key-or-your-real-key
#   AT_USERNAME=sandbox
#   AT_SENDER_ID=SMEFlow

# ============================================================================
# NOTIFICATION PREFERENCES
# ============================================================================
#
# Users can customize which events trigger SMS:
#
#   GET /api/v1/notifications/preferences
#   - Returns current preferences for all events
#
#   PUT /api/v1/notifications/preferences
#   {
#     "event_prefs": {
#       "payment.confirmed": {"sms": true, "whatsapp": false},
#       "stock.low": {"sms": true, "whatsapp": true}
#     }
#   }
#
# Default preferences (can be overridden):
# {
#   "sale.recorded": {"whatsapp": True, "sms": False},
#   "payment.confirmed": {"whatsapp": True, "sms": True},
#   "stock.low": {"whatsapp": True, "sms": True},
#   "stock.low.digest": {"whatsapp": True, "sms": True},
#   "sales.daily.summary": {"whatsapp": True, "sms": False},
#   "tax.deadline": {"whatsapp": True, "sms": True},
#   "credit.offer": {"whatsapp": True, "sms": True},
#   "payroll.run_complete": {"whatsapp": True, "sms": False},
#   "invoice.sent": {"whatsapp": True, "sms": False},
# }

# ============================================================================
# ERROR HANDLING
# ============================================================================
#
# The system gracefully handles:
#   - Missing API credentials: Skips SMS, logs warning
#   - Invalid phone numbers: Fails with validation error
#   - Insufficient balance: Logs error, returns failure status
#   - Network errors: Implements automatic retry
#   - Invalid sender ID: Returns error with status code
#
# All errors are logged to structlog with context:
#   - Phone number (last 4 digits only)
#   - Error type
#   - Status code if applicable

# ============================================================================
# MONITORING & DELIVERY REPORTS
# ============================================================================
#
# Africa's Talking provides delivery reports via:
#
# 1. Polling API:
#    GET /api/v1/notifications/delivery-reports
#
# 2. Webhook Callbacks (optional):
#    - Configure in Africa's Talking dashboard
#    - POST to: https://yourapp.com/api/v1/notifications/webhook
#    - Receives: message_id, status, timestamp
#
# 3. Direct API Call:
#    from libs.at_client import ATClient
#    async with ATClient(...) as client:
#        reports = await client.get_sms_delivery_reports()

# ============================================================================
# TESTING
# ============================================================================
#
# Unit Tests:
#   python -m pytest apps/api/tests/unit/test_notifications.py -v
#
# Integration Tests:
#   python -m pytest apps/api/tests/integration/test_notifications_phase2.py -v
#
# Manual Test:
#   python -m libs.at_client.test_client
#
# cURL Test:
#   curl -X POST http://localhost:8000/api/v1/auth/otp/request \
#     -H "Content-Type: application/json" \
#     -d '{"phone": "+233244000000"}'

# ============================================================================
# COSTS & PRICING
# ============================================================================
#
# Africa's Talking SMS Pricing (Ghana):
#   - ~GHS 0.05 per SMS (approximately)
#   - Rates vary by country
#   - Volume discounts available
#
# Free Tier:
#   - New accounts get free credit to test
#   - Sandbox mode: unlimited messages
#
# For Production:
#   1. Verify pricing for your use case
#   2. Set up billing alerts
#   3. Monitor usage dashboard
#   4. Plan for peak times (e.g., end of month sales)

# ============================================================================
# TROUBLESHOOTING GUIDE
# ============================================================================
#
# Issue: SMS not sending
#   Solution 1: Check AT_API_KEY in .env
#   Solution 2: Verify phone number format (+country code)
#   Solution 3: Check account balance
#   Solution 4: Review application logs
#
# Issue: "Invalid API Key"
#   Solution: Copy exact key from Africa's Talking dashboard
#
# Issue: "Insufficient Balance"
#   Solution 1: Top-up account on dashboard
#   Solution 2: Use sandbox mode for testing
#
# Issue: "Invalid Sender ID"
#   Solution: Wait for sender ID approval or use sandbox
#
# Issue: SMS received but no log entry
#   Solution: Check NotificationDispatcher middleware
#
# Issue: Delivery reports not working
#   Solution: Verify webhook URL configured in AT dashboard

print("Africa's Talking SMS Integration Guide Loaded")
print("See AFRICAS_TALKING_SETUP.md for detailed setup instructions")
