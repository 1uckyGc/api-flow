import React from 'react';
import useTaskStore from '../stores/useTaskStore';
import Toolbox from '../components/Toolbox/Toolbox';
import GalleryView from '../components/Gallery/GalleryView';

export default function Workspace() {
  const activeGroupId = useTaskStore((s) => s.activeGroupId);

  // 如果没有选中任务，并且想强制展示 toolbox，可以加个全局状态
  // 为了简化，若 activeGroupId 存在即显示 Gallery，如果未来定义一个专门的状态控制新建任务则切换到 Toolbox
  // 目前我们可以假设: 如果 user 点击了 "新建任务"，设置 activeGroupId=null
  
  if (!activeGroupId) {
    return <Toolbox />;
  }
  
  return <GalleryView />;
}
