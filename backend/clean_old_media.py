import os
import time
from pathlib import Path
import sys

def main():
    # 支持传参或者默认使用脚本所在目录
    base_dir_str = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    base_dir = Path(base_dir_str)
    
    outputs_dir = base_dir / "outputs"
    uploads_dir = base_dir / "uploads"

    # Time threshold: 7 days ago
    seven_days_ago = time.time() - (7 * 24 * 60 * 60)

    deleted_files_count = 0
    deleted_size_bytes = 0

    def clean_dir(directory):
        nonlocal deleted_files_count, deleted_size_bytes
        if not directory.exists():
            return
        # Iterate over all files
        for item in directory.rglob("*"):
            if item.is_file():
                # Check when the file was last modified/created
                if item.stat().st_mtime < seven_days_ago:
                    size = item.stat().st_size
                    try:
                        item.unlink()
                        deleted_files_count += 1
                        deleted_size_bytes += size
                    except Exception as e:
                        pass # Silently pass if cannot delete

        # Clean up empty directories
        for item in list(directory.rglob("*"))[::-1]:
            if item.is_dir() and not any(item.iterdir()):
                try:
                    item.rmdir()
                except Exception:
                    pass

    print(f"开始扫描目录 {base_dir} 下的 outputs 和 uploads 目录...")
    clean_dir(outputs_dir)
    clean_dir(uploads_dir)

    print(f"======== 清理完成 ========")
    print(f"共删除老旧媒体文件数量: {deleted_files_count}")
    print(f"释放存储空间: {deleted_size_bytes / (1024*1024*1024):.2f} GB")

if __name__ == "__main__":
    main()
