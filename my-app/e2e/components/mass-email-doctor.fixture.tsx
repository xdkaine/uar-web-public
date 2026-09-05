import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ActionImpactDialogProvider } from '@/components/admin/ActionImpactDialog';
import type { ComposerTab } from '@/components/admin/MassEmailTypes';
import '@/app/globals.css';

import MassEmailComposer from '@/components/admin/MassEmailComposer';

function Fixture() {
  const [workspace, setWorkspace] = useState<ComposerTab>('campaigns');
  return <><ActionImpactDialogProvider /><MassEmailComposer activeWorkspace={workspace} onWorkspaceChange={setWorkspace} /></>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
