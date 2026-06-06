# Africa's Talking - Quick Start Guide

## 5-Minute Setup

### 1. Create Free Account (2 min)
```bash
# Visit: https://africastalking.com
# Sign up with your email
# Verify email
```

### 2. Get API Credentials (1 min)
```bash
# Dashboard → Settings → API Keys
# Copy your API Key
# Note your Username (usually your account name or "sandbox")
```

### 3. Configure .env (1 min)
```bash
# Create or update .env file
AT_API_KEY=your_api_key_here
AT_USERNAME=sandbox  # Use "sandbox" for testing, or your actual username
AT_SENDER_ID=SMEFlow
```

### 4. Test SMS (1 min)
```bash
# Start the app
make dev

# In another terminal, send a test OTP:
curl -X POST http://localhost:8000/api/v1/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"phone": "+233244000000"}'
```

## What You Should Know

### SMS Channels
- **Sandbox Mode**: Free, unlimited messages for testing
- **Production**: Small cost per SMS (~GHS 0.05)

### Default Events with SMS
```
✓ Payment confirmed
✓ Stock low alert  
✓ Tax deadline reminder
✓ Credit offer
✓ Payroll complete
```

### Quick API Tests

**Test 1: Request OTP (sends SMS)**
```bash
curl -X POST http://localhost:8000/api/v1/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"phone": "+233244000000"}'
```

**Test 2: Send bulk message**
```bash
# First, get a token
TOKEN=$(curl -X POST http://localhost:8000/api/v1/auth/otp/verify \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+233244000000",
    "otp": "123456"
  }' | jq -r '.access_token')

# Send bulk SMS
curl -X POST http://localhost:8000/api/v1/notifications/bulk \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hey! Check out our new products",
    "channel": "sms"
  }'
```

## Files You Need to Know

| File | Purpose |
|------|---------|
| `libs/at_client/` | Africa's Talking Python client |
| `apps/api/modules/notifications/service.py` | Notification dispatch logic |
| `AFRICAS_TALKING_SETUP.md` | Full setup guide |
| `AFRICAS_TALKING_INTEGRATION.py` | Integration points documentation |

## Common Issues

| Problem | Solution |
|---------|----------|
| "Invalid API key" | Copy exact key from dashboard, no spaces |
| "Insufficient balance" | Use `AT_USERNAME=sandbox` for free testing |
| SMS not received | Check phone number format: `+country_code...` |
| "Unknown error" | Check app logs: `docker compose logs api` |

## Documentation Links

- Setup Guide: `AFRICAS_TALKING_SETUP.md`
- Integration Points: `AFRICAS_TALKING_INTEGRATION.py`
- Africa's Talking Docs: https://africastalking.com/sms/docs
- Source Code: `libs/at_client/`

## Next Steps

1. ✅ Set up Africa's Talking account
2. ✅ Configure .env with API credentials
3. ✅ Test SMS sending
4. ✅ Customize notification preferences for your business
5. ✅ Monitor delivery reports
6. ✅ Set up production billing

## Support

- Check logs: `docker compose logs api | grep -i sms`
- Test directly: `python -m libs.at_client.test_client`
- See full guide: `cat AFRICAS_TALKING_SETUP.md`
