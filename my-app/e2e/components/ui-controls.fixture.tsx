import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import AccountLifecycleTab from '@/components/admin/AccountLifecycleTab';
import PortalNav from '@/components/PortalNav';
import GlobalSearch from '@/app/admin/search/page';
import { Button } from '@/components/ui/button';
import { CommandDialog, CommandInput, CommandList, CommandItem } from '@/components/ui/command';
import '@/app/globals.css';

function Fixture() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PortalNav links={[]} sessionState="admin" displayName="Demo Operator" username="operator" onSignOut={() => undefined} logoUrl="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" />
      <main className="space-y-6 p-4">
        <Button onClick={() => setOpen(true)}>Quick navigation</Button>
        <CommandDialog open={open} onOpenChange={setOpen}>
          <div className="px-4 pt-4 text-sm font-medium">Quick navigation</div>
          <CommandInput placeholder="Type a page or capability…" className="h-12" />
          <CommandList><CommandItem>Directory Users</CommandItem></CommandList>
        </CommandDialog>
        <AccountLifecycleTab />
        <GlobalSearch />
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
