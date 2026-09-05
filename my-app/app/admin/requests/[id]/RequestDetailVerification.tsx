import type { AccessRequest } from './RequestDetailTypes';
import MetadataField from './RequestDetailField';

export default function RequestDetailVerification({ request }: { request: AccessRequest }) {
  return (
      <section className="border-t border-border pt-4 sm:pt-6">
        <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-foreground">Verification Status</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          <MetadataField label="Email Verified">
            {request.isVerified ? (
              <span className="text-green-600 dark:text-green-400">✓ Verified</span>
            ) : (
              <span className="text-red-600 dark:text-red-400">✗ Not Verified</span>
            )}
          </MetadataField>
          {request.verifiedAt && (
            <MetadataField label="Verified At">{new Date(request.verifiedAt).toLocaleString()}</MetadataField>
          )}
          <MetadataField label="Request Created">{new Date(request.createdAt).toLocaleString()}</MetadataField>
        </dl>
      </section>

  );
}
