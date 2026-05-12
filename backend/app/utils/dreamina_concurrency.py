"""Dreamina 全局并发协调器 —— Redis-based semaphore + 实查账户级 in-flight。

Dreamina 是 OAuth 单账户，账户级并发上限 Maestro VIP 实测 2；超出会返
`ret=1310 ExceedConcurrencyLimit`。本 helper 双重保险：
  1. Redis semaphore (`dreamina:slots`) — 跨 worker thread 协同，避免 race
  2. `dreamina list_task` 实查上游 querying 数 — 权威，应对历史遗留任务、worker
     重启 Redis 错位、上游账户的奇怪计数等

acquire 时 **两个都得通过**：Redis 计数 < max 且上游 querying < max。
list_task ~120ms 调用，cache 5s 复用避免每条 submit 都跑一次。

Redis keys:
- `dreamina:slots`   当前 in-flight 任务数（INCR/DECR；带 TTL 30min 防 leak）
- `dreamina:waiting` 等待中任务数（仅指标，不参与调度）
"""
import json
import subprocess
import time

import redis

from app.config import settings
from app.utils.logger import logger


# 配置（写死，必要时挪 .env）
DREAMINA_MAX_CONCURRENT = 1          # Dreamina 上游对单账户限 1 并发（实测）
                                     # 之前以为 2，但 multimodal2video 第二条仍撞 ret=1310；改 1 兜底
                                     # 如果后续证实 i2v 能 2、omniref 限 1，再拆 mode-specific 配额
SLOT_TTL_SEC = 1800                  # 30 min — 任务 crash 时 slot 自动失效，避免永久卡死
WAITING_TTL_SEC = 3600               # waiting 计数 1h 失效


_redis_client = None


def _get_redis() -> redis.Redis:
    """复用 Celery broker 同一个 Redis 实例，避免新连接池。"""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(
            settings.CELERY_BROKER_URL,
            decode_responses=True,
            socket_timeout=3.0,
            socket_connect_timeout=2.0,
        )
    return _redis_client


# Lua: 原子条件性 INCR（slot 数 < max 才递增）
_LUA_TRY_ACQUIRE = """
local cur = tonumber(redis.call('get', KEYS[1]) or '0')
local maxn = tonumber(ARGV[1])
if cur < maxn then
  redis.call('incr', KEYS[1])
  redis.call('expire', KEYS[1], ARGV[2])
  return 1
end
return 0
"""

# Lua: 原子 DECR 但不下溢
_LUA_RELEASE = """
local cur = tonumber(redis.call('get', KEYS[1]) or '0')
if cur > 0 then
  redis.call('decr', KEYS[1])
end
return 1
"""


_DREAMINA_BIN = "/root/.local/bin/dreamina"
_INFLIGHT_CACHE = {"ts": 0.0, "value": 0}
_INFLIGHT_CACHE_TTL = 5.0   # 秒


def count_account_inflight(use_cache: bool = True) -> int:
    """实查 dreamina 账户上 `querying` 状态的任务数（真实 in-flight）。
    带 5s 缓存避免每个 acquire 都跑一次 subprocess。失败返 0（fail-open）。
    """
    now = time.time()
    if use_cache and (now - _INFLIGHT_CACHE["ts"]) < _INFLIGHT_CACHE_TTL:
        return _INFLIGHT_CACHE["value"]
    try:
        # subprocess.run timeout 5s；list_task 实测 120ms 但留余地
        proc = subprocess.run(
            [_DREAMINA_BIN, "list_task"],
            capture_output=True, timeout=5.0, text=True,
        )
        if proc.returncode != 0:
            logger.warning(f"dreamina list_task rc={proc.returncode}: {proc.stderr[:200]}")
            return _INFLIGHT_CACHE["value"]  # 失败用旧缓存
        data = json.loads(proc.stdout)
        n = sum(1 for t in data if t.get("gen_status") == "querying")
        _INFLIGHT_CACHE["ts"] = now
        _INFLIGHT_CACHE["value"] = n
        return n
    except Exception as e:
        logger.warning(f"dreamina count_account_inflight err: {e}; fall back to cache")
        return _INFLIGHT_CACHE["value"]


def try_acquire_slot() -> bool:
    """非阻塞抢槽，返 True/False。
    只信 Redis Lua INCR if < max；不查 dreamina list_task（本地 SQLite cache 不实时同步上游，
    querying 状态严重 stale —— 任务 success 后本地仍显示 querying 直到 query_result 主动刷）。
    如果 Redis 跟上游脱节（worker 重启等），image2video 内部对 ExceedConcurrencyLimit
    自动 30s × 3 次重试做兜底。
    """
    try:
        r = _get_redis()
        got = r.eval(_LUA_TRY_ACQUIRE, 1, "dreamina:slots", DREAMINA_MAX_CONCURRENT, SLOT_TTL_SEC)
        return int(got) == 1
    except Exception as e:
        logger.warning(f"dreamina try_acquire_slot redis err: {e}; fail-open (允许提交)")
        return True   # Redis 挂了就 fail-open，dreamina 自己的 ExceedConcurrencyLimit 还能兜底


