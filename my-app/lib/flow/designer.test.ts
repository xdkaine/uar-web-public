import { describe, expect, it } from 'vitest';

import { projectWorkflowNodes, serializeWorkflowNodes } from './designer';

describe('workflow designer projections', () => {
  it('preserves persisted node configuration through open and save', () => {
    const storedNodes = [
      {
        id: 'trigger-1',
        type: 'trigger_ticket_created',
        config: {
          category: 'ACCOUNT',
          severity: 'high',
        },
        position: { x: 120, y: 80 },
      },
    ];

    const designerNodes = projectWorkflowNodes(storedNodes, (node) => `${node.config.category} ticket`);

    expect(designerNodes[0]?.data.config).toEqual({
      category: 'ACCOUNT',
      severity: 'high',
    });
    expect(serializeWorkflowNodes(designerNodes)).toEqual(storedNodes);
  });

  it('does not share mutable config objects with the persisted graph', () => {
    const storedNodes = [
      {
        id: 'action-1',
        type: 'action_send_email',
        config: { recipient: 'owner' },
      },
    ];

    const designerNodes = projectWorkflowNodes(storedNodes, () => 'owner');
    designerNodes[0]!.data.config.recipient = 'requester';

    expect(storedNodes[0]!.config.recipient).toBe('owner');
  });
});
