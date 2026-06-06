"""Locust load profile for the Phase 4 production-readiness target."""

from __future__ import annotations

from uuid import uuid4

from locust import HttpUser, between, task


class SMEFlowLoadTest(HttpUser):
    wait_time = between(0.1, 0.5)

    def on_start(self) -> None:
        options = self.environment.parsed_options
        token = getattr(options, "token", "") or ""
        self.item_id = getattr(options, "item_id", "") or ""
        self.auth_headers = {"Authorization": f"Bearer {token}"} if token else {}

    @task(10)
    def record_sale(self) -> None:
        item = (
            {"item_id": self.item_id, "qty": "1", "unit_price": "10.00"}
            if self.item_id
            else {"description": "Load test item", "qty": "1", "unit_price": "10.00"}
        )
        self.client.post(
            "/api/v1/sales/record",
            json={
                "items": [item],
                "payment_method": "cash",
                "idempotency_key": str(uuid4()),
            },
            headers=self.auth_headers,
            name="/api/v1/sales/record",
        )

    @task(3)
    def check_inventory(self) -> None:
        self.client.get("/api/v1/inventory/items", headers=self.auth_headers)

    @task(1)
    def get_report(self) -> None:
        self.client.get("/api/v1/sales/summary/daily", headers=self.auth_headers)
