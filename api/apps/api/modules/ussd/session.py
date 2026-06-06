"""
USSD session store — Redis-backed with 120 s TTL (telco timeout).

Session keys:  ussd:{session_id}
State machine states:
  MAIN_MENU
  RECORD_SALE_ITEM   -> RECORD_SALE_QTY   -> RECORD_SALE_PRICE  -> RECORD_SALE_CONFIRM
  CHECK_STOCK_ITEM
  SEND_INVOICE_PHONE -> SEND_INVOICE_AMOUNT
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field

from apps.api.core.config import get_settings
from apps.api.core.redis import get_redis

USSD_TTL = 120  # seconds — standard telco USSD session timeout
_REDIS_PREFIX = "ussd"


@dataclass
class USSDSession:
    session_id: str
    phone: str  # caller MSISDN (+233...)
    business_id: str | None = None  # resolved after phone lookup
    user_id: str | None = None
    state: str = "MAIN_MENU"
    language: str = "en"  # locale for i18n strings (en | tw)
    data: dict = field(default_factory=dict)  # scratch space for multi-step flows

    # ── Persistence ────────────────────────────────────────────────────────────

    @classmethod
    async def get_or_create(cls, session_id: str, phone: str) -> USSDSession:
        redis = get_redis(db=get_settings().USSD_REDIS_DB)  # DB 3 reserved for USSD sessions
        raw = await redis.get(f"{_REDIS_PREFIX}:{session_id}")
        if raw:
            return cls(**json.loads(raw))
        session = cls(session_id=session_id, phone=phone)
        await session.save()
        return session

    async def save(self) -> None:
        redis = get_redis(db=get_settings().USSD_REDIS_DB)
        await redis.setex(
            f"{_REDIS_PREFIX}:{self.session_id}",
            USSD_TTL,
            json.dumps(asdict(self)),
        )

    async def delete(self) -> None:
        redis = get_redis(db=get_settings().USSD_REDIS_DB)
        await redis.delete(f"{_REDIS_PREFIX}:{self.session_id}")

    # ── Helpers ────────────────────────────────────────────────────────────────

    def transition(self, new_state: str, **data_updates: object) -> None:
        self.state = new_state
        self.data.update(data_updates)

    def clear_flow_data(self) -> None:
        self.data = {}
        self.state = "MAIN_MENU"
