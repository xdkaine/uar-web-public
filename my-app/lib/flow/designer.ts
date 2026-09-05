export interface StoredWorkflowNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface WorkflowDesignerNode<TEntry = unknown> {
  id: string;
  type: 'flow';
  position: { x: number; y: number };
  data: {
    nodeType: string;
    config: Record<string, unknown>;
    entry?: TEntry;
    summary: string;
  };
}

function cloneConfig(config: Record<string, unknown> | undefined): Record<string, unknown> {
  return structuredClone(config ?? {});
}

export function projectWorkflowNodes<TEntry = unknown>(
  storedNodes: unknown,
  summarize: (node: StoredWorkflowNode, entry?: TEntry) => string,
  resolveEntry?: (nodeType: string) => TEntry | undefined,
): WorkflowDesignerNode<TEntry>[] {
  if (!Array.isArray(storedNodes)) return [];

  return (storedNodes as StoredWorkflowNode[]).map((node, index) => {
    const entry = resolveEntry?.(node.type);
    const projectedNode = {
      ...node,
      config: cloneConfig(node.config),
    };

    return {
      id: node.id,
      type: 'flow',
      position: node.position ?? {
        x: 80 + (index % 3) * 220,
        y: 60 + Math.floor(index / 3) * 140,
      },
      data: {
        nodeType: node.type,
        config: projectedNode.config,
        entry,
        summary: summarize(projectedNode, entry),
      },
    };
  });
}

export function serializeWorkflowNodes(
  nodes: Array<Pick<WorkflowDesignerNode, 'id' | 'position' | 'data'>>,
): StoredWorkflowNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.data.nodeType,
    config: cloneConfig(node.data.config),
    position: node.position,
  }));
}
