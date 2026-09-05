import type { AccessRequest } from './RequestDetailTypes';
import MetadataField from './RequestDetailField';

export default function RequestDetailOverview({ request }: { request: AccessRequest }) {
  return (
      <section>
        <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-foreground">User Information</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
          <MetadataField label="Name" valueClassName="text-sm sm:text-base text-foreground font-semibold wrap-break-word">{request.name}</MetadataField>
          <MetadataField label="Email" valueClassName="text-sm sm:text-base text-foreground font-semibold break-all">{request.email}</MetadataField>
          <MetadataField label="Account Type">
            {request.isInternal ? 'Internal (@cpp.edu)' : 'External'}
          </MetadataField>
          {request.institution && (
            <MetadataField label="Institution" valueClassName="text-sm sm:text-base text-foreground font-semibold wrap-break-word">{request.institution}</MetadataField>
          )}
          {request.event && (
            <div className="md:col-span-2">
              <dt className="text-muted-foreground text-xs sm:text-sm font-medium">Event</dt>
              <dd className="bg-muted/50 border border-border rounded-lg p-3 mt-1">
                <p className="text-sm sm:text-base text-foreground font-semibold">{request.event.name}</p>
                {request.event.description && (
                  <p className="text-xs sm:text-sm text-muted-foreground mt-1">{request.event.description}</p>
                )}
                {request.event.endDate && (
                  <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                    Event Expires: {new Date(request.event.endDate).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </p>
                )}
              </dd>
            </div>
          )}
          {request.eventReason && !request.event && (
            <MetadataField label="Event/Reason for Access" className="md:col-span-2" valueClassName="text-sm sm:text-base text-foreground font-semibold wrap-break-word">{request.eventReason}</MetadataField>
          )}
          {request.accessEndTime && (
            <MetadataField label="Requested Access End Time">{new Date(request.accessEndTime).toLocaleString()}</MetadataField>
          )}
        </dl>
      </section>

  );
}
