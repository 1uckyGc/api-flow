import React, { useState, useCallback, useEffect } from 'react';
import { Clapperboard } from 'lucide-react';
import api from '../../api/client';
import useTaskStore from '../../stores/useTaskStore';
import TaskSidebar from '../../components/Utility/TaskSidebar';
import StoryboardResultGrid from './StoryboardResultGrid';
import DirectorCreateModal from './DirectorCreateModal';

export default function DirectorPage() {
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [retryData, setRetryData] = useState(null);

  const taskGroups = useTaskStore(s => s.taskGroups);
  const fetchTaskGroups = useTaskStore(s => s.fetchTaskGroups);

  const activeJobs = taskGroups.filter(g => g.source === 'DIRECTOR');

  useEffect(() => {
    fetchTaskGroups();
  }, [fetchTaskGroups]);

  useEffect(() => {
    if (!activeGroupId && activeJobs.length > 0) {
      setActiveGroupId(activeJobs[0].id);
    }
  }, [activeJobs, activeGroupId]);

  const handleSubmit = useCallback(async (formData) => {
    setSubmitting(true);
    try {
      const res = await api.post('/director/create', formData);
      setActiveGroupId(res.data.id);
      setIsModalOpen(false);
      fetchTaskGroups();
    } catch (e) {
      alert(`提交失败: ${e.response?.data?.detail || e.message}`);
    } finally {
      setSubmitting(false);
    }
  }, [fetchTaskGroups]);

  const handleDelete = async (jobId) => {
    if (!window.confirm("确认永久删除该批次及关联文件吗？")) return;
    try {
      await api.delete(`/tasks/${jobId}`);
      if (activeGroupId === jobId) setActiveGroupId(null);
      fetchTaskGroups();
    } catch (e) { 
      alert("删除失败: " + (e.response?.data?.detail || e.message)); 
    }
  };

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--surface-0)' }}>
      <TaskSidebar 
        title="导演模式"
        icon={Clapperboard}
        activeJobId={activeGroupId}
        setActiveJobId={setActiveGroupId}
        activeJobs={activeJobs}
        onOpenCreate={() => { setRetryData(null); setIsModalOpen(true); }}
        onDelete={handleDelete}
        onRetry={(job) => { setRetryData(job); setIsModalOpen(true); }}
      />
      
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
        <StoryboardResultGrid groupId={activeGroupId} />
      </div>

      {isModalOpen && (
        <DirectorCreateModal 
          onClose={() => { setIsModalOpen(false); setRetryData(null); }}
          onSubmit={handleSubmit}
          submitting={submitting}
          initialData={retryData}
        />
      )}
    </div>
  );
}
