from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SERVICES = ("identity", "transaction", "ai", "gamification", "gateway")
RETRY_STAGES = (("5s", 5_000), ("30s", 30_000), ("2m", 120_000), ("10m", 600_000), ("30m", 1_800_000))


def gateway_queues() -> list[dict]:
    queues = [
        {
            "name": "fraudcell.gateway.events.v1",
            "vhost": "/",
            "durable": True,
            "auto_delete": False,
            "arguments": {
                "x-queue-type": "quorum",
                "x-dead-letter-exchange": "fraudcell.gateway.dlx.v1",
                "x-dead-letter-routing-key": "gateway",
            },
        }
    ]
    for stage, ttl in RETRY_STAGES:
        queues.append(
            {
                "name": f"fraudcell.gateway.retry.{stage}.v1",
                "vhost": "/",
                "durable": True,
                "auto_delete": False,
                "arguments": {
                    "x-queue-type": "quorum",
                    "x-message-ttl": ttl,
                    "x-dead-letter-exchange": "fraudcell.gateway.retry.v1",
                    "x-dead-letter-routing-key": "gateway.ready",
                },
            }
        )
    queues.append(
        {
            "name": "fraudcell.gateway.dlq.v1",
            "vhost": "/",
            "durable": True,
            "auto_delete": False,
            "arguments": {"x-queue-type": "quorum"},
        }
    )
    return queues


def gateway_bindings() -> list[dict]:
    bindings = [
        {
            "source": "fraudcell.events.v1",
            "vhost": "/",
            "destination": "fraudcell.gateway.events.v1",
            "destination_type": "queue",
            "routing_key": event,
            "arguments": {},
        }
        for event in ("sessions.revoked", "role.changed")
    ]
    bindings.extend(
        [
            {
                "source": "fraudcell.gateway.retry.v1",
                "vhost": "/",
                "destination": "fraudcell.gateway.events.v1",
                "destination_type": "queue",
                "routing_key": "gateway.ready",
                "arguments": {},
            },
            {
                "source": "fraudcell.gateway.dlx.v1",
                "vhost": "/",
                "destination": "fraudcell.gateway.dlq.v1",
                "destination_type": "queue",
                "routing_key": "gateway",
                "arguments": {},
            },
        ]
    )
    bindings.extend(
        {
            "source": "fraudcell.gateway.retry.v1",
            "vhost": "/",
            "destination": f"fraudcell.gateway.retry.{stage}.v1",
            "destination_type": "queue",
            "routing_key": f"gateway.{stage}",
            "arguments": {},
        }
        for stage, _ in RETRY_STAGES
    )
    return bindings


def build() -> dict:
    topology = json.loads((ROOT / "definitions.json").read_text(encoding="utf-8"))
    topology["exchanges"] = [
        exchange
        for exchange in topology["exchanges"]
        if exchange["name"] == "fraudcell.events.v1"
    ]
    for service in SERVICES:
        for purpose in ("retry", "dlx"):
            topology["exchanges"].append(
                {
                    "name": f"fraudcell.{service}.{purpose}.v1",
                    "vhost": "/",
                    "type": "direct",
                    "durable": True,
                    "auto_delete": False,
                    "internal": False,
                    "arguments": {},
                }
            )

    for queue in topology["queues"]:
        service = next(service for service in SERVICES if f".{service}." in queue["name"])
        arguments = queue["arguments"]
        if arguments.get("x-dead-letter-exchange") == "fraudcell.dlx.v1":
            arguments["x-dead-letter-exchange"] = f"fraudcell.{service}.dlx.v1"
        if arguments.get("x-dead-letter-exchange") == "fraudcell.retry.v1":
            arguments["x-dead-letter-exchange"] = f"fraudcell.{service}.retry.v1"

    for binding in topology["bindings"]:
        if binding["source"] not in {"fraudcell.retry.v1", "fraudcell.dlx.v1"}:
            continue
        service = next(
            service for service in SERVICES if f".{service}." in binding["destination"]
        )
        purpose = "retry" if binding["source"] == "fraudcell.retry.v1" else "dlx"
        binding["source"] = f"fraudcell.{service}.{purpose}.v1"

    topology["queues"].extend(gateway_queues())
    topology["bindings"].extend(gateway_bindings())

    return topology


if __name__ == "__main__":
    output = ROOT / "definitions-hardened.json"
    output.write_text(
        json.dumps(build(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
