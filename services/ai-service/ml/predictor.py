from pathlib import Path
from typing import Any

from ml.features import FEATURE_COLUMNS, FRAUD_LABELS, MODEL_VERSION, features_from_request, matrix, reason_codes

ARTIFACT_PATH = Path(__file__).with_name("fraud_model.joblib")


def load_model(path: Path = ARTIFACT_PATH) -> dict[str, Any] | None:
    try:
        import joblib

        artifact = joblib.load(path)
        if not artifact.get("pipeline") or not artifact.get("labels"):
            return None
        return artifact
    except Exception:
        return None


def predict(artifact: dict[str, Any], request: Any) -> dict[str, Any]:
    features = features_from_request(request)
    pipeline = artifact["pipeline"]
    classes = list(pipeline.classes_)
    probabilities = pipeline.predict_proba(matrix([features]))[0]
    probability_by_class = dict(zip(classes, probabilities, strict=True))
    risk_score = round(max(0.0, min(1.0, 1.0 - float(probability_by_class.get("TEMIZ", 0.0)))), 4)
    if risk_score < 0.40:
        fraud_type = "TEMIZ"
    else:
        fraud_type = max(FRAUD_LABELS, key=lambda label: probability_by_class.get(label, 0.0))
    return {
        "risk_score": risk_score,
        "fraud_type": fraud_type,
        "reason": reason_codes(features),
        "prediction_engine": "ML_MODEL",
        "model_version": artifact.get("model_version", MODEL_VERSION),
        "feature_columns": artifact.get("feature_columns", FEATURE_COLUMNS),
    }
