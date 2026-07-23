import unittest

from main import ScoreRequest, decision_for, score_transaction


class ScoringTest(unittest.TestCase):
    def test_thresholds_and_rules(self):
        self.assertEqual([decision_for(x) for x in (0.3999, 0.40, 0.90, 0.9001)], ["ONAY", "INCELEME", "INCELEME", "BLOK"])

        low = score_transaction(ScoreRequest(amount=100, type="FATURA", location="Ankara, TR"))
        critical = score_transaction(ScoreRequest(amount=150_000, type="TRANSFER", location="Amsterdam, NL"))
        self.assertEqual(low[:2], (0.05, "TEMIZ"))
        self.assertEqual((critical[0], decision_for(critical[0]), critical[1]), (0.95, "BLOK", "PARA_AKLAMA"))


if __name__ == "__main__":
    unittest.main()
