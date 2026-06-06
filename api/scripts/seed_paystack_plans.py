"""
Bootstrap script: create Paystack billing plans for SMEflow subscription tiers.

Run once per environment (dev sandbox, staging, production):

    cd api
    python -m scripts.seed_paystack_plans

Prints the plan codes to stdout — copy them into your .env file as:
    PAYSTACK_STARTER_PLAN_CODE=PLN_xxx
    PAYSTACK_PRO_PLAN_CODE=PLN_xxx

The script is idempotent: if a plan with the same name already exists
Paystack returns it rather than creating a duplicate.
"""

import asyncio
from decimal import Decimal


async def main() -> None:
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

    from apps.api.core.config import get_settings
    from libs.payment_clients.paystack import PaystackClient

    settings = get_settings()
    if not settings.PAYSTACK_SECRET_KEY:
        print("ERROR: PAYSTACK_SECRET_KEY is not set. Cannot create plans.")
        return

    client = PaystackClient()

    plans = [
        {
            "name": "SMEflow Starter Monthly",
            "interval": "monthly",
            "amount_ghs": Decimal("49"),
            "env_key": "PAYSTACK_STARTER_PLAN_CODE",
        },
        {
            "name": "SMEflow Pro Monthly",
            "interval": "monthly",
            "amount_ghs": Decimal("149"),
            "env_key": "PAYSTACK_PRO_PLAN_CODE",
        },
    ]

    print(f"\nCreating Paystack billing plans on {settings.PAYSTACK_BASE_URL}...\n")

    for plan_def in plans:
        try:
            plan = await client.create_plan(
                name=plan_def["name"],
                interval=plan_def["interval"],
                amount_ghs=plan_def["amount_ghs"],
            )
            plan_code = plan.get("plan_code", "unknown")
            print(f"  ✓ {plan_def['name']}")
            print(f"    plan_code : {plan_code}")
            print(f"    Add to .env: {plan_def['env_key']}={plan_code}\n")
        except Exception as exc:
            print(f"  ✗ Failed to create '{plan_def['name']}': {exc}\n")

    await client._close()


if __name__ == "__main__":
    asyncio.run(main())
