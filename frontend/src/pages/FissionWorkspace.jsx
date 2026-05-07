import React, { useState, useEffect, useRef } from 'react';
import { Zap } from 'lucide-react';
import api from '../api/client';
import useTaskStore from '../stores/useTaskStore';
import CreateFissionModal from './fission/CreateFissionModal';
import FissionDetailsModal from './fission/FissionDetailsModal';
import Sidebar from './fission/Sidebar';
import DetailPanel from './fission/DetailPanel';

export default function FissionWorkspace() {
  const [activeJobId, setActiveJobId] = useState(null);
  const [activeJobs, setActiveJobs] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [retryData, setRetryData] = useState(null);
  const [detailJob, setDetailJob] = useState(null);

  const activeJobIdRef = useRef(activeJobId);
  useEffect(() => { activeJobIdRef.current = activeJobId; }, [activeJobId]);

  const fetchJobs = async () => {
    try {
      const res = await api.get('/tasks/'); 
      const filtered = res.data.filter(g => (g.source === 'FISSION' || g.source === 'PIPELINE') && !g.fission_parent_id);
      setActiveJobs(filtered);

      if (!activeJobIdRef.current && filtered.length > 0) setActiveJobId(filtered[0].id);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    fetchJobs();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') fetchJobs();
    }, 4000);
    return () => clearInterval(t);
  }, []);

  const handleOpenCreate = (data = null) => {
    setRetryData(data);
    setIsModalOpen(true);
  };

  const handleRetry = async (job) => {
    try {
      const groupDet = await api.get(`/tasks/${job.id}`);
      const firstTask = groupDet.data.tasks[0];
      const initialImage = firstTask?.input_files?.[0];
      handleOpenCreate({ ...job, input_file: initialImage });
    } catch (e) { alert("获取原始底图失败"); }
  };

  const handleDelete = async (jobId) => {
    if (!window.confirm("确认永久删除该批次及关联文件吗？")) return;
    try {
      await api.delete(`/tasks/${jobId}`);
      if (activeJobId === jobId) setActiveJobId(null);
      fetchJobs();
    } catch (e) { alert("删除失败: " + (e.response?.data?.detail || e.message)); }
  };

  return (
    <div className="flex h-full w-full text-sm" style={{ background: 'var(--surface-0)', color: 'var(--text-secondary)' }}>
      <Sidebar
        activeJobId={activeJobId} 
        setActiveJobId={setActiveJobId}
        activeJobs={activeJobs}
        onOpenCreate={handleOpenCreate}
        onRetry={handleRetry}
        onDelete={handleDelete}
        onShowDetails={setDetailJob}
      />
      {activeJobId ? <DetailPanel activeJobId={activeJobId} /> : (
         <div className="flex-1 h-full flex flex-col items-center justify-center opacity-30">
            <Zap size={32} className="mb-2" style={{ color: 'var(--text-tertiary)' }} />
            <div>在此创建裂变，探索无限可能</div>
         </div>
      )}

      {isModalOpen && (
        <CreateFissionModal 
          initialData={retryData}
          onClose={() => { setIsModalOpen(false); setRetryData(null); }}
          onSuccess={(newId) => {
            setIsModalOpen(false);
            setRetryData(null);
            fetchJobs();
            setActiveJobId(newId);
          }}
        />
      )}

      {detailJob && (
        <FissionDetailsModal 
          job={detailJob}
          onClose={() => setDetailJob(null)}
        />
      )}
    </div>
  );
}
