import { expect, it } from 'vitest';
import { getMetadataBase } from './metadata-base';

it.each([undefined, ''])('preserves the existing default when the setting is absent (%s)', (value) => {
  expect(getMetadataBase(value).href).toBe('https://portal.calpolysoc.org/');
});

it.each(['https://portal.example.test', 'http://localhost:4002/base/'])('preserves a valid configured URL (%s)', (value) => {
  expect(getMetadataBase(value).href).toBe(new URL(value).href);
});

it.each(['/relative-path', 'http://', 'http://[invalid]', 'sensitive-invalid-configuration'])('fails explicitly without echoing invalid configuration (%s)', (value) => {
  expect(() => getMetadataBase(value)).toThrow('Invalid NEXT_PUBLIC_APP_URL: metadata requires an absolute URL');
  try { getMetadataBase(value); } catch (error) {
    expect(String(error)).not.toContain(value);
  }
});
