import unittest

from main import ScoreRequest, decision_for, score_transaction
from ml.features import LABELS
from ml.predictor import load_model


class ScoringTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.artifact = load_model()

    def test_thresholds(self):
        self.assertEqual([decision_for(x) for x in (0.3999, 0.40, 0.90, 0.9001)], ["ONAY", "INCELEME", "INCELEME", "BLOK"])

    def test_model_artifact_loads(self):
        self.assertIsNotNone(self.artifact)
        self.assertEqual(self.artifact["model_version"], "fraudcell-rf-v1")

    def test_low_risk_transaction_stays_low(self):
        low = score_transaction(ScoreRequest(amount=100, type="FATURA", location="Ankara, TR"), self.artifact)
        self.assertLess(low.risk_score, 0.40)
        self.assertEqual(low.fraud_type, "TEMIZ")
        self.assertEqual(low.prediction_engine, "ML_MODEL")

    def test_risky_transaction_scores_higher_than_normal(self):
        low = score_transaction(ScoreRequest(amount=750, type="FATURA", location="Ankara, TR", device="Bilinen cihaz", hour=13), self.artifact)
        risky = score_transaction(
            ScoreRequest(
                amount=150_000,
                type="TRANSFER",
                location="Amsterdam, NL",
                device="Yeni cihaz",
                receiver="Global Trade",
                hour=2,
                is_new_device=True,
                is_new_recipient=True,
            ),
            self.artifact,
        )
        self.assertGreater(risky.risk_score, low.risk_score + 0.40)

    def test_model_output_contract(self):
        for item in (
            ScoreRequest(amount=400, type="FATURA", location="İstanbul, TR", device="Bilinen cihaz", hour=11),
            ScoreRequest(amount=22_000, type="ODEME", location="İzmir, TR", device="Yeni cihaz", hour=23, is_new_device=True),
            ScoreRequest(amount=180_000, type="TRANSFER", location="Berlin, DE", receiver="Kripto Exchange", hour=3, is_new_recipient=True),
        ):
            result = score_transaction(item, self.artifact)
            self.assertGreaterEqual(result.risk_score, 0.0)
            self.assertLessEqual(result.risk_score, 1.0)
            self.assertIn(result.fraud_type, LABELS)
            self.assertEqual(result.prediction_engine, "ML_MODEL")


if __name__ == "__main__":
    unittest.main()
