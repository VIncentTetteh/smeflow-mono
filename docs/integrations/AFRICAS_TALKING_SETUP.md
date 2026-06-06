# Africa's Talking SMS Integration Setup Guide

## Overview

SME Flow uses **Africa's Talking** for SMS notifications and messaging. This guide walks you through the setup process step by step.

## Step 1: Create an Africa's Talking Account

1. Go to [https://africastalking.com](https://africastalking.com)
2. Click **Sign Up** in the top-right corner
3. Fill in your details:
   - Full Name
   - Email Address
   - Country (Ghana)
   - Phone Number
   - Password
4. Accept the terms and click **Create Account**
5. Verify your email address

## Step 2: Access the Dashboard

1. Log in to your Africa's Talking account
2. You'll be redirected to the dashboard
3. Keep this tab open - you'll need credentials from here

## Step 3: Get Your API Credentials

### In Live/Production:

1. From the Dashboard, click **Settings** (gear icon)
2. Navigate to **API Keys** tab
3. Copy your **API Key** - this is your `AT_API_KEY`
4. Note your **Username** - this is your `AT_USERNAME` (usually your account name)

### For Testing (Sandbox):

1. Africa's Talking provides a **Sandbox** environment for testing
2. Go to **Simulator** in the left sidebar
3. You can test SMS without using credits
4. Use `AT_USERNAME=sandbox` for testing
5. The API key works for both sandbox and live

## Step 4: Set Up Sender ID

1. From Dashboard, click **Senders**
2. Click **Request New Sender ID**
3. Enter:
   - Sender ID: `SMEFlow` (or your business name)
   - Use Case: Business/Enterprise
   - Description: SMS notifications for SME management platform
4. Wait for approval (usually 1-2 hours)
5. Once approved, use this as `AT_SENDER_ID` in your .env

**Note:** In sandbox mode, you can use any sender ID without approval.

## Step 5: Update Your .env File

Create or update your `.env` file with the following values:

```env
# ------ SMS (Africa's Talking) ------
AT_API_KEY=your_actual_api_key_here
AT_USERNAME=your_username_here
AT_SENDER_ID=SMEFlow
```

### Example for Testing:

```env
AT_API_KEY=1234567890abcdef1234567890abcdef
AT_USERNAME=sandbox
AT_SENDER_ID=SMEFlow
```

## Step 6: Configure Notification Preferences

The system supports the following default event notifications via SMS:

```python
DEFAULT_EVENT_PREFS = {
    "sale.recorded": {"whatsapp": True, "sms": False},
    "payment.confirmed": {"whatsapp": True, "sms": True},
    "stock.low": {"whatsapp": True, "sms": True},
    "stock.low.digest": {"whatsapp": True, "sms": True},
    "sales.daily.summary": {"whatsapp": True, "sms": False},
    "tax.deadline": {"whatsapp": True, "sms": True},
    "credit.offer": {"whatsapp": True, "sms": True},
    "payroll.run_complete": {"whatsapp": True, "sms": False},
    "invoice.sent": {"whatsapp": True, "sms": False},
}
```

Users can customize these preferences through the API.

## Step 7: Test SMS Sending

### Via Python Script:

```python
# Run the test client
python -m libs.at_client.test_client
```

### Via API:

1. Make an OTP request (which sends SMS):
   ```bash
   curl -X POST http://localhost:8000/api/v1/auth/otp/request \
     -H "Content-Type: application/json" \
     -d '{"phone": "+233244000000"}'
   ```

2. Check the application logs for delivery status

### Check Account Balance:

1. Go to Africa's Talking Dashboard
2. Look for **Account Balance** or **Credits Remaining**
3. For testing, you have unlimited sandbox credits

## Step 8: Integrate with Your Application

The notification system automatically uses Africa's Talking when:

1. `AT_API_KEY` is configured in .env
2. An event requires SMS delivery
3. User notification preferences enable SMS

### Example: Sending SMS on Sale Recording

```python
from apps.api.modules.notifications.service import NotificationDispatcher, NotificationMessage

message = NotificationMessage(
    phone="+233244000000",
    text="Sale recorded: 50 items sold for GHS 1,200"
)

result = await NotificationDispatcher().send(message, channel="sms")
print(result)  # {"status": "sent", "channel": "sms"}
```

## Step 9: Monitor Delivery Reports

Africa's Talking provides delivery reports showing:
- Message ID
- Recipient phone number
- Delivery status (Success/Failed)
- Delivery time
- Failure reason (if applicable)

### Get Delivery Reports:

```python
async with ATClient(
    api_key=settings.AT_API_KEY,
    username=settings.AT_USERNAME
) as client:
    reports = await client.get_sms_delivery_reports()
```

## Troubleshooting

### Issue: "Invalid API key"
- Check your `AT_API_KEY` in .env matches exactly
- Ensure you copied from the dashboard, not documentation

### Issue: "Insufficient balance"
- Account balance is exhausted
- Top-up your account on the dashboard
- Or use sandbox mode for testing (`AT_USERNAME=sandbox`)

### Issue: "Invalid sender ID"
- Sender ID not approved yet
- Use sandbox mode or wait for approval
- In sandbox, any sender ID works

### Issue: SMS not received
- Check phone number format: must be international (+233...)
- Verify recipient country supports SMS
- Check message length (>160 chars may be split)
- See delivery reports for failure reason

### Issue: Callback/Webhook not working
- Ensure your server is publicly accessible
- Africa's Talking needs to POST to your webhook URL
- Configure webhook in Africa's Talking dashboard

## API Reference

### NotificationDispatcher

```python
from apps.api.modules.notifications.service import (
    NotificationDispatcher,
    NotificationMessage
)

dispatcher = NotificationDispatcher()

message = NotificationMessage(
    phone="+233244000000",
    text="Your OTP is 123456"
)

# Send SMS
result = await dispatcher.send(message, channel="sms")

# Auto-route (uses SMS if WhatsApp not configured)
result = await dispatcher.send(message)
```

### ATClient Direct Usage

```python
from libs.at_client import ATClient

async with ATClient(
    api_key="YOUR_API_KEY",
    username="YOUR_USERNAME"
) as client:
    # Send single SMS
    response = await client.send_single_sms(
        to="+233244000000",
        message="Hello!",
        from_="SMEFlow"
    )
    
    # Send bulk SMS
    response = await client.send_sms(
        to=["+233244000000", "+233244000001"],
        message="Bulk message",
        from_="SMEFlow"
    )
    
    # Get balance
    balance = await client.get_account_balance()
    
    # Get delivery reports
    reports = await client.get_sms_delivery_reports()
```

## Production Checklist

- [ ] Switch from sandbox to production API key
- [ ] Update `AT_USERNAME` to your actual account username
- [ ] Set `AT_SENDER_ID` to approved sender ID
- [ ] Enable SMS in user notification preferences
- [ ] Test end-to-end SMS flow
- [ ] Monitor delivery reports regularly
- [ ] Set up billing alerts
- [ ] Configure webhook for delivery confirmations
- [ ] Test error handling and retries

## Additional Resources

- [Africa's Talking Documentation](https://africastalking.com/sms/docs)
- [API Reference](https://africastalking.com/sms/docs)
- [Sandbox Testing Guide](https://africastalking.com/sms/sandbox)
- [Pricing](https://africastalking.com/sms/pricing)