import json
import logging
import os

log = logging.getLogger(__name__)
AMQP_URL = os.getenv("AMQP_URL", "amqp://fraudcell:fraudcell@rabbitmq:5672/")
EXCHANGE = "fraudcell.events.v1"


def publish_decision(event: dict) -> bool:
    """Best effort: the decision is durable even while RabbitMQ is unavailable."""
    import pika

    connection = None
    try:
        parameters = pika.URLParameters(AMQP_URL)
        parameters.connection_attempts = 1
        parameters.socket_timeout = 1
        parameters.blocked_connection_timeout = 1
        connection = pika.BlockingConnection(parameters)
        channel = connection.channel()
        channel.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
        channel.basic_publish(
            exchange=EXCHANGE,
            routing_key=event.get("event_type", "transaction.decided"),
            body=json.dumps(event).encode(),
            properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
        )
        return True
    except (pika.exceptions.AMQPError, OSError) as exc:
        log.warning("RabbitMQ publish skipped: %s", exc)
        return False
    finally:
        if connection and connection.is_open:
            connection.close()
