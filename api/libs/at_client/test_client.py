"""Test Africa's Talking SMS functionality."""

import asyncio

from libs.at_client import ATClient, ATError


async def test_send_sms():
    """Test sending a single SMS."""
    # Configuration (would come from env in production)
    api_key = "YOUR_AT_API_KEY"  # Get from https://africastalking.com
    username = "sandbox"  # Use 'sandbox' for testing
    phone = "+233244000000"  # Test phone number

    try:
        async with ATClient(api_key=api_key, username=username) as client:
            response = await client.send_single_sms(
                to=phone,
                message="Hello from SME Flow! This is a test SMS.",
                from_="SMEFlow",
            )
            print("SMS sent successfully!")
            print(f"Response: {response.model_dump()}")
    except ATError as e:
        print(f"Error sending SMS: {e}")


async def test_get_balance():
    """Test getting account balance."""
    api_key = "YOUR_AT_API_KEY"
    username = "sandbox"

    try:
        async with ATClient(api_key=api_key, username=username) as client:
            balance = await client.get_account_balance()
            print("Account balance:")
            print(balance)
    except ATError as e:
        print(f"Error getting balance: {e}")


if __name__ == "__main__":
    asyncio.run(test_send_sms())
    # asyncio.run(test_get_balance())
