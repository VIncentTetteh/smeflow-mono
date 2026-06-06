"""Custom Prometheus metrics for business events."""

from __future__ import annotations

from prometheus_client import Counter, Histogram

sales_counter = Counter(
    "smeflow_sales_total",
    "Total sales recorded",
    ["payment_method", "business_tier"],
)

sale_value_histogram = Histogram(
    "smeflow_sale_value_ghs",
    "Recorded sale value in Ghana cedis",
    ["payment_method", "business_tier"],
    buckets=(1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000, 10000, 50000),
)

payment_duration = Histogram(
    "smeflow_payment_duration_seconds",
    "MoMo payment round-trip time",
    ["provider", "status"],
    buckets=(0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60),
)


def record_sale_metric(payment_method: str, business_tier: str, total_ghs: float) -> None:
    sales_counter.labels(payment_method=payment_method, business_tier=business_tier).inc()
    sale_value_histogram.labels(
        payment_method=payment_method,
        business_tier=business_tier,
    ).observe(total_ghs)
