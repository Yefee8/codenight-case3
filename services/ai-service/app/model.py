from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from app.training import dependency_versions, model_code_sha256, sha256_file


@dataclass(frozen=True)
class Prediction:
    risk_score: float
    fraud_type: str


class ModelBundle:
    def __init__(self, artifact_path: Path, manifest_path: Path) -> None:
        self.artifact_path = artifact_path
        self.manifest_path = manifest_path
        self.artifact: dict[str, Any] | None = None
        self.manifest: dict[str, Any] | None = None
        self.load_error: str | None = "model has not been loaded"

    @property
    def ready(self) -> bool:
        return self.artifact is not None and self.manifest is not None and self.load_error is None

    def load(self) -> None:
        try:
            manifest = json.loads(self.manifest_path.read_text("utf-8"))
            self._verify_compatibility(manifest)
            actual_hash = sha256_file(self.artifact_path)
            if manifest["artifact_sha256"] != actual_hash:
                raise ValueError("model artifact hash mismatch")
            artifact = joblib.load(self.artifact_path)
            if artifact["model_version"] != manifest["model_version"]:
                raise ValueError("model version mismatch")
            if artifact["feature_schema_version"] != manifest["feature_schema_version"]:
                raise ValueError("feature schema mismatch")
            self.artifact = artifact
            self.manifest = manifest
            self.load_error = None
        except Exception as error:
            self.artifact = None
            self.manifest = None
            self.load_error = str(error)

    @staticmethod
    def _verify_compatibility(manifest: dict[str, Any]) -> None:
        expected = manifest["dependencies"]
        actual = dependency_versions()
        # The artifact contains sklearn estimators, not Python bytecode. Keep the
        # Python major version stable while pinning every serialization library
        # exactly; this lets the checked-in model trained on 3.11 load in the
        # Python 3.13 image without an unsafe in-container rewrite.
        expected_python = str(expected["python"]).split(".")[0]
        actual_python = actual["python"].split(".")[0]
        if expected_python != actual_python:
            raise ValueError("model Python runtime is incompatible")
        for package in ("numpy", "pandas", "scikit-learn", "joblib"):
            if expected.get(package) != actual[package]:
                raise ValueError(f"model dependency is incompatible: {package}")
        if manifest.get("model_code_sha256") != model_code_sha256():
            raise ValueError("model training/inference code is incompatible")

    def predict(self, features: dict[str, object]) -> Prediction:
        if not self.ready or self.artifact is None:
            raise RuntimeError("model is not ready")
        row = pd.DataFrame([{name: features[name] for name in self.artifact["features"]}])
        risk_model = self.artifact["risk_model"]
        type_model = self.artifact["type_model"]
        risk_score = float(risk_model.predict_proba(row)[0, 1])
        classes = list(type_model.classes_)
        probabilities = type_model.predict_proba(row)[0]
        fraud_probabilities = [
            (str(label), float(probability))
            for label, probability in zip(classes, probabilities, strict=True)
            if str(label) != "TEMIZ"
        ]
        fraud_type = (
            "TEMIZ" if risk_score < 0.40 else max(fraud_probabilities, key=lambda item: item[1])[0]
        )
        return Prediction(risk_score=min(max(risk_score, 0.0), 1.0), fraud_type=fraud_type)
