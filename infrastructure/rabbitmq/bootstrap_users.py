from __future__ import annotations

import base64
import json
import os
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


BASE_URL = os.getenv("RABBITMQ_MANAGEMENT_URL", "http://rabbitmq:15672/api")
BOOTSTRAP_USER = os.environ["RABBITMQ_BOOTSTRAP_USER"]
BOOTSTRAP_PASSWORD = os.environ["RABBITMQ_BOOTSTRAP_PASSWORD"]
OPERATOR_USER = os.environ["RABBITMQ_OPERATOR_USER"]
OPERATOR_PASSWORD = os.environ["RABBITMQ_OPERATOR_PASSWORD"]
DEFINITIONS_PATH = Path(os.getenv("RABBITMQ_DEFINITIONS_PATH", "/opt/fraudcell/definitions.json"))
BOOTSTRAP_AUTHORIZATION = "Basic " + base64.b64encode(
    f"{BOOTSTRAP_USER}:{BOOTSTRAP_PASSWORD}".encode()
).decode()
AUTHORIZATION = BOOTSTRAP_AUTHORIZATION
OPERATOR_AUTHORIZATION = "Basic " + base64.b64encode(
    f"{OPERATOR_USER}:{OPERATOR_PASSWORD}".encode()
).decode()

SERVICES = {
    "identity": {
        "username": os.environ["IDENTITY_RABBITMQ_USER"],
        "password": os.environ["IDENTITY_RABBITMQ_PASSWORD"],
        "events": r"^(staff\.(created|profile-updated|status-changed)|role\.changed|sessions\.revoked|audit\.record-requested)$",
    },
    "transaction": {
        "username": os.environ["TRANSACTION_RABBITMQ_USER"],
        "password": os.environ["TRANSACTION_RABBITMQ_PASSWORD"],
        "events": r"^(transaction\.(created|risk-assessed|analysis-unavailable)|case\.(created|assigned|status-changed|customer-verification-requested|customer-verification-responded|fraud-type-overridden|risk-level-overridden|decision-recorded|sla-breached|closed|feedback-submitted|ground-truth-set)|audit\.record-requested)$",
    },
    "ai": {
        "username": os.environ["AI_RABBITMQ_USER"],
        "password": os.environ["AI_RABBITMQ_PASSWORD"],
        "events": r"^(ai\.(prediction-created|classification-evaluated|model-activated|assignment-recommended)|audit\.record-requested)$",
    },
    "gamification": {
        "username": os.environ["GAMIFICATION_RABBITMQ_USER"],
        "password": os.environ["GAMIFICATION_RABBITMQ_PASSWORD"],
        "events": r"^(points\.changed|badge\.earned|level\.changed|audit\.record-requested)$",
    },
    "gateway": {
        "username": os.environ["GATEWAY_RABBITMQ_USER"],
        "password": os.environ["GATEWAY_RABBITMQ_PASSWORD"],
        "events": r"^$",
        "read_events": r"^(sessions\.revoked|role\.changed)$",
    },
}


class RabbitApiError(RuntimeError):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code


def request(method: str, path: str, payload: dict[str, Any] | None = None) -> None:
    body = None if payload is None else json.dumps(payload).encode()
    req = Request(
        f"{BASE_URL}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": AUTHORIZATION,
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(req, timeout=5) as response:
            if response.status >= 300:
                raise RuntimeError(f"RabbitMQ API returned HTTP {response.status} for {method} {path}")
    except HTTPError as error:
        detail = error.read().decode(errors="replace")[:500]
        raise RabbitApiError(
            error.code,
            f"RabbitMQ API returned HTTP {error.code} for {method} {path}: {detail}"
        ) from error


def wait_until_ready() -> None:
    global AUTHORIZATION
    for _ in range(60):
        for candidate in (BOOTSTRAP_AUTHORIZATION, OPERATOR_AUTHORIZATION):
            AUTHORIZATION = candidate
            try:
                request("GET", "/overview")
                return
            except (RabbitApiError, HTTPError, URLError, TimeoutError):
                continue
        time.sleep(2)
    raise TimeoutError("RabbitMQ management API did not become ready")


def configure_topology() -> None:
    topology = json.loads(DEFINITIONS_PATH.read_text(encoding="utf-8"))
    request("POST", "/definitions", topology)


def configure_service(service: str, config: dict[str, str]) -> None:
    username = config["username"]
    encoded_user = quote(username, safe="")
    vhost = "%2F"
    resource_write = (
        rf"^fraudcell\.{service}\.(retry|dlx)\.v1$"
        if service == "gateway"
        else rf"^(fraudcell\.events\.v1|fraudcell\.{service}\.(retry|dlx)\.v1)$"
    )
    request(
        "PUT",
        f"/users/{encoded_user}",
        {"password": config["password"], "tags": ""},
    )
    request(
        "PUT",
        f"/permissions/{vhost}/{encoded_user}",
        {
            "configure": "^$",
            "write": resource_write,
            "read": rf"^fraudcell\.{service}\.(events|retry\..*|dlq)\.v1$",
        },
    )
    request(
        "PUT",
        f"/topic-permissions/{vhost}/{encoded_user}",
        {
            "exchange": "fraudcell.events.v1",
            "write": config["events"],
            "read": config.get("read_events", ".*"),
            "configure": "^$",
        },
    )
    request("PUT", f"/user-limits/{encoded_user}/max-connections", {"value": 10})
    request("PUT", f"/user-limits/{encoded_user}/max-channels", {"value": 100})


def configure_operator() -> None:
    encoded_user = quote(OPERATOR_USER, safe="")
    request(
        "PUT",
        f"/users/{encoded_user}",
        {"password": OPERATOR_PASSWORD, "tags": "administrator"},
    )
    request(
        "PUT",
        f"/permissions/%2F/{encoded_user}",
        {"configure": ".*", "write": ".*", "read": ".*"},
    )


def validate_distinct_users() -> None:
    usernames = [BOOTSTRAP_USER, OPERATOR_USER, *(value["username"] for value in SERVICES.values())]
    if len(usernames) != len(set(usernames)):
        raise ValueError("RabbitMQ bootstrap, operator and service users must be distinct")


if __name__ == "__main__":
    validate_distinct_users()
    wait_until_ready()
    configure_topology()
    for service_name, service_config in SERVICES.items():
        configure_service(service_name, service_config)
    configure_operator()
    try:
        request("DELETE", f"/users/{quote(BOOTSTRAP_USER, safe='')}")
    except (RabbitApiError, HTTPError) as error:
        if error.code != 404:
            raise
    print("RabbitMQ least-privilege users are configured")
