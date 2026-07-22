from __future__ import annotations

import json
import logging
import threading
from datetime import UTC, datetime, timedelta
from typing import Any

import pika
from pika.exceptions import AMQPError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.database import AiRepository
from app.events import AiEventProcessor

LOG = logging.getLogger("fraudcell.ai.rabbit")
RETRY_STAGES = (("ai.5s", 5), ("ai.30s", 30), ("ai.2m", 120), ("ai.10m", 600), ("ai.30m", 1800))
MAX_OUTBOX_ATTEMPTS = len(RETRY_STAGES)


class RabbitWorker:
    def __init__(self, repository: AiRepository, rabbitmq_url: str) -> None:
        self.repository = repository
        self.rabbitmq_url = rabbitmq_url
        self.processor = AiEventProcessor(repository)
        self.stop_event = threading.Event()
        self.threads: list[threading.Thread] = []

    def start(self) -> None:
        if self.threads:
            return
        self.stop_event.clear()
        self.threads = [
            threading.Thread(target=self._outbox_loop, name="ai-outbox", daemon=True),
            threading.Thread(target=self._consumer_loop, name="ai-consumer", daemon=True),
        ]
        for thread in self.threads:
            thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        for thread in self.threads:
            thread.join(timeout=5)
        self.threads.clear()

    def _outbox_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                with self._channel() as channel:
                    while not self.stop_event.is_set():
                        published = self._publish_batch(channel)
                        self.stop_event.wait(0.2 if published else 1.0)
            except (AMQPError, OSError, SQLAlchemyError) as error:
                LOG.warning(
                    "outbox dependency unavailable; PostgreSQL row retained: %s",
                    type(error).__name__,
                )
                self.stop_event.wait(5)

    def _consumer_loop(self) -> None:
        while not self.stop_event.is_set():
            try:
                with self._channel() as channel:
                    while not self.stop_event.is_set():
                        method, properties, body = channel.basic_get(
                            "fraudcell.ai.events.v1", auto_ack=False
                        )
                        if method is None:
                            self.stop_event.wait(0.5)
                            continue
                        try:
                            self.processor.process(body)
                            channel.basic_ack(method.delivery_tag)
                        except SQLAlchemyError:
                            channel.basic_nack(method.delivery_tag, requeue=True)
                            raise
                        except Exception as processing_error:
                            self._retry_or_dead_letter(
                                channel, method.delivery_tag, properties, body, processing_error
                            )
            except (AMQPError, OSError, SQLAlchemyError) as error:
                LOG.warning("rabbit consumer unavailable; will reconnect: %s", type(error).__name__)
                self.stop_event.wait(5)

    def _publish_batch(self, channel: Any) -> int:
        published_count = 0
        with self.repository.engine.begin() as connection:
            self.repository._system_context(connection)
            rows = (
                connection.execute(
                    text(
                        """
                    SELECT event_id, event_type, event_version, aggregate_id, aggregate_version,
                           correlation_id, causation_id, payload, occurred_at, attempt_count
                      FROM outbox_events
                     WHERE published_at IS NULL AND failed_at IS NULL
                       AND next_attempt_at <= now()
                     ORDER BY occurred_at FOR UPDATE SKIP LOCKED LIMIT 50
                    """
                    )
                )
                .mappings()
                .all()
            )
            for row in rows:
                envelope = {
                    "event_id": str(row["event_id"]),
                    "event_type": row["event_type"],
                    "event_version": row["event_version"],
                    "producer": "ai-service",
                    "occurred_at": row["occurred_at"].isoformat(),
                    "aggregate_id": str(row["aggregate_id"]),
                    "aggregate_version": row["aggregate_version"],
                    "correlation_id": str(row["correlation_id"]),
                    "causation_id": str(row["causation_id"]) if row["causation_id"] else None,
                    "payload": row["payload"],
                }
                try:
                    confirmed = channel.basic_publish(
                        exchange="fraudcell.events.v1",
                        routing_key=row["event_type"],
                        body=json.dumps(
                            envelope, ensure_ascii=False, separators=(",", ":")
                        ).encode(),
                        properties=pika.BasicProperties(
                            content_type="application/json",
                            delivery_mode=pika.DeliveryMode.Persistent,
                            message_id=str(row["event_id"]),
                            correlation_id=str(row["correlation_id"]),
                        ),
                        mandatory=True,
                    )
                    if confirmed is False:
                        raise AMQPError("publisher confirm was not acknowledged")
                    connection.execute(
                        text("UPDATE outbox_events SET published_at = now() WHERE event_id = :id"),
                        {"id": row["event_id"]},
                    )
                    published_count += 1
                except AMQPError as error:
                    attempt = int(row["attempt_count"]) + 1
                    if attempt > MAX_OUTBOX_ATTEMPTS:
                        connection.execute(
                            text(
                                """
                                UPDATE outbox_events
                                   SET attempt_count = :attempt, failed_at = now(),
                                       failure_code = :failure_code
                                 WHERE event_id = :id
                                """
                            ),
                            {
                                "attempt": attempt,
                                "failure_code": type(error).__name__[:80],
                                "id": row["event_id"],
                            },
                        )
                    else:
                        delay = RETRY_STAGES[attempt - 1][1]
                        connection.execute(
                            text(
                                """
                                UPDATE outbox_events
                                   SET attempt_count = :attempt, next_attempt_at = :next_attempt,
                                       failure_code = :failure_code
                                 WHERE event_id = :id
                                """
                            ),
                            {
                                "attempt": attempt,
                                "next_attempt": datetime.now(UTC) + timedelta(seconds=delay),
                                "failure_code": type(error).__name__[:80],
                                "id": row["event_id"],
                            },
                        )
                    break
        return published_count

    def _retry_or_dead_letter(
        self, channel: Any, delivery_tag: int, properties: Any, body: bytes, error: Exception
    ) -> None:
        headers = dict(properties.headers or {})
        attempt = int(headers.get("x-retry-attempt", 0))
        if attempt >= len(RETRY_STAGES):
            LOG.error("poison event rejected to AI DLQ: %s", type(error).__name__)
            channel.basic_nack(delivery_tag, requeue=False)
            return
        headers["x-retry-attempt"] = attempt + 1
        route, _ = RETRY_STAGES[attempt]
        confirmed = channel.basic_publish(
            exchange="fraudcell.ai.retry.v1",
            routing_key=route,
            body=body,
            properties=pika.BasicProperties(
                content_type="application/json",
                delivery_mode=pika.DeliveryMode.Persistent,
                headers=headers,
                message_id=properties.message_id,
                correlation_id=properties.correlation_id,
            ),
            mandatory=True,
        )
        if confirmed is False:
            raise AMQPError("retry publish was not acknowledged")
        channel.basic_ack(delivery_tag)

    def _channel(self) -> _ConfirmedChannel:
        return _ConfirmedChannel(self.rabbitmq_url)


class _ConfirmedChannel:
    def __init__(self, url: str) -> None:
        self.url = url
        self.connection: pika.BlockingConnection | None = None
        self.channel: Any = None

    def __enter__(self) -> Any:
        parameters = pika.URLParameters(self.url)
        parameters.connection_attempts = 1
        parameters.retry_delay = 0
        parameters.socket_timeout = 5
        parameters.blocked_connection_timeout = 10
        parameters.heartbeat = 30
        self.connection = pika.BlockingConnection(parameters)
        self.channel = self.connection.channel()
        self.channel.confirm_delivery()
        self.channel.basic_qos(prefetch_count=20)
        return self.channel

    def __exit__(self, *_: object) -> None:
        if self.connection is not None and self.connection.is_open:
            self.connection.close()
