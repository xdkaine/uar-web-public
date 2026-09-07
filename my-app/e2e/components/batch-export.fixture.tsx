import { createRoot } from 'react-dom/client';
import { BatchAccountExportButton } from '@/components/admin/BatchAccountExportButton';

createRoot(document.getElementById('root')!).render(
  <main><BatchAccountExportButton batchId="batch-1" status="completed" /></main>,
);
