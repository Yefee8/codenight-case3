import json
from typing import Any


def sse_event(name: str, data: Any) -> str:
    payload = data.model_dump(mode="json") if hasattr(data, "model_dump") else data
    return f"event: {name}\ndata: {json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n\n"
