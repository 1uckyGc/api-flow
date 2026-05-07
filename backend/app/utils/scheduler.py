import asyncio
import random
import time
import redis.asyncio as redis
from app.config import settings
from app.utils.logger import logger

# 下面使用延迟初始化模式，防止 Event Loop 闭合问题 (常见于 Celery 多进程/多线程混合环境)
_redis_client = None
_redis_loop_id = None

async def get_redis_client():
    global _redis_client, _redis_loop_id
    try:
        current_loop = asyncio.get_running_loop()
        current_loop_id = id(current_loop)
        
        # 如果客户端不存在，或者绑定的事件循环已发生漂移（常见于 Celery Worker 重复使用进程执行新任务）
        if _redis_client is None or _redis_loop_id != current_loop_id:
            if _redis_client:
                # 尝试关闭旧连接，但不阻塞（可能旧 Loop 已死）
                try:
                    await _redis_client.aclose()
                except Exception:
                    pass
            
            _redis_client = redis.from_url(settings.CELERY_BROKER_URL, decode_responses=True)
            _redis_loop_id = current_loop_id
            logger.info(f"Rate Limiter: 已为新事件循环 {current_loop_id} 初始化 Redis 客户端。")
            
        return _redis_client
    except RuntimeError:
        # 非事件循环环境 (虽然在本项目中概率极低)
        return redis.from_url(settings.CELERY_BROKER_URL, decode_responses=True)

# Redis Lua 脚本：实现原子级的时间槽抢占
# KEYS[1]: 锁定的键名 (例如 gen_next_slot_time)
# ARGV[1]: 当前时间戳 (now)
# ARGV[2]: 最小间隔 (10)
# ARGV[3]: 随机偏移范围 (3)
SLOT_LUA_SCRIPT = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local interval_base = tonumber(ARGV[2])
local random_n = tonumber(ARGV[3])

local last_slot = redis.call('GET', key)
local scheduled_time = now

if last_slot then
    last_slot = tonumber(last_slot)
    if last_slot > now then
        scheduled_time = last_slot
    end
end

-- 计算下一次可用的时间槽 (本次预定时间 + 10s + 随机偏移)
local next_slot = scheduled_time + interval_base + random_n

redis.call('SET', key, next_slot)
-- 设置 10 分钟过期防止残留
redis.call('EXPIRE', key, 600)

return tostring(scheduled_time)
"""

async def wait_for_api_slot(api_type: str = "default_api", interval_base: int = 10):
    """
    分布式 API 排队调度器：
    1. 通过 Redis Lua 脚本原子性地抢占一个未来的执行时间槽
    2. 如果抢到的时间戳晚于当前，则进行异步等待 (asyncio.sleep)
    
    规则：interval_base + n 秒间隔，n 为 0-1 秒随机 (对于高并发引擎如 Grok 可设 interval_base=1)
    """
    try:
        now = time.time()
        random_offset = random.uniform(0.5, 1.5) if interval_base > 0 else 0
        
        # 获取（或重建）适配当前 Loop 的 Redis 客户端
        client = await get_redis_client()
        
        # 不同的 API 使用独立的时间槽键，实现并发隔离
        slot_key = f"{api_type}_next_slot_time"
        
        # 执行 Lua 脚本获取分配给我的起始时间
        reserved_ts_str = await client.eval(
            SLOT_LUA_SCRIPT, 
            1, 
            slot_key, 
            now, 
            interval_base, 
            random_offset
        )
        
        reserved_ts = float(reserved_ts_str)
        wait_duration = reserved_ts - now
        
        if wait_duration > 0:
            # 日志加上 PID 以便区分多进程
            import os
            logger.info(f"Rate Limiter [PID:{os.getpid()}]: 当前槽位已被占用，排队等待 {wait_duration:.2f}s 后执行...")
            await asyncio.sleep(wait_duration)
            
    except Exception as e:
        # 如果 Redis 异常，记录具体信息并降级
        logger.error(f"Rate Limiter Error: {type(e).__name__} - {e}. Falling back to basic jitter.")
        await asyncio.sleep(random.uniform(2.0, 5.0))
