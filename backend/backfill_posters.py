import os
import subprocess
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models.task import Task, TaskStatus

# 从环境变量获取数据库连接，确保与 Docker 运行环境一致
DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is not set")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def backfill():
    db = SessionLocal()
    # 查找所有成功的视频任务且没有缩略图的
    tasks = db.query(Task).filter(
        Task.status == TaskStatus.SUCCESS,
        Task.output_thumbnail == None
    ).all()
    
    print(f"Found {len(tasks)} tasks needing poster...")
    
    for task in tasks:
        if not task.output_file: continue
        if not task.output_file.lower().endswith(('.mp4', '.webm', '.mov')): continue
        
        filepath = task.output_file
        if not os.path.exists(filepath):
            print(f"File not found: {filepath}")
            continue
            
        poster_path = f"{filepath}.poster.jpg"
        print(f"Generating poster for {filepath}...")
        
        cmd = [
            "ffmpeg", "-y",
            "-ss", "0.1",
            "-i", filepath,
            "-vframes", "1",
            "-q:v", "2",
            poster_path
        ]
        
        try:
            subprocess.run(cmd, check=True, capture_output=True)
            task.output_thumbnail = poster_path.replace("\\", "/")
            print(f"Success: {task.output_thumbnail}")
        except Exception as e:
            print(f"Failed to generate poster for {task.id}: {e}")
            
    db.commit()
    db.close()
    print("Backfill completed.")

if __name__ == "__main__":
    backfill()
