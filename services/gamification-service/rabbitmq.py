import json
import logging
import os
from threading import Event

from sqlalchemy.exc import IntegrityError

from database import SessionLocal
from models import AnalystProfile, PointLedger, utcnow


log = logging.getLogger(__name__)


def process_decision_event(message: dict, session_factory=SessionLocal) -> bool:
    payload = message.get("payload") or message
    event_id = str(message.get("event_id") or payload.get("event_id") or "")
    analyst_id = str(
        payload.get("analyst_id")
        or payload.get("assigned_analyst_id")
        or payload.get("decided_by")
        or ""
    )
    if not event_id or not analyst_id:
        raise ValueError("event_id and analyst_id are required")

    sla_breached = payload.get("sla_breached") is True
    delta = 10 - (5 if sla_breached else 0)
    reason = "BLOCKED_CASE_AND_SLA_BREACH" if sla_breached else "BLOCKED_CASE"

    with session_factory() as db:
        if db.get(PointLedger, event_id):
            return False
        profile = db.get(AnalystProfile, analyst_id)
        if profile is None:
            profile = AnalystProfile(
                analyst_id=analyst_id,
                full_name=payload.get("analyst_name") or payload.get("full_name") or analyst_id,
                gsm=payload.get("gsm") or "",
                total_points=0,
            )
            db.add(profile)
        else:
            profile.full_name = payload.get("analyst_name") or payload.get("full_name") or profile.full_name
            profile.gsm = payload.get("gsm") or profile.gsm
        profile.total_points += delta
        profile.updated_at = utcnow()
        db.add(PointLedger(event_id=event_id, analyst_id=analyst_id, delta=delta, reason=reason))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            return False
    return True


def consume_forever(stop: Event) -> None:
    import pika

    amqp_url = os.getenv("AMQP_URL", "amqp://fraudcell:fraudcell@rabbitmq:5672/%2F")
    exchange = os.getenv("RABBITMQ_EXCHANGE", "fraudcell.events.v1")
    queue = os.getenv("RABBITMQ_QUEUE", "gamification.transaction.blocked")

    while not stop.is_set():
        connection = None
        try:
            connection = pika.BlockingConnection(pika.URLParameters(amqp_url))
            channel = connection.channel()
            channel.exchange_declare(exchange=exchange, exchange_type="topic", durable=True)
            channel.queue_declare(queue=queue, durable=True)
            channel.queue_bind(exchange=exchange, queue=queue, routing_key="transaction.blocked")
            channel.basic_qos(prefetch_count=1)

            def handle(ch, method, _properties, body):
                try:
                    process_decision_event(json.loads(body))
                    ch.basic_ack(method.delivery_tag)
                except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                    log.exception("Discarding invalid transaction.blocked event")
                    ch.basic_nack(method.delivery_tag, requeue=False)
                except Exception:
                    log.exception("Could not process transaction.blocked event")
                    ch.basic_nack(method.delivery_tag, requeue=True)

            channel.basic_consume(queue=queue, on_message_callback=handle)
            log.info("Listening for transaction.blocked events")
            while not stop.is_set() and connection.is_open:
                connection.process_data_events(time_limit=1)
        except Exception as exc:
            log.warning("RabbitMQ unavailable, retrying in 5 seconds: %s", exc)
        finally:
            if connection and connection.is_open:
                connection.close()
        stop.wait(5)
