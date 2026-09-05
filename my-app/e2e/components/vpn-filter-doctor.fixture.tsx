import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import VPNFilterBar, {
  type FacultyFilter,
  type PortalFilter,
  type StatusFilter,
  type ViewMode,
} from '@/components/admin/vpn/VPNFilterBar';
import '@/app/globals.css';

function VPNFilterFixture() {
  const [searchQuery, setSearchQuery] = useState('initial search');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [filterPortal, setFilterPortal] = useState<PortalFilter>('all');
  const [filterFaculty, setFilterFaculty] = useState<FacultyFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('unified');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [refreshes, setRefreshes] = useState(0);
  const [exports, setExports] = useState(0);
  const [submissions, setSubmissions] = useState(0);

  return (
    <form onSubmit={(event) => { event.preventDefault(); setSubmissions((current) => current + 1); }}>
      <VPNFilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filterStatus={filterStatus}
        onStatusChange={setFilterStatus}
        filterPortal={filterPortal}
        onPortalChange={setFilterPortal}
        filterFaculty={filterFaculty}
        onFacultyChange={setFilterFaculty}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showAdvancedFilters={showAdvancedFilters}
        onToggleAdvancedFilters={() => setShowAdvancedFilters((current) => !current)}
        onExportCSV={() => setExports((current) => current + 1)}
        onRefresh={() => setRefreshes((current) => current + 1)}
        isPolling={isPolling}
        onTogglePolling={() => setIsPolling((current) => !current)}
        filteredCount={4}
        totalCount={12}
        lastUpdated={null}
      />
      <output aria-live="polite" data-testid="filter-state" className="sr-only">
        search={searchQuery};status={filterStatus};portal={filterPortal};faculty={filterFaculty};view={viewMode};refreshes={refreshes};exports={exports};submissions={submissions}
      </output>
    </form>
  );
}

createRoot(document.getElementById('root')!).render(
  <main className="min-h-screen bg-background p-4 sm:p-8">
    <VPNFilterFixture />
  </main>,
);
