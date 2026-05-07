import os
import json
from sqlalchemy import create_engine, text

# Database connection settings
DATABASE_URL = "postgresql://followmeeeaigc:followmeeeaigc_pass@localhost:5433/followmeeeaigc_db"

def get_latest_director_scenes():
    try:
        engine = create_engine(DATABASE_URL)
        with engine.connect() as conn:
            query = text("SELECT config_json FROM task_groups WHERE source = 'DIRECTOR' ORDER BY created_at DESC LIMIT 1")
            result = conn.execute(query).fetchone()
            if result and result[0]:
                config = result[0]
                scenes = config.get("director_scenes")
                return scenes
            else:
                return "No group found or config_json is empty."
    except Exception as e:
        return f"Error: {e}"

if __name__ == "__main__":
    scenes = get_latest_director_scenes()
    print(json.dumps(scenes, indent=2, ensure_ascii=False))
