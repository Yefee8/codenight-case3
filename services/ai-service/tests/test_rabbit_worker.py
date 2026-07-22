from __future__ import annotations

from contextlib import nullcontext
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from uuid import UUID

import pytest
from pika.exceptions import AMQPError

from app import rabbit_worker as rabbit_module
from app.rabbit_worker import RabbitWorker, _ConfirmedChannel


class Result:
    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.rows = rows or []

    def mappings(self) -> Result:
        return self

    def all(self) -> list[dict[str, Any]]:
        return self.rows


class Connection:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def execute(self, statement: Any, parameters: dict[str, Any] | None = None) -> Result:
        sql = str(statement)
        self.calls.append((sql, parameters or {}))
        if "SELECT event_id" in sql:
            return Result(self.rows)
        return Result()


class Repository:
    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.connection = Connection(rows or [])
        self.engine = self
        self.context_count = 0

    def begin(self):
        return nullcontext(self.connection)

    def _system_context(self, _: Any) -> None:
        self.context_count += 1


class Channel:
    def __init__(self, confirm: bool = True) -> None:
        self.confirm = confirm
        self.published: list[dict[str, Any]] = []
        self.acks: list[int] = []
        self.nacks: list[tuple[int, bool]] = []

    def basic_publish(self, **kwargs: Any) -> bool:
        self.published.append(kwargs)
        return self.confirm

    def basic_ack(self, delivery_tag: int) -> None:
        self.acks.append(delivery_tag)

    def basic_nack(self, delivery_tag: int, requeue: bool) -> None:
        self.nacks.append((delivery_tag, requeue))


def outbox_row(attempt: int = 0) -> dict[str, Any]:
    return {
        "event_id": UUID(int=1),
        "event_type": "ai.prediction-created",
        "event_version": 1,
        "aggregate_id": UUID(int=2),
        "aggregate_version": 1,
        "correlation_id": UUID(int=3),
        "causation_id": None,
        "payload": {"prediction_id": str(UUID(int=2))},
        "occurred_at": datetime(2026, 7, 22, tzinfo=UTC),
        "attempt_count": attempt,
    }


def properties(attempt: int = 0) -> SimpleNamespace:
    return SimpleNamespace(
        headers={"x-retry-attempt": attempt},
        message_id="message-1",
        correlation_id="correlation-1",
    )


def test_outbox_publish_requires_confirm_before_marking_published() -> None:
    repository = Repository([outbox_row()])
    worker = RabbitWorker(repository, "amqp://unused")  # type: ignore[arg-type]
    channel = Channel(confirm=True)

    assert worker._publish_batch(channel) == 1
    assert repository.context_count == 1
    assert channel.published[0]["mandatory"] is True
    assert any("published_at = now()" in sql for sql, _ in repository.connection.calls)


@pytest.mark.parametrize(
    ("attempt", "expected_fragment"),
    [(0, "next_attempt_at"), (4, "next_attempt_at"), (5, "failed_at = now()")],
)
def test_outbox_failure_is_delayed_then_terminal(attempt: int, expected_fragment: str) -> None:
    repository = Repository([outbox_row(attempt)])
    worker = RabbitWorker(repository, "amqp://unused")  # type: ignore[arg-type]

    assert worker._publish_batch(Channel(confirm=False)) == 0
    update_sql, values = repository.connection.calls[-1]
    assert expected_fragment in update_sql
    assert values["attempt"] == attempt + 1
    assert values["failure_code"] == "AMQPError"


def test_retry_publish_is_confirmed_before_source_ack_and_then_dlq() -> None:
    worker = RabbitWorker(Repository(), "amqp://unused")  # type: ignore[arg-type]
    channel = Channel(confirm=True)
    worker._retry_or_dead_letter(channel, 7, properties(), b"{}", ValueError("bad event"))

    assert channel.published[0]["exchange"] == "fraudcell.ai.retry.v1"
    assert channel.published[0]["routing_key"] == "ai.5s"
    assert channel.published[0]["properties"].headers["x-retry-attempt"] == 1
    assert channel.acks == [7]

    unconfirmed = Channel(confirm=False)
    with pytest.raises(AMQPError, match="not acknowledged"):
        worker._retry_or_dead_letter(unconfirmed, 8, properties(), b"{}", ValueError("bad event"))
    assert unconfirmed.acks == []

    exhausted = Channel()
    worker._retry_or_dead_letter(exhausted, 9, properties(attempt=5), b"{}", ValueError("poison"))
    assert exhausted.nacks == [(9, False)]


class FakeThread:
    def __init__(self, *, target: Any, name: str, daemon: bool) -> None:
        self.target = target
        self.name = name
        self.daemon = daemon
        self.started = False
        self.joined = False

    def start(self) -> None:
        self.started = True

    def join(self, timeout: int) -> None:
        assert timeout == 5
        self.joined = True


