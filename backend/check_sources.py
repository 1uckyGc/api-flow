from app.database import SessionLocal
from app.models.task import TaskGroup, TaskType
from app.models.user import User
from app.models.settings import SystemSettings
import json

def check_sources():
    db = SessionLocal()
    try:
        groups = db.query(TaskGroup).all()
        print(f"Total task groups: {len(groups)}")
        for g in groups:
            print(f"ID: {g.id[:8]} | Title: {g.title[:20]} | Type: {g.task_type} | Source: {g.source} | Parent: {g.fission_parent_id[:8] if g.fission_parent_id else 'None'}")
    finally:
        db.close()

if __name__ == "__main__":
    check_sources()
