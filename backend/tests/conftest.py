"""
测试环境引导。

必须在任何 `app.*` 导入之前设好环境变量 —— `app.config.Settings` 在导入期就校验
SECRET_KEY 非空，DATABASE_URL 也没有默认值，缺哪一个，所有 collection 都会炸。
"""
import os

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
