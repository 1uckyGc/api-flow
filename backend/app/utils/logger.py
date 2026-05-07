import os
import logging
import sys
from logging.handlers import RotatingFileHandler

def setup_logger(name="followmeeeaigc"):
    # 创建日志目录
    log_dir = "logs"
    if not os.path.exists(log_dir):
        os.makedirs(log_dir)

    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)

    # 如果已经有 handler 则不再添加 (防止重复)
    if logger.handlers:
        return logger

    # 格式包含 PID 和进程/线程上下文
    formatter = logging.Formatter(
        '[%(levelname)s] [%(asctime)s] [PID:%(process)d] [Thread:%(thread)d] [%(name)s] : %(message)s'
    )

    # 控制台输出
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # 文件持久化输出
    file_handler = RotatingFileHandler(
        os.path.join(log_dir, "app.log"),
        maxBytes=10*1024*1024, # 10MB
        backupCount=5,
        encoding="utf-8"
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger

# 预初始化默认 logger
logger = setup_logger()
