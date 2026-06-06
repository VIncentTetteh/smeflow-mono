#!/usr/bin/env python3
"""Bootstrap the first SMEflow platform admin.

Usage (run from the api/ directory):
    python -m scripts.seed_admin --email admin@smeflow.app --password <strong_password>
    python -m scripts.seed_admin --email admin@smeflow.app --password <pw> --allowed-ips 203.0.113.5 10.0.0.0/8
"""

import argparse
import asyncio
import sys
from pathlib import Path

# Support running directly (python scripts/seed_admin.py) as well as via -m
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from apps.api.core.database import AsyncSessionLocal
from apps.api.modules.admin.service import AdminService


async def create_admin(email: str, password: str, allowed_ips: list[str]) -> None:
    async with AsyncSessionLocal() as db:
        svc = AdminService(db)
        try:
            admin = await svc.create_platform_admin(
                email=email,
                password=password,
                allowed_ips=allowed_ips,
            )
            await db.commit()
            print(f"✓ Admin created: {admin.email}  (id={admin.id})")
        except Exception as exc:
            await db.rollback()
            print(f"✗ Failed: {exc}", file=sys.stderr)
            sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create the first SMEflow platform admin")
    parser.add_argument("--email", required=True, help="Admin email address")
    parser.add_argument("--password", required=True, help="Admin password (use a strong password)")
    parser.add_argument(
        "--allowed-ips",
        nargs="*",
        default=[],
        metavar="CIDR",
        help="IP addresses/CIDRs allowed to log in (empty list = no IP restriction)",
    )
    args = parser.parse_args()
    asyncio.run(create_admin(args.email, args.password, args.allowed_ips))


if __name__ == "__main__":
    main()
