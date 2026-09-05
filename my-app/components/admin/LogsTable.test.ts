import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LogsTable } from './LogsTable';

describe('LogsTable', () => {
  it('renders the restrained six-column layout with named identity and accessible details action', () => {
    const html = renderToStaticMarkup(createElement(LogsTable, {
      logs: [{ id: 'log-1', createdAt: '2026-09-04T12:00:00.000Z', action: 'approve_request', category: 'access_request', username: 'admin1', actorDisplayName: 'Ada Admin', subjectUsername: 'student1', subjectDisplayName: 'Sam Student', success: true }],
      totalLogs: 1, currentPage: 1, totalPages: 1, onPageChange: () => {}, onSelectLog: () => {},
    }));
    for (const heading of ['Time', 'Event', 'Actor', 'Subject', 'Outcome', 'Details']) expect(html).toContain(`>${heading}<`);
    expect(html).toContain('Ada Admin');
    expect(html).toContain('Sam Student');
    expect(html).toContain('aria-label="View details for Approve Request"');
    expect(html).not.toContain('>Target<');
  });

  it('uses the stored outcome over the legacy success flag', () => {
    const html = renderToStaticMarkup(createElement(LogsTable, {
      logs: [{ id: 'log-2', createdAt: '2026-09-04T12:00:00.000Z', action: 'process_lifecycle_action', category: 'lifecycle', username: 'system', outcome: 'pending', success: true }],
      totalLogs: 1, currentPage: 1, totalPages: 1, onPageChange: () => {}, onSelectLog: () => {},
    }));
    expect(html).toContain('>Pending<');
    expect(html).not.toContain('>Success<');
  });
});
