import { validateEnvironment } from '../lib/env-validator';
import { assertCloneModeForDatabaseAttestation } from '../lib/clone-safety';
import { Client } from 'pg';

async function assertDatabaseCloneSafety(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const result = await client.query<{ attestation: string | null }>(
      "SELECT nullif(current_setting('uar.clone_attestation', true), '') AS attestation"
    );
    assertCloneModeForDatabaseAttestation(result.rows[0]?.attestation ?? null);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  validateEnvironment();
  await assertDatabaseCloneSafety();
  console.log('Environment and database clone-safety configuration validated successfully');

  if (!process.argv.includes('--check-only')) {
    // The compiled file lives at runtime-validation/scripts/runtime-entrypoint.js.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../server.js');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Environment validation failed');
  process.exit(1);
});
