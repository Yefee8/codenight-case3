import unittest

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database import Base
from models import AnalystProfile, PointLedger
from rabbitmq import process_decision_event


class DecisionEventTest(unittest.TestCase):
    def test_points_and_duplicate_event(self):
        engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(engine)
        sessions = sessionmaker(bind=engine, expire_on_commit=False)
        event = {
            "event_id": "event-1",
            "payload": {
                "analyst_id": "analyst-1",
                "analyst_name": "Ada Analist",
                "sla_breached": True,
            },
        }

        self.assertTrue(process_decision_event(event, sessions))
        self.assertFalse(process_decision_event(event, sessions))
        with sessions() as db:
            self.assertEqual(db.get(AnalystProfile, "analyst-1").total_points, 5)
            self.assertEqual(db.scalar(select(func.count()).select_from(PointLedger)), 1)


if __name__ == "__main__":
    unittest.main()