def test_worker_lifecycle_is_idempotent_and_restartable(monkeypatch) -> None:
    monkeypatch.setattr(rabbit_module.threading, "Thread", FakeThread)
    worker = RabbitWorker(Repository(), "amqp://unused")  # type: ignore[arg-type]

    worker.start()
    first_threads = list(worker.threads)
    worker.start()
    assert worker.threads == first_threads
    assert all(thread.started for thread in first_threads)
    worker.stop()
    assert worker.threads == []
    assert all(thread.joined for thread in first_threads)
    worker.start()
    assert worker.stop_event.is_set() is False


class StopOnWait:
    def __init__(self) -> None:
        self.stopped = False

    def is_set(self) -> bool:
        return self.stopped

    def wait(self, _: float) -> None:
        self.stopped = True

    def set(self) -> None:
        self.stopped = True

    def clear(self) -> None:
        self.stopped = False


def test_outbox_and_consumer_loops_exit_cleanly(monkeypatch) -> None:
    worker = RabbitWorker(Repository(), "amqp://unused")  # type: ignore[arg-type]
    worker.stop_event = StopOnWait()  # type: ignore[assignment]
    monkeypatch.setattr(worker, "_channel", lambda: nullcontext(Channel()))
    monkeypatch.setattr(worker, "_publish_batch", lambda _: 0)
    worker._outbox_loop()
    assert worker.stop_event.is_set()

    class EmptyConsumer(Channel):
        def basic_get(self, *_: Any, **__: Any):
            return None, properties(), b""

    worker.stop_event.clear()
    monkeypatch.setattr(worker, "_channel", lambda: nullcontext(EmptyConsumer()))
    worker._consumer_loop()
    assert worker.stop_event.is_set()


def test_consumer_acknowledges_success_and_retries_processing_error(monkeypatch) -> None:
    class Consumer(Channel):
        def __init__(self, worker: RabbitWorker) -> None:
            super().__init__()
            self.worker = worker

        def basic_get(self, *_: Any, **__: Any):
            method = SimpleNamespace(delivery_tag=11)
            return method, properties(), b"{}"

        def basic_ack(self, delivery_tag: int) -> None:
            super().basic_ack(delivery_tag)
            self.worker.stop_event.set()

    worker = RabbitWorker(Repository(), "amqp://unused")  # type: ignore[arg-type]
    success_channel = Consumer(worker)
    worker.processor = SimpleNamespace(process=lambda _: True)
    monkeypatch.setattr(worker, "_channel", lambda: nullcontext(success_channel))
    worker._consumer_loop()
    assert success_channel.acks == [11]

    worker.stop_event.clear()
    retry_calls: list[int] = []

    def fail(_: bytes) -> None:
        raise ValueError("invalid")

    def retry(*args: Any) -> None:
        retry_calls.append(args[1])
        worker.stop_event.set()

    worker.processor = SimpleNamespace(process=fail)
    monkeypatch.setattr(worker, "_retry_or_dead_letter", retry)
    error_channel = Consumer(worker)
    monkeypatch.setattr(worker, "_channel", lambda: nullcontext(error_channel))
    worker._consumer_loop()
    assert retry_calls == [11]

    worker.stop_event.clear()

    def database_down(_: bytes) -> None:
        from sqlalchemy.exc import SQLAlchemyError

        worker.stop_event.set()
        raise SQLAlchemyError("down")

    worker.processor = SimpleNamespace(process=database_down)
    database_channel = Consumer(worker)
    monkeypatch.setattr(worker, "_channel", lambda: nullcontext(database_channel))
    worker._consumer_loop()
    assert database_channel.nacks == [(11, True)]


def test_confirmed_channel_configures_confirm_qos_and_closes(monkeypatch) -> None:
    channel = SimpleNamespace(
        confirm_delivery=lambda: None,
        basic_qos=lambda **kwargs: kwargs,
    )

    class BlockingConnection:
        is_open = True

        def __init__(self, parameters: Any) -> None:
            self.parameters = parameters
            self.closed = False

        def channel(self) -> Any:
            return channel

        def close(self) -> None:
            self.closed = True

    created: list[BlockingConnection] = []

    def connect(parameters: Any) -> BlockingConnection:
        connection = BlockingConnection(parameters)
        created.append(connection)
        return connection

    monkeypatch.setattr(rabbit_module.pika, "BlockingConnection", connect)
    context = _ConfirmedChannel("amqp://guest:guest@localhost/%2F")
    with context as configured:
        assert configured is channel
        assert created[0].parameters.connection_attempts == 1
        assert created[0].parameters.heartbeat == 30
    assert created[0].closed is True
