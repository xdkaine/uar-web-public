import type { AccessRequest } from './RequestDetailTypes';
import RequestApprovedDetails from './RequestApprovedDetails';
import RequestRejectedDetails from './RequestRejectedDetails';
import RequestDetailOverview from './RequestDetailOverview';
import RequestDetailVerification from './RequestDetailVerification';

interface RequestDetailMetadataProps {
  request: AccessRequest;
  actorDisplayNames: Record<string, string>;
  includeDetails?: boolean;
}

export default function RequestDetailMetadata({ request, actorDisplayNames, includeDetails = true }: RequestDetailMetadataProps) {
  return (
    <>
      <RequestDetailOverview request={request} />
      <RequestDetailVerification request={request} />
      {includeDetails && <RequestRejectedDetails request={request} />}
      {includeDetails && <RequestApprovedDetails request={request} actorDisplayNames={actorDisplayNames} />}
    </>
  );
}
