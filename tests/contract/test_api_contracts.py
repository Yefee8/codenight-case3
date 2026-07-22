from __future__ import annotations

import json
from pathlib import Path

import jsonschema


ROOT = Path(__file__).resolve().parents[2]


def test_success_and_error_envelopes_obey_canonical_schema() -> None:
    schema = json.loads(
        (ROOT / "contracts" / "common" / "api-envelope.schema.json").read_text(encoding="utf-8")
    )
    validator = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())

    validator.validate(
        {
            "success": True,
            "data": {"id": "safe"},
            "error": None,
            "request_id": "019b2c83-8c3b-7136-94d8-36e182393cc8",
        }
    )
    validator.validate(
        {
            "success": False,
            "data": None,
            "error": {"code": "FORBIDDEN", "message": "Bu işlem için yetkiniz yok."},
            "request_id": "019b2c83-8c3b-7136-94d8-36e182393cc8",
        }
    )


def test_error_envelope_cannot_carry_success_data() -> None:
    schema = json.loads(
        (ROOT / "contracts" / "common" / "api-envelope.schema.json").read_text(encoding="utf-8")
    )
    invalid = {
        "success": False,
        "data": {"leaked": "record"},
        "error": {"code": "FORBIDDEN", "message": "forbidden"},
        "request_id": "019b2c83-8c3b-7136-94d8-36e182393cc8",
    }

    assert list(jsonschema.Draft202012Validator(schema).iter_errors(invalid))

