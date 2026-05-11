import os
import logging

logger = logging.getLogger(__name__)


def remove_task_output(output_file: str | None) -> bool:
    """安全删除单个任务的输出文件，返回是否成功"""
    if not output_file or not os.path.exists(output_file):
        return False
    try:
        os.remove(output_file)
        return True
    except Exception as e:
        logger.warning(f"Failed to remove output file {output_file}: {e}")
        return False


def remove_tasks_outputs(tasks) -> int:
    """批量删除多个任务的输出文件，返回成功删除的数量。
    同时顺手清掉关联的 output_thumbnail（不计入主计数，孤立 thumbnail 也得清）。
    """
    count = 0
    for task in tasks:
        if remove_task_output(getattr(task, 'output_file', None)):
            count += 1
        # 视频封面（i2v/t2v 任务的首帧 jpg）—— 漏删会留磁盘碎片
        remove_task_output(getattr(task, 'output_thumbnail', None))
    return count
