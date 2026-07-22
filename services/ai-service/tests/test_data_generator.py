from pathlib import Path

from app.data_generator import FRAUD_LABELS, generate_dataset
from app.training import sha256_file


def test_generator_is_deterministic_balanced_and_customer_isolated(tmp_path: Path) -> None:
    first = tmp_path / "first.csv"
    second = tmp_path / "second.csv"

    frame = generate_dataset(first, rows=10_000, seed=2026)
    generate_dataset(second, rows=10_000, seed=2026)

    assert sha256_file(first) == sha256_file(second)
    assert len(frame) == 10_000
    assert 0.84 <= (frame["label"] == "TEMIZ").mean() <= 0.86
    assert all((frame["label"] == label).sum() >= 250 for label in FRAUD_LABELS)
    assert frame.groupby("customer_id")["split"].nunique().max() == 1
    shares = frame["split"].value_counts(normalize=True)
    assert 0.65 <= shares["train"] <= 0.75
    assert 0.10 <= shares["validation"] <= 0.20
    assert 0.10 <= shares["holdout"] <= 0.20
    assert frame["scenario_tr"].str.len().min() > 10
    assert frame["region"].nunique() == 7


def test_generator_rejects_too_few_rows(tmp_path: Path) -> None:
    try:
        generate_dataset(tmp_path / "small.csv", rows=9_999)
    except ValueError as error:
        assert "10,000" in str(error)
    else:
        raise AssertionError("small dataset was accepted")
