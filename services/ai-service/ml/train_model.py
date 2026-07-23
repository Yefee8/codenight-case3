import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import joblib
from features import CATEGORICAL_FEATURES, FEATURE_COLUMNS, LABELS, MODEL_VERSION, NUMERIC_FEATURES, features_from_request, matrix
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, precision_recall_fscore_support
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "data" / "fraud_transactions.csv"
ARTIFACT = ROOT / "ml" / "fraud_model.joblib"
METRICS = ROOT / "ml" / "training_metrics.json"


def load_dataset() -> tuple[list[list[object]], list[str], int]:
    with DATASET.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    features = [features_from_request(row) for row in rows]
    labels = [row["label"] for row in rows]
    return matrix(features), labels, len(rows)


def build_pipeline() -> Pipeline:
    categorical = [FEATURE_COLUMNS.index(column) for column in CATEGORICAL_FEATURES]
    numeric = [FEATURE_COLUMNS.index(column) for column in NUMERIC_FEATURES]
    preprocess = ColumnTransformer(
        transformers=[
            ("categorical", OneHotEncoder(handle_unknown="ignore"), categorical),
            ("numeric", "passthrough", numeric),
        ]
    )
    return Pipeline(
        steps=[
            ("preprocess", preprocess),
            ("model", RandomForestClassifier(n_estimators=240, class_weight="balanced", random_state=42, min_samples_leaf=2)),
        ]
    )


def main() -> None:
    x, y, rows = load_dataset()
    x_train, x_test, y_train, y_test = train_test_split(x, y, test_size=0.20, stratify=y, random_state=42)
    pipeline = build_pipeline()
    pipeline.fit(x_train, y_train)
    predicted = pipeline.predict(x_test)
    precision, recall, f1, _ = precision_recall_fscore_support(y_test, predicted, average="macro", zero_division=0)
    metrics = {
        "model_version": MODEL_VERSION,
        "dataset_rows": rows,
        "train_rows": len(x_train),
        "test_rows": len(x_test),
        "accuracy": round(float(accuracy_score(y_test, predicted)), 6),
        "macro_precision": round(float(precision), 6),
        "macro_recall": round(float(recall), 6),
        "macro_f1": round(float(f1), 6),
        "labels": LABELS,
        "confusion_matrix": confusion_matrix(y_test, predicted, labels=LABELS).tolist(),
        "classification_report": classification_report(y_test, predicted, labels=LABELS, zero_division=0),
    }
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "pipeline": pipeline,
            "labels": LABELS,
            "feature_columns": FEATURE_COLUMNS,
            "model_version": MODEL_VERSION,
            "metrics": metrics,
        },
        ARTIFACT,
    )
    METRICS.write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in metrics.items() if key != "classification_report"}, ensure_ascii=False, indent=2))
    print(metrics["classification_report"])
    print(f"saved model artifact: {ARTIFACT}")


if __name__ == "__main__":
    main()
