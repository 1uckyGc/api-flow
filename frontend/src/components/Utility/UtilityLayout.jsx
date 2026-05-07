import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { PenLine, Image, Film, Clapperboard } from 'lucide-react';
import ToolPanel from './ToolPanel';
import EndlessGallery from './EndlessGallery';
import useTaskStore from '../../stores/useTaskStore';

const moduleMap = {
  '/t2i': { title: '文生图工作台', desc: '从文字描述生成图片', Icon: PenLine },
  '/i2i': { title: '图生图工作台', desc: '基于参考图进行风格转换', Icon: Image },
  '/t2v': { title: '文生视频工作台', desc: '从文字描述生成视频', Icon: Film },
  '/i2v': { title: '图生视频工作台', desc: '基于参考图生成视频', Icon: Clapperboard },
};

export default function UtilityLayout() {
  const { pathname } = useLocation();

  const currentModule = Object.entries(moduleMap).find(([key]) => pathname.startsWith(key));
  const { title, desc, Icon } = currentModule ? currentModule[1] : { title: '工作台', desc: '', Icon: PenLine };

  const fetchTaskGroups = useTaskStore((s) => s.fetchTaskGroups);
  const connectWebSocket = useTaskStore((s) => s.connectWebSocket);
  const disconnectWebSocket = useTaskStore((s) => s.disconnectWebSocket);

  useEffect(() => {
    fetchTaskGroups();
    connectWebSocket();
    return () => disconnectWebSocket();
  }, [fetchTaskGroups, connectWebSocket, disconnectWebSocket]);

  return (
    <div className="flex flex-1 h-full overflow-hidden">
      {/* Left panel */}
      <aside className="flex-shrink-0 flex flex-col overflow-hidden relative"
        style={{
          width: 'var(--panel-width)',
          background: 'var(--surface-1)',
          borderRight: '1px solid var(--border-subtle)',
        }}>
        {/* Accent glow at top */}
        <div className="absolute top-0 left-0 right-0 h-32 pointer-events-none opacity-[0.04]"
          style={{ background: 'linear-gradient(180deg, var(--accent), transparent)' }} />

        {/* Header */}
        <header className="px-4 py-4 flex-shrink-0 relative z-10"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shadow-lg"
              style={{ background: 'linear-gradient(135deg, var(--accent), #8b5cf6)' }}>
              <Icon size={15} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>{title}</h1>
              <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{desc}</p>
            </div>
          </div>
        </header>

        <ToolPanel />
      </aside>

      {/* Right gallery */}
      <main className="flex-1 overflow-hidden flex flex-col relative" style={{ background: 'var(--surface-0)' }}>
        {/* Ambient glow */}
        <div className="absolute top-0 right-0 w-[400px] h-[400px] rounded-full pointer-events-none opacity-[0.03] blur-[120px]"
          style={{ background: 'var(--accent)' }} />
        <div className="absolute bottom-0 left-1/4 w-[300px] h-[300px] rounded-full pointer-events-none opacity-[0.02] blur-[100px]"
          style={{ background: '#8b5cf6' }} />
        <EndlessGallery />
      </main>
    </div>
  );
}
