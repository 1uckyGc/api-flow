FROM python:3.10-slim

WORKDIR /app

# 安装必要的系统依赖 (例如用于编译 psycopg2 等驱动)
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    gcc \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 安装即梦 / Dreamina CLI（用于 /replicate 产线 B 视频生成）
# 二进制装到 /root/.local/bin/dreamina；session 状态在 /root/.dreamina_cli/（用 docker volume 持久化）
RUN curl -sL https://jimeng.jianying.com/cli | bash && \
    /root/.local/bin/dreamina version 2>&1 | head -3
ENV PATH="/root/.local/bin:${PATH}"

COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com --default-timeout=120

# 将所有代码拷贝进来，包括 alembic
COPY . .

# 暴露 FastAPI 端口
EXPOSE 8000

# 默认指令为启动 uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
