import { createRoot } from 'react-dom/client';

import RequestDetailPage from '@/app/admin/requests/[id]/page';
import '@/app/globals.css';

// The real App Router page deliberately consumes Promise-based params with React.use.
// Keep that boundary in this fixture instead of substituting a component-level prop.
const requestId = new URLSearchParams(window.location.search).get('case') || 'ordinary';

createRoot(document.getElementById('root')!).render(
  <RequestDetailPage params={Promise.resolve({ id: requestId })} />,
);
