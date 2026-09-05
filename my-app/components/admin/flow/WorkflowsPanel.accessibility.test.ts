import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ConditionGroupsEditor, MonitorCredentialForm } from './WorkflowsPanel';

describe('workflow panel accessible names', () => {
  it('server-renders associated labels for advanced condition controls', () => {
    const html = renderToStaticMarkup(createElement(ConditionGroupsEditor, {
      groups: [{ match: 'all', comparisons: [{ field: 'severity', op: 'equals', value: '' }] }],
      contextFields: [{ key: 'severity', label: 'Severity' }],
      onChange: () => undefined,
    }));

    expect(html).toContain('for="condition-group-0-match"');
    expect(html).toContain('id="condition-group-0-match"');
    expect(html).toContain('aria-label="Condition comparison 1 field"');
    expect(html).toContain('aria-label="Condition comparison 1 operator"');
  });

  it('server-renders persistent labels for every credential entry control', () => {
    const html = renderToStaticMarkup(createElement(MonitorCredentialForm, {
      credentialDraft: { name: '', kind: 'bearer', username: '', headerName: '', secret: '', hosts: '' },
      credentialBusy: false,
      onChange: () => undefined,
      onCreate: () => undefined,
    }));

    for (const label of ['Credential name', 'Credential type', 'Secret', 'Exact allowed hosts']) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(/<label[^>]*>[\s\S]*Credential name[\s\S]*<input/);
    expect(html).toMatch(/<label[^>]*>[\s\S]*Credential type[\s\S]*<select/);
    expect(html).toMatch(/<label[^>]*>[\s\S]*Exact allowed hosts[\s\S]*<textarea/);
  });
});
