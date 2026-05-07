import { create } from 'zustand';

// 初始提供一个基础节点，防止空画布
const initialNodes = [
  {
    id: 'node-' + Math.random().toString(36).substr(2, 9),
    type: 't2i',
    label: '文生图基础节点',
    config: {
      model: 'grok-vision',
      aspect_ratio: '16:9',
      images_per_prompt: 1
    }
  }
];

const useWorkshopStore = create((set, get) => ({
  nodes: initialNodes,
  selectedNodeId: null,
  workflowMeta: {
    title: '未命名工作流',
    description: '创意流水线模板'
  },
  
  // -- Meta Data --
  setWorkflowMeta: (meta) => set((s) => ({ workflowMeta: { ...s.workflowMeta, ...meta } })),

  // -- Node Management --
  setNodes: (nodes) => set({ nodes }),
  
  addNode: (type, label) => {
    const newNode = {
      id: 'node-' + Math.random().toString(36).substr(2, 9),
      type,
      label,
      config: {}
    };
    set((state) => ({ nodes: [...state.nodes, newNode], selectedNodeId: newNode.id }));
  },
  
  insertNodeAt: (index, type, label) => {
    const newNode = {
      id: 'node-' + Math.random().toString(36).substr(2, 9),
      type,
      label,
      config: {}
    };
    set((state) => {
      const newNodes = [...state.nodes];
      newNodes.splice(index, 0, newNode);
      return { nodes: newNodes, selectedNodeId: newNode.id };
    });
  },

  removeNode: (id) => set((state) => ({
    nodes: state.nodes.filter(n => n.id !== id),
    selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId
  })),

  selectNode: (id) => set({ selectedNodeId: id }),

  updateNodeConfig: (id, newConfig) => set((state) => ({
    nodes: state.nodes.map(n => 
      n.id === id ? { ...n, config: { ...n.config, ...newConfig } } : n
    )
  })),

  updateNodeLabel: (id, label) => set((state) => ({
    nodes: state.nodes.map(n => 
      n.id === id ? { ...n, label } : n
    )
  })),

  moveNode: (dragIndex, hoverIndex) => set((state) => {
    const newNodes = [...state.nodes];
    const draggedItem = newNodes[dragIndex];
    newNodes.splice(dragIndex, 1);
    newNodes.splice(hoverIndex, 0, draggedItem);
    return { nodes: newNodes };
  }),
  
  // Getter 辅助
  getSelectedNode: () => {
    const { nodes, selectedNodeId } = get();
    return nodes.find(n => n.id === selectedNodeId) || null;
  }
}));

export default useWorkshopStore;
