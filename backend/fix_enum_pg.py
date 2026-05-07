import asyncio
from sqlalchemy import create_engine, text

def main():
    pg_uri = "postgresql://followmeeeaigc:followmeeeaigc_pass@localhost/followmeeeaigc_db"
    engine = create_engine(pg_uri)
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TYPE groupstatus ADD VALUE 'NEEDS_REVIEW'"))
            print("Added NEEDS_REVIEW")
        except Exception as e:
            print("NEEDS_REVIEW error:", e)
            
        try:
            conn.execute(text("ALTER TYPE groupstatus ADD VALUE 'needs_review'"))
            print("Added needs_review")
        except Exception as e:
            print("needs_review error:", e)
        conn.commit()

if __name__ == "__main__":
    main()
