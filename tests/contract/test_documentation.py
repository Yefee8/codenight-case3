from __future__ import annotations

import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
IGNORED_PARTS = {".git", "node_modules", "target", "dist", "coverage"}


def is_ignored(path: Path) -> bool:
    return any(part in IGNORED_PARTS or part.startswith(".venv") for part in path.parts)

def markdown_documents():
    return (
        document
        for document in ROOT.rglob("*.md")
        if not is_ignored(document)
    )


REQUIRED = (
    "README.md",
    "EVENTS.md",
    "FRAUDCELL_PLAN.md",
    "docs/architecture/system.md",
    "docs/architecture/database-eer.md",
    "docs/security/rls.md",
    "docs/security/threat-model.md",
    "docs/infrastructure/docker.md",
    "docs/infrastructure/database.md",
    "docs/infrastructure/redis.md",
    "docs/infrastructure/rabbitmq.md",
    "docs/ai/approach.md",
    "docs/testing/strategy.md",
    "docs/demo/live-demo.md",
    "lecture-notes/README.md",
    "extra-controls/README.md",
    "edge-cases/README.md",
    "ai-memory/README.md",
    "ai-memory/project-status.md",
    "ai-memory/requirements-traceability.md",
    "ai-memory/current-handoff.md",
    "ai-memory/bonus-status.md",
    "ai-memory/known-risks.md",
)


@pytest.mark.parametrize("relative", REQUIRED)
def test_required_document_exists_and_is_utf8(relative: str) -> None:
    path = ROOT / relative

    assert path.is_file(), relative
    text = path.read_text(encoding="utf-8", errors="strict")
    assert text.startswith("# ")
    assert len(text) > 100


def test_local_markdown_links_resolve() -> None:
    errors: list[str] = []
    pattern = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
    for document in markdown_documents():
        for target in pattern.findall(document.read_text(encoding="utf-8")):
            target = target.split("#", 1)[0].strip()
            if not target or target.startswith(("http://", "https://", "mailto:")):
                continue
            resolved = (document.parent / target).resolve()
            if not resolved.exists():
                errors.append(f"{document.relative_to(ROOT)} -> {target}")

    assert not errors, "Broken local links:\n" + "\n".join(errors)


def test_mermaid_and_code_fences_are_balanced() -> None:
    errors: list[str] = []
    for document in markdown_documents():
        text = document.read_text(encoding="utf-8")
        if text.count("```") % 2:
            errors.append(str(document.relative_to(ROOT)))

    assert not errors, "Unbalanced fences: " + ", ".join(errors)


def test_rls_and_release_controls_are_explicit() -> None:
    rls = (ROOT / "extra-controls" / "rls-and-data.md").read_text(encoding="utf-8")
    release = (ROOT / "extra-controls" / "release.md").read_text(encoding="utf-8")

    for number in range(1, 17):
        assert f"CTRL-RLS-{number:03d}" in rls
    for number in range(1, 16):
        assert f"CTRL-REL-{number:03d}" in release


def test_traceability_covers_every_scored_area_and_bonus() -> None:
    traceability = (ROOT / "ai-memory" / "requirements-traceability.md").read_text(
        encoding="utf-8"
    )

    for prefix in ("REQ-ARCH", "REQ-ID", "REQ-TX", "REQ-AI", "REQ-GAME", "REQ-DASH", "REQ-API", "REQ-EVT", "REQ-SEC"):
        assert prefix in traceability
    for bonus in ("BONUS-ML", "BONUS-MQ", "BONUS-CAT", "BONUS-SSE", "BONUS-CI"):
        assert bonus in traceability
