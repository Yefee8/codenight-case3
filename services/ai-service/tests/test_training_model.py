import json
from pathlib import Path

from app.data_generator import generate_dataset
from app.model import ModelBundle
from app.training import METRIC_GATES, train_and_package


def test_train_package_metric_gates_hash_and_unknown_category_inference(tmp_path: Path) -> None:
    dataset = tmp_path / "dataset.csv"
    artifact = tmp_path / "model.joblib"
    manifest_path = tmp_path / "manifest.json"
    generate_dataset(dataset, rows=10_000, seed=2026)

    manifest = train_and_package(dataset, artifact, manifest_path, seed=2026)

    assert manifest["metrics"]["risk_roc_auc"] >= METRIC_GATES["risk_roc_auc"]
    assert manifest["metrics"]["risk_recall"] >= METRIC_GATES["risk_recall"]
    assert manifest["metrics"]["risk_pr_auc"] >= METRIC_GATES["risk_pr_auc"]
    assert manifest["metrics"]["risk_brier"] <= METRIC_GATES["risk_brier"]
    assert manifest["metrics"]["type_macro_f1"] >= METRIC_GATES["type_macro_f1"]
    assert min(manifest["metrics"]["category_recall"].values()) >= 0.70

    bundle = ModelBundle(artifact, manifest_path)
    bundle.load()
    assert bundle.ready
    normal = bundle.predict(
        {
            "city": "BILINMEYEN_SEHIR",
            "region": "BILINMEYEN_BOLGE",
            "country_code": "TR",
            "transaction_type": "YENI_TIP",
            "amount": 200.0,
            "hour": 14,
            "new_device": False,
            "new_recipient": False,
            "frequency_1h": 0,
            "frequency_24h": 2,
            "deviation_score": 0.2,
        }
    )
    risky = bundle.predict(
        {
            "city": "BILINMEYEN_SEHIR",
            "region": "BILINMEYEN_BOLGE",
            "country_code": "US",
            "transaction_type": "TRANSFER",
            "amount": 220_000.0,
            "hour": 2,
            "new_device": True,
            "new_recipient": True,
            "frequency_1h": 15,
            "frequency_24h": 50,
            "deviation_score": 8.0,
        }
    )
    assert normal.risk_score != risky.risk_score
    assert risky.risk_score > normal.risk_score

    artifact.write_bytes(artifact.read_bytes() + b"tamper")
    tampered = ModelBundle(artifact, manifest_path)
    tampered.load()
    assert not tampered.ready
    assert "hash mismatch" in str(tampered.load_error)

    incompatible_manifest = json.loads(manifest_path.read_text("utf-8"))
    incompatible_manifest["dependencies"]["numpy"] = "0.0.0"
    manifest_path.write_text(json.dumps(incompatible_manifest), "utf-8")
    incompatible = ModelBundle(artifact, manifest_path)
    incompatible.load()
    assert not incompatible.ready
    assert "numpy" in str(incompatible.load_error)


def test_manifest_contains_reproducibility_evidence(tmp_path: Path) -> None:
    dataset = tmp_path / "dataset.csv"
    artifact = tmp_path / "model.joblib"
    manifest_path = tmp_path / "manifest.json"
    generate_dataset(dataset, rows=10_000, seed=2026)
    train_and_package(dataset, artifact, manifest_path, seed=2026)

    manifest = json.loads(manifest_path.read_text("utf-8"))
    assert manifest["training_seed"] == 2026
    assert len(manifest["dataset_sha256"]) == 64
    assert len(manifest["artifact_sha256"]) == 64
    assert len(manifest["training_signature"]) == 64
    assert len(manifest["model_code_sha256"]) == 64
    assert manifest["model_version"].endswith(manifest["training_signature"][:16])
    assert manifest["feature_schema_version"] == "fraudcell-features-v1"
    assert {"python", "numpy", "pandas", "scikit-learn", "joblib"} <= manifest[
        "dependencies"
    ].keys()
