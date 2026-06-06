"""Unit tests for Celery dispatch wrapper."""


def test_enqueue_task_calls_delay_outside_pytest(monkeypatch):
    from uuid import uuid4

    from apps.api.workers.dispatch import enqueue_task

    class FakeTask:
        name = "fake.task"

        def __init__(self) -> None:
            self.calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

        def delay(self, *args: object, **kwargs: object) -> str:
            self.calls.append((args, kwargs))
            return "queued"

    task = FakeTask()
    arg = str(uuid4())
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)

    result = enqueue_task(task, arg, flag=True)

    assert result == "queued"
    assert task.calls == [((arg,), {"flag": True})]
