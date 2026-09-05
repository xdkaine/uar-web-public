import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    messageTemplate: {
      findMany: mocks.findMany,
    },
  },
}));

import {
  clearMessageTemplateCache,
  getAllMessageTemplates,
  getMessageTemplate,
  renderMessageTemplate,
  resolveEmailContent,
} from './core';
import { MESSAGE_TEMPLATE_CATALOG } from './catalog';

beforeEach(() => {
  vi.clearAllMocks();
  clearMessageTemplateCache();
});

describe('getMessageTemplate', () => {
  it('returns the exact default body when nothing is stored', async () => {
    mocks.findMany.mockResolvedValue([]);

    const template = await getMessageTemplate('faculty.handoff_message');
    expect(template.customized).toBe(false);
    expect(template.body).toBe(MESSAGE_TEMPLATE_CATALOG['faculty.handoff_message'].defaultBody);
  });

  it('returns the stored body when customized', async () => {
    mocks.findMany.mockResolvedValue([
      {
        key: 'faculty.handoff_message',
        body: 'Custom handoff for {{name}}',
        updatedBy: 'admin1',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const template = await getMessageTemplate('faculty.handoff_message');
    expect(template.customized).toBe(true);
    expect(template.body).toBe('Custom handoff for {{name}}');
  });

  it('fails open to defaults when the store is unreadable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.findMany.mockRejectedValue(new Error('db down'));

    const templates = await getAllMessageTemplates();
    expect(templates).toHaveLength(Object.keys(MESSAGE_TEMPLATE_CATALOG).length);
    expect(templates[0].customized).toBe(false);
    consoleError.mockRestore();
  });
});

describe('renderMessageTemplate', () => {
  it('substitutes known placeholders', () => {
    expect(
      renderMessageTemplate('Hello {{name}} <{{email}}>', { name: 'Ada', email: 'ada@example.test' })
    ).toBe('Hello Ada <ada@example.test>');
  });

  it('leaves unknown placeholders intact so mistakes are visible', () => {
    expect(renderMessageTemplate('{{known}} {{mystery}}', { known: 'x' })).toBe('x {{mystery}}');
  });
});

describe('resolveEmailContent', () => {
  const FALLBACK = {
    subject: 'Code Subject',
    html: '<p>Relay sent at {{timestamp}}</p>',
  };

  it('returns the fallback untouched for unknown keys', async () => {
    mocks.findMany.mockResolvedValue([]);

    const result = await resolveEmailContent('totally.unknown_key', { timestamp: 'T' }, FALLBACK);
    expect(result).toEqual({ subject: 'Code Subject', html: '<p>Relay sent at {{timestamp}}</p>' });
  });

  it('renders the catalog default subject and the fallback body when nothing is stored', async () => {
    mocks.findMany.mockResolvedValue([]);

    const result = await resolveEmailContent('system.relay_test', { timestamp: 'T' }, FALLBACK);
    expect(result.subject).toBe('UAR Portal - SMTP Relay Test');
    expect(result.html).toBe('<p>Relay sent at T</p>');
  });

  it('keeps the caller subject for templates without a catalog subject', async () => {
    mocks.findMany.mockResolvedValue([]);

    const result = await resolveEmailContent(
      'faculty.handoff_message',
      {},
      { subject: 'Fallback Subject', html: '<p>body</p>' }
    );
    expect(result.subject).toBe('Fallback Subject');
  });

  it('renders a customized stored row with variables', async () => {
    mocks.findMany.mockResolvedValue([
      {
        key: 'system.relay_test',
        body: 'Custom relay at {{timestamp}}',
        updatedBy: 'admin1',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const result = await resolveEmailContent('system.relay_test', { timestamp: 'T' }, FALLBACK);
    expect(result.html).toBe('Custom relay at T');
    expect(result.subject).toBe('UAR Portal - SMTP Relay Test');
  });

  it('falls back to the caller subject when the stored subject renders empty', async () => {
    mocks.findMany.mockResolvedValue([
      {
        key: 'faculty.handoff_message',
        subject: '   ',
        body: 'Custom handoff',
        updatedBy: 'admin1',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const result = await resolveEmailContent(
      'faculty.handoff_message',
      {},
      { subject: 'Fallback Subject', html: '<p>body</p>' }
    );
    expect(result.subject).toBe('Fallback Subject');
    expect(result.html).toBe('Custom handoff');
  });

  it('keeps the code body for subject-only templates', async () => {
    MESSAGE_TEMPLATE_CATALOG['test.subject_only'] = {
      key: 'test.subject_only',
      label: 'Test Subject Only',
      category: 'system',
      defaultSubject: 'Hello {{name}}',
      subjectOnly: true,
      variables: [{ name: 'name', description: 'Name' }],
    };
    try {
      mocks.findMany.mockResolvedValue([
        {
          key: 'test.subject_only',
          subject: 'Stored {{name}}',
          body: 'IGNORED BODY',
          updatedBy: 'admin1',
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const result = await resolveEmailContent(
        'test.subject_only',
        { name: 'Ada' },
        { subject: 'FB', html: '<p>code body</p>' }
      );
      expect(result.subject).toBe('Stored Ada');
      expect(result.html).toBe('<p>code body</p>');
    } finally {
      delete MESSAGE_TEMPLATE_CATALOG['test.subject_only'];
    }
  });
});
