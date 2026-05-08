import React from 'react';
import { useLocation } from 'react-router-dom';
import GlobalNav from './GlobalNav';
import Inbox from '../Inbox/Inbox';
import FissionWorkspace from '../../pages/FissionWorkspace';
import UtilityLayout from '../Utility/UtilityLayout';
import SettingsModal from '../Settings/SettingsModal';
import DirectorPage from '../../pages/director/DirectorPage';
import WorkshopPage from '../../pages/workshop/WorkshopPage';
import WorkflowBuilder from '../../pages/workshop/WorkflowBuilder';
import WorkflowRunner from '../../pages/workshop/WorkflowRunner';
import Logs from '../../pages/Logs';
import ReplicatePage from '../../pages/replicate/ReplicatePage';

const FISSION_PATHS = ['/fission'];

export default function DashboardLayout() {
  const { pathname } = useLocation();
  const isFissionMode = FISSION_PATHS.some(p => pathname.startsWith(p));
  const isDirectorMode = pathname.startsWith('/director');
  const isWorkshopIndex = pathname === '/workshop';
  const isWorkshopBuild = pathname.startsWith('/workshop/build');
  const isWorkshopRun = pathname.startsWith('/workshop/run');
  const isLogsPage = pathname.startsWith('/logs');
  const isReplicateMode = pathname.startsWith('/replicate');

  const renderContent = () => {
    if (isLogsPage) return <Logs />;
    if (isReplicateMode) return <ReplicatePage />;
    if (isFissionMode) return <FissionWorkspace />;
    if (isDirectorMode) return <DirectorPage />;
    if (isWorkshopIndex) return <WorkshopPage />;
    if (isWorkshopBuild) return <WorkflowBuilder />;
    if (isWorkshopRun) return <WorkflowRunner />;

    return <UtilityLayout />;
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--surface-0)', color: 'var(--text-primary)' }}>
      <GlobalNav />

      <main className="flex-1 flex flex-col relative z-10 overflow-hidden" style={{ background: 'var(--surface-0)' }}>
        {renderContent()}
      </main>

      <SettingsModal />
    </div>
  );
}
