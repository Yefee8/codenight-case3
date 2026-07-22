from __future__ import annotations

import hashlib
import json
import platform
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.frozen import FrozenEstimator
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from app.data_generator import FRAUD_LABELS, LABELS, SEED

CATEGORICAL_FEATURES = ["city", "region", "country_code", "transaction_type"]
NUMERIC_FEATURES = [
    "amount",
    "hour",
    "new_device",
    "new_recipient",
    "frequency_1h",
    "frequency_24h",
    "deviation_score",
]
FEATURES = CATEGORICAL_FEATURES + NUMERIC_FEATURES
FEATURE_SCHEMA_VERSION = "fraudcell-features-v1"
RUNTIME_PACKAGES = ("numpy", "pandas", "scikit-learn", "joblib")
METRIC_GATES = {
    "risk_roc_auc": 0.90,
    "risk_recall": 0.85,
    "risk_pr_auc": 0.80,
    "risk_brier": 0.15,
    "type_macro_f1": 0.80,
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def dependency_versions() -> dict[str, str]:
    return {
        "python": platform.python_version(),
        **{package: version(package) for package in RUNTIME_PACKAGES},
    }


def model_code_sha256() -> str:
    digest = hashlib.sha256()
    app_dir = Path(__file__).resolve().parent
    for name in ("data_generator.py", "model.py", "training.py"):
        path = app_dir / name
        digest.update(name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def train_and_package(
    dataset_path: Path,
    artifact_path: Path,
    manifest_path: Path,
    seed: int = SEED,
    enforce_gates: bool = True,
) -> dict[str, Any]:
    frame = pd.read_csv(dataset_path)
    _validate_dataset(frame)
    train = frame[frame["split"] == "train"]
    validation = frame[frame["split"] == "validation"]
    holdout = frame[frame["split"] == "holdout"]
    if min(len(train), len(validation), len(holdout)) == 0:
        raise ValueError("train, validation and holdout splits must be non-empty")

    risk_base = Pipeline(
        [
            ("features", _preprocessor()),
            (
                "classifier",
                RandomForestClassifier(
                    n_estimators=180,
                    max_depth=14,
                    min_samples_leaf=3,
                    class_weight="balanced_subsample",
                    random_state=seed,
                    n_jobs=1,
                ),
            ),
        ]
    )
    risk_base.fit(train[FEATURES], train["is_fraud"])
    risk_model = CalibratedClassifierCV(FrozenEstimator(risk_base), method="sigmoid")
    risk_model.fit(validation[FEATURES], validation["is_fraud"])

    type_train = pd.concat([train, validation], ignore_index=True)
    type_model = Pipeline(
        [
            ("features", _preprocessor()),
            (
                "classifier",
                RandomForestClassifier(
                    n_estimators=220,
                    max_depth=16,
                    min_samples_leaf=2,
                    class_weight="balanced_subsample",
                    random_state=seed,
                    n_jobs=1,
                ),
            ),
        ]
    )
    type_model.fit(type_train[FEATURES], type_train["label"])

    metrics = evaluate(risk_model, type_model, holdout)
    if enforce_gates:
        _enforce_metric_gates(metrics)
    dataset_hash = sha256_file(dataset_path)
    dependencies = dependency_versions()
    code_hash = model_code_sha256()
    signature = hashlib.sha256(
        json.dumps(
            {
                "dataset_sha256": dataset_hash,
                "training_seed": seed,
                "feature_schema_version": FEATURE_SCHEMA_VERSION,
                "model_code_sha256": code_hash,
                "dependencies": dependencies,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    model_version = f"fraudcell-rf-{signature[:16]}"
    artifact = {
        "risk_model": risk_model,
        "type_model": type_model,
        "features": FEATURES,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "model_version": model_version,
        "seed": seed,
    }
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, artifact_path, compress=3)
    artifact_hash = sha256_file(artifact_path)
    manifest = {
        "model_version": model_version,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "artifact_sha256": artifact_hash,
        "dataset_sha256": dataset_hash,
        "training_signature": signature,
        "model_code_sha256": code_hash,
        "training_seed": seed,
        "trained_at": datetime.now(UTC).isoformat(),
        "rows": len(frame),
        "split_counts": {
            str(key): int(value) for key, value in frame["split"].value_counts().items()
        },
        "label_counts": {
            str(key): int(value) for key, value in frame["label"].value_counts().items()
        },
        "features": FEATURES,
        "metrics": metrics,
        "dependencies": dependencies,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n", "utf-8"
    )
    return manifest


def evaluate(risk_model: Any, type_model: Any, holdout: pd.DataFrame) -> dict[str, Any]:
    risk_probability = risk_model.predict_proba(holdout[FEATURES])[:, 1]
    risk_prediction = (risk_probability >= 0.40).astype(int)
    type_prediction = type_model.predict(holdout[FEATURES])
    per_type_recall = recall_score(
        holdout["label"], type_prediction, labels=list(FRAUD_LABELS), average=None, zero_division=0
    )
    per_type_precision = precision_score(
        holdout["label"], type_prediction, labels=list(FRAUD_LABELS), average=None, zero_division=0
    )
    return {
        "risk_roc_auc": float(roc_auc_score(holdout["is_fraud"], risk_probability)),
        "risk_recall": float(recall_score(holdout["is_fraud"], risk_prediction)),
        "risk_pr_auc": float(average_precision_score(holdout["is_fraud"], risk_probability)),
        "risk_brier": float(brier_score_loss(holdout["is_fraud"], risk_probability)),
        "type_macro_f1": float(
            f1_score(holdout["label"], type_prediction, labels=list(LABELS), average="macro")
        ),
        "category_recall": dict(zip(FRAUD_LABELS, map(float, per_type_recall), strict=True)),
        "category_precision": dict(zip(FRAUD_LABELS, map(float, per_type_precision), strict=True)),
        "holdout_count": len(holdout),
    }


def _preprocessor() -> ColumnTransformer:
    return ColumnTransformer(
        [
            (
                "categorical",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                CATEGORICAL_FEATURES,
            ),
            ("numeric", StandardScaler(), NUMERIC_FEATURES),
        ],
        verbose_feature_names_out=False,
    )


def _validate_dataset(frame: pd.DataFrame) -> None:
    required = set(FEATURES) | {"customer_id", "label", "is_fraud", "split", "scenario_tr"}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"dataset columns missing: {sorted(missing)}")
    if len(frame) < 10_000:
        raise ValueError("dataset must contain at least 10,000 rows")
    if set(frame["label"].unique()) != set(LABELS):
        raise ValueError("dataset must contain exactly the five canonical labels")
    if frame.groupby("customer_id")["split"].nunique().max() != 1:
        raise ValueError("customer leakage across splits")
    for fraud_type in FRAUD_LABELS:
        if int((frame["label"] == fraud_type).sum()) < 250:
            raise ValueError(f"not enough examples for {fraud_type}")


def _enforce_metric_gates(metrics: dict[str, Any]) -> None:
    failures = [
        name
        for name, threshold in METRIC_GATES.items()
        if (metrics[name] > threshold if name == "risk_brier" else metrics[name] < threshold)
    ]
    failures.extend(
        f"category_recall.{name}"
        for name, value in metrics["category_recall"].items()
        if value < 0.70
    )
    if failures:
        raise ValueError("model metric gates failed: " + ", ".join(failures))
