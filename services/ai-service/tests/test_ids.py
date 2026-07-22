from app.ids import uuid7


def test_uuid7_has_rfc_version_variant_and_is_time_ordered() -> None:
    first = uuid7()
    second = uuid7()

    assert first.version == 7
    assert first.variant == "specified in RFC 4122"
    assert (first.int >> 80) <= (second.int >> 80)
