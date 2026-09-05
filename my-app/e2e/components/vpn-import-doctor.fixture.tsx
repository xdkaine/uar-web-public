'use client';

import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useVPNImports } from '@/components/admin/vpn/useVPNImports';

export default function VPNImportDoctorFixture() {
  const [refreshCount, setRefreshCount] = useState(0);
  const [messages, setMessages] = useState<string[]>([]);
  const imports = useVPNImports({
    onRefresh: () => setRefreshCount((count) => count + 1),
    showToast: (message) => setMessages((current) => [...current, message]),
  });
  return <main><button onClick={imports.openQueue}>Open queue</button><button onClick={() => imports.processImport('import-1')}>Process import</button><button onClick={() => imports.setShowClearQueueConfirm(true)}>Open clear</button>{imports.showClearQueueConfirm && <><button onClick={() => imports.setShowClearQueueConfirm(false)}>Cancel clear</button><button onClick={imports.confirmClearQueue}>Confirm clear</button></>}<output data-testid="refreshes">{refreshCount}</output><output data-testid="messages">{messages.join('|')}</output><output data-testid="imports">{imports.imports.length}</output></main>;
}

createRoot(document.getElementById('root')!).render(<VPNImportDoctorFixture />);
