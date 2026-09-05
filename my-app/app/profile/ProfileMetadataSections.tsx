'use client';

import * as m from 'framer-motion/m';
import type { UserProfile } from './ProfileClient';

function getIdentityProviderLabels(
  provider: NonNullable<UserProfile['identityProvider']>,
) {
  const localAccount =
    provider.authProvider === 'local' ||
    provider.authProvider === 'local_manual';
  if (localAccount)
    return { method: 'Local break-glass account', session: 'Not applicable' };
  if (provider.authProvider === 'ad_outage_fallback')
    return {
      method: 'Active Directory — auth service outage fallback',
      session: 'Not linked — native fallback session',
    };
  if (provider.authProvider === 'ad_manual')
    return {
      method: 'Active Directory — direct sign-in',
      session: 'Not linked — direct portal session',
    };
  if (provider.idpLinked)
    return {
      method: 'Active Directory — federated sign-in (OIDC)',
      session: 'Linked — signing out ends your IdP session too',
    };
  return { method: 'Active Directory', session: 'Not linked' };
}

export default function ProfileMetadataSections({
  profile,
}: {
  profile: UserProfile;
}) {
  const identityProviderLabels = profile.identityProvider
    ? getIdentityProviderLabels(profile.identityProvider)
    : null;
  return (
    <>
      <div>
        <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center">
          <svg
            className="w-6 h-6 mr-2 text-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
          Directory Information
        </h2>
        <div className="bg-muted/50 rounded-lg p-4">
          <p className="text-sm font-medium text-muted-foreground block mb-1">
            Distinguished Name
          </p>
          <p className="text-foreground font-mono text-sm break-all">
            {profile.distinguishedName || 'N/A'}
          </p>
        </div>
      </div>

      {profile.identityProvider && (
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center">
            <svg
              className="w-6 h-6 mr-2 text-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
            Sign-in &amp; Identity Provider
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-sm font-medium text-muted-foreground block mb-1">
                Authentication method
              </p>
              <p className="text-foreground font-medium">
                {identityProviderLabels?.method}
              </p>
            </div>
            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-sm font-medium text-muted-foreground block mb-1">
                Identity provider session
              </p>
              <p className="text-foreground font-medium">
                {identityProviderLabels?.session}
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Directory attributes above are read live from Active Directory.
            Central sign-in is brokered by the UAR identity provider service.
            Direct sessions are explicitly marked as an operator-authorized
            alternate or a guarded outage fallback.
          </p>
        </div>
      )}

      <div>
        <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center">
          <svg
            className="w-6 h-6 mr-2 text-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          Group Memberships
        </h2>
        {profile.groups && profile.groups.length > 0 ? (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {profile.groups.map((group, index) => (
              <m.div
                key={group}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-muted/50 rounded-lg p-3 border border-border"
              >
                <p className="text-foreground text-sm font-mono break-all">
                  {group}
                </p>
              </m.div>
            ))}
          </div>
        ) : (
          <div className="bg-muted/50 rounded-lg p-4 text-center">
            <p className="text-muted-foreground">No group memberships found</p>
          </div>
        )}
      </div>
    </>
  );
}
