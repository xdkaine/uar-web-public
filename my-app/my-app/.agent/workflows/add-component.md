---
description: Add a new admin dashboard tab component
---

# Add Admin Component Workflow

Use this workflow when adding a new tab to the admin dashboard.

## Steps

### 1. Create the Tab Component

Create `my-app/components/admin/YourFeatureTab.tsx`:

```tsx
'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/useToast';
import { fetchWithCsrf } from '@/lib/csrf';
import { usePolling } from '@/hooks/usePolling';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw, Search } from "lucide-react";

interface YourFeatureTabProps {
  // Props from parent, if any
}

export default function YourFeatureTab({ }: YourFeatureTabProps) {
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const { showToast } = useToast();

  // Fetch function for polling
  const fetchData = useCallback(async () => {
    const response = await fetch('/api/admin/your-feature');
    if (!response.ok) throw new Error('Failed to fetch data');
    return await response.json();
  }, []);

  const { isPolling, togglePolling, refresh, lastUpdated } = usePolling(fetchData, {
    onSuccess: (result) => {
      setData(result.items || []);
      setIsLoading(false);
    },
    onError: (error) => {
      showToast('Failed to load data', 'error');
      setIsLoading(false);
    }
  });

  // Filter data
  const filteredData = useMemo(() => {
    if (!searchQuery) return data;
    return data.filter(item => 
      item.name?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [data, searchQuery]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Your Feature</h2>
        <div className="flex items-center gap-3">
          <Button
            variant={isPolling ? "default" : "outline"}
            onClick={togglePolling}
            size="sm"
          >
            {isPolling ? 'Live' : 'Off'}
          </Button>
          <Button onClick={() => refresh()} size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-6">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
            <Input
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredData.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.status}</TableCell>
                <TableCell>
                  <Button variant="link" size="sm">View</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
```

### 2. Add to Admin Page

Edit `my-app/app/admin/page.tsx`:

1. Import the component:
   ```tsx
   import YourFeatureTab from '@/components/admin/YourFeatureTab';
   ```

2. Add state if needed:
   ```tsx
   const [yourData, setYourData] = useState<YourDataType[]>([]);
   ```

3. Add the tab to the activeTab type union and dropdown menu

4. Add the tab content:
   ```tsx
   {activeTab === 'your-feature' && <YourFeatureTab />}
   ```

### 3. Create Detail Modal (Optional)

If needed, create `my-app/components/admin/YourFeatureModal.tsx` for viewing/editing details.

### 4. Verify

```bash
cd my-app && npm run build
```

## File Structure

```
components/admin/
├── YourFeatureTab.tsx      # Main tab component
├── YourFeatureModal.tsx    # Detail modal (optional)
└── YourFeatureForm.tsx     # Form component (optional)
```
