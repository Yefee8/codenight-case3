import secrets
import time
from uuid import UUID


def uuid7() -> UUID:
    """Create an RFC 9562 UUIDv7 using millisecond Unix time and CSPRNG bits."""
    unix_milliseconds = time.time_ns() // 1_000_000
    if unix_milliseconds >= 1 << 48:
        raise OverflowError("Unix timestamp does not fit UUIDv7")
    random_a = secrets.randbits(12)
    random_b = secrets.randbits(62)
    value = (unix_milliseconds << 80) | (0x7 << 76) | (random_a << 64) | (0b10 << 62) | random_b
    return UUID(int=value)
