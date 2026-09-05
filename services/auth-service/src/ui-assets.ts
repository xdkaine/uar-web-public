import { readFile } from 'node:fs/promises';

const FONT_MODULES: Readonly<Record<string, string>> = {
  '/ui/fonts/geist-v1-latin.woff2':
    '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2',
  '/ui/fonts/geist-mono-v1-latin.woff2':
    '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2',
};

const cache = new Map<string, Promise<Buffer>>();

/**
 * Loads one of the two exact, packaged Geist UI fonts. There is intentionally no
 * filesystem-derived routing or user-controlled path joining here.
 */
export function loadUiFont(requestPath: string): Promise<Buffer> | null {
  const moduleId = FONT_MODULES[requestPath];
  if (!moduleId) return null;

  let asset = cache.get(requestPath);
  if (!asset) {
    asset = readFile(require.resolve(moduleId));
    cache.set(requestPath, asset);
  }
  return asset;
}
