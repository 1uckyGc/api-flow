from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings

# pool_size + max_overflow 共支撑 50 个 threads pool worker 的并发 DB 访问。
# pool_pre_ping=True 在借出连接前 ping 一下，避免长连接因 PG 服务端 idle timeout 失效。
# pool_recycle=300 主动 5 分钟回收，比 PG 默认 idle_in_transaction_session_timeout 短。
engine = create_engine(
    settings.DATABASE_URL,
    pool_size=30,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=300,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
