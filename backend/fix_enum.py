import asyncio
from sqlalchemy import text
from app.database import engine

def main():
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
