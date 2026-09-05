import type { ReactNode } from 'react';

export const InfoRow = ({ label, value, highlight = false, icon = null }: { label: string; value?: ReactNode; highlight?: boolean; icon?: ReactNode }) => (
  <div className="flex py-3 border-b last:border-b-0 items-center">
    <dt className="w-1/3 text-sm font-medium text-muted-foreground flex items-center gap-2">
      {icon}
      {label}
    </dt>
    <dd className={`w-2/3 text-sm ${highlight ? 'font-semibold text-foreground' : 'text-foreground'} break-all`}>
      {value || 'N/A'}
    </dd>
  </div>
);
