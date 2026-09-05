import { describe, expect, it } from 'vitest';
import { MESSAGE_TEMPLATE_CATALOG } from './catalog';
import { validateMessagePublication } from './publication-guard';

const definition = MESSAGE_TEMPLATE_CATALOG['request.verification'];

describe('message publication guard', () => {
  it('accepts every registered production default', () => {
    for (const candidate of Object.values(MESSAGE_TEMPLATE_CATALOG)) {
      expect(validateMessagePublication({
        definition: candidate,
        subject: candidate.defaultSubject ?? '',
        body: candidate.subjectOnly ? '' : candidate.defaultBody ?? '',
      }), candidate.key).toEqual([]);
    }
  });

  it('allows declared URL placeholders', () => {
    expect(validateMessagePublication({
      definition,
      subject: 'Verify {{name}}',
      body: '<a href="{{verificationUrl}}">Verify</a>',
    })).toEqual([]);
  });

  it('blocks unknown placeholders and sample destinations at publication time', () => {
    expect(validateMessagePublication({
      definition,
      subject: 'Verify {{missing}}',
      body: '<a href="https://localhost/verify">Verify</a>',
    })).toEqual(expect.arrayContaining([
      'Subject uses unknown placeholder {{missing}}',
      expect.stringContaining('sample/reserved destination "localhost"'),
    ]));
  });

  it('requires the Button preset URL to be replaced before publication', () => {
    expect(validateMessagePublication({
      definition,
      subject: 'Verify',
      body: '<a href="REPLACE_WITH_APPROVED_URL">Replace</a>',
    })).toEqual([expect.stringContaining('replace-required Button preset URL')]);
  });

  it.each(['example.com', 'example.net', 'child.example'])('blocks reserved host %s', (host) => {
    expect(validateMessagePublication({
      definition,
      subject: 'Verify',
      body: `<a href="https://${host}/verify">Verify</a>`,
    })).toEqual([expect.stringContaining(`sample/reserved destination "${host}"`)]);
  });

  it('blocks reserved mailto recipients', () => {
    expect(validateMessagePublication({
      definition,
      subject: 'Verify',
      body: '<a href="mailto:ops@example.org">Contact operations</a>',
    })).toEqual([expect.stringContaining('sample/reserved destination "example.org"')]);
  });
});