def release_slot() -> None:
    """释放一个槽（in-flight 数 -1）。"""
    try:
        r = _get_redis()
        r.eval(_LUA_RELEASE, 1, "dreamina:slots")
    except Exception as e:
        logger.warning(f"dreamina release_slot redis err: {e}")


def incr_waiting() -> None:
    try:
        r = _get_redis()
        r.incr("dreamina:waiting")
        r.expire("dreamina:waiting", WAITING_TTL_SEC)
    except Exception as e:
        logger.warning(f"dreamina incr_waiting redis err: {e}")


def decr_waiting() -> None:
    try:
        r = _get_redis()
        # 用 Lua 避免下溢
        r.eval(
            "local n = tonumber(redis.call('get', KEYS[1]) or '0'); if n > 0 then redis.call('decr', KEYS[1]) end; return 1",
            1,
            "dreamina:waiting",
        )
    except Exception as e:
        logger.warning(f"dreamina decr_waiting redis err: {e}")


def wait_for_slot(timeout_sec: int = 1800, poll: float = 3.0) -> bool:
    """阻塞抢槽，超时返 False。中间 poll 一次 try_acquire_slot。"""
    incr_waiting()
    try:
        deadline = time.time() + timeout_sec
        while time.time() < deadline:
            if try_acquire_slot():
                return True
            time.sleep(poll)
        return False
    finally:
        decr_waiting()


def count_db_inflight() -> int:
    """DB 实时数：Task.status=RUNNING + config_json.dreamina_sid 非空 + model 属 dreamina/seedance。
    这是**真实在 dreamina 上游 in-flight 的本系统任务数**，worker 重启不丢（DB 持久化）。
    """
    try:
        from app.database import SessionLocal
        from app.models.task import Task, TaskGroup, TaskStatus
        with SessionLocal() as db:
            rows = db.query(Task, TaskGroup).join(
                TaskGroup, Task.group_id == TaskGroup.id
            ).filter(Task.status == TaskStatus.RUNNING).all()
            n = 0
            for t, g in rows:
                cfg_t = t.config_json or {}
                cfg_g = g.config_json or {}
                if not cfg_t.get("dreamina_sid"):
                    continue
                m = cfg_t.get("model") or cfg_g.get("model") or ""
                if m.startswith("dreamina/seedance"):
                    n += 1
            return n
    except Exception as e:
        logger.warning(f"count_db_inflight err: {e}")
        return 0


def count_db_waiting() -> int:
    """DB 实时数：Task.status in (QUEUED, RUNNING) + 没 dreamina_sid（还没 submit）
    + 模型属 dreamina/seedance。这是抢槽等待中的任务数。
    """
    try:
        from app.database import SessionLocal
        from app.models.task import Task, TaskGroup, TaskStatus
        with SessionLocal() as db:
            rows = db.query(Task, TaskGroup).join(
                TaskGroup, Task.group_id == TaskGroup.id
            ).filter(Task.status.in_([TaskStatus.RUNNING, TaskStatus.QUEUED])).all()
            n = 0
            for t, g in rows:
                cfg_t = t.config_json or {}
                cfg_g = g.config_json or {}
                if cfg_t.get("dreamina_sid"):
                    continue  # 已 submit 不算 waiting
                m = cfg_t.get("model") or cfg_g.get("model") or ""
                if m.startswith("dreamina/seedance"):
                    n += 1
            return n
    except Exception as e:
        logger.warning(f"count_db_waiting err: {e}")
        return 0


def get_status() -> dict:
    """前端轮询端点用。
    返字段：
      max               —— Redis semaphore 上限
      in_flight         —— **DB 实时数**（RUNNING + 有 sid + dreamina/seedance），worker 重启不丢
      waiting           —— DB 中已提交但还没 submit 上游的（QUEUED 或 RUNNING 无 sid）
      account_querying  —— dreamina list_task 实查上游 querying 数（仅参考，本地缓存可能 stale）
      redis_slots       —— Redis semaphore 计数（仅 debug 用，不是权威）
      available         —— DB in-flight < max → true
    """
    try:
        r = _get_redis()
        redis_slots = int(r.get("dreamina:slots") or 0)
    except Exception as e:
        logger.warning(f"dreamina get_status redis err: {e}")
        redis_slots = None
    db_inflight = count_db_inflight()
    db_waiting = count_db_waiting()
    account_q = count_account_inflight(use_cache=True)
    return {
        "max": DREAMINA_MAX_CONCURRENT,
        "in_flight": db_inflight,        # 权威：DB 状态
        "waiting": db_waiting,
        "account_querying": account_q,    # 参考：dreamina list_task
        "redis_slots": redis_slots,       # debug：Redis semaphore
        "available": db_inflight < DREAMINA_MAX_CONCURRENT,
    }
