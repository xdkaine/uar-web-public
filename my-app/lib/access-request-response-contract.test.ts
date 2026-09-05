import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MUTATION_ROUTES_WITH_REQUEST_PAYLOADS = [
  'acknowledge',
  'approve',
  'create-account',
  'manual-assign',
  'move-back',
  'notify-faculty',
  'reject',
  'return-to-faculty',
  'undo-notify-faculty',
  'save-credentials',
] as const;

describe('AccessRequest mutation response contract', () => {
  it.each(MUTATION_ROUTES_WITH_REQUEST_PAYLOADS)(
    '%s routes every request payload through the shared redactor',
    (routeName) => {
      const source = readFileSync(
        join(process.cwd(), 'app', 'api', 'admin', 'requests', '[id]', routeName, 'route.ts'),
        'utf8'
      );

      expect(source).toContain("from '@/lib/access-request-response'");
      expect(source).not.toMatch(/request:\s+(?:updatedRequest|finalRequest|requestWithFailureState|result)\s*[,}]/);
      expect(source).toMatch(/request:\s+toSafeAccessRequestResponse\(/);
    }
  );
});
