import { describe, expect, it } from 'vitest';
import { buildSandboxDocument, validateManagedPageDocument } from './appearance-pages';

describe('managed page sandbox', () => {
  it('accepts registered pages and emits a network-isolated document', () => {
    const result = validateManagedPageDocument('home', { mode: 'advanced', html: '<button>Run</button>', css: 'button{color:red}', javascript: 'document.querySelector("button")', blocks: [] });
    const sandbox = buildSandboxDocument(result.document);
    expect(sandbox).toContain("connect-src 'none'");
    expect(sandbox).toContain("form-action 'none'");
    expect(sandbox).toContain('<button>Run</button>');
  });

  it('rejects unknown routes and oversized source', () => {
    expect(() => validateManagedPageDocument('admin', { mode: 'advanced' })).toThrow('Unknown managed page');
    expect(() => validateManagedPageDocument('home', { html: 'x'.repeat(30001) })).toThrow('HTML exceeds');
  });

  it('rejects malformed nested blocks, duplicate ids, and unsafe action links', () => {
    expect(() => validateManagedPageDocument('home', {
      mode: 'basic',
      blocks: [{ id: 'faq', type: 'faq', title: 'FAQ', items: null }],
    })).toThrow('needs 1 to 20 FAQ items');
    expect(() => validateManagedPageDocument('home', {
      mode: 'basic',
      blocks: [
        { id: 'same', type: 'richText', body: 'One' },
        { id: 'same', type: 'richText', body: 'Two' },
      ],
    })).toThrow('Block ids must be unique');
    expect(() => validateManagedPageDocument('home', {
      mode: 'basic',
      blocks: [{ id: 'actions', type: 'actionCards', title: 'Actions', items: [{ label: 'Run', description: 'Unsafe', href: 'javascript:alert(1)' }] }],
    })).toThrow('internal paths or HTTPS URLs');
  });

  it('accepts bounded portal-native blocks and normalizes HTTPS links', () => {
    const result = validateManagedPageDocument('home', {
      mode: 'basic',
      blocks: [{ id: 'actions', type: 'actionCards', title: 'Actions', items: [{ label: 'Help', description: 'Open help', href: '/support/create' }, { label: 'Status', description: 'Open status', href: 'https://status.example.test/' }] }],
    });
    expect(result.document.blocks).toHaveLength(1);
  });
});
