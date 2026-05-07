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
    """批量删除多个任务的输出文件，返回成功删除的数量"""
    count = 0
    for task in tasks:
        if remove_task_output(getattr(task, 'output_file', None)):
            count += 1
    return count
