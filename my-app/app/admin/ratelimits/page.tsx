'use client';

import RateLimitManagementTab from '@/components/admin/RateLimitManagementTab';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

export default function AdminRateLimitsPage() {
  return (
    <AdminRoutePage title="Rate Limiting" tabId="ratelimits" category="rate_limit">
      <AdminPageHeader
        title="Rate Limiting"
        description="Per-route rate limit posture and manual overrides."
      />
      <RateLimitManagementTab />
    </AdminRoutePage>
  );
}
