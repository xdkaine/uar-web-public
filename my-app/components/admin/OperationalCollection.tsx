'use client';

import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface OperationalCollectionColumn<T> {
  id: string;
  header: string;
  desktop: (item: T) => ReactNode;
}

/** One item model rendered as an operator table on desktop and complete cards on mobile. */
export function OperationalCollection<T extends { id: string }>({
  items, columns, mobile, empty,
}: {
  items: T[];
  columns: OperationalCollectionColumn<T>[];
  mobile: (item: T) => ReactNode;
  empty: ReactNode;
}) {
  if (!items.length) return <Card><CardContent className="p-8 text-center text-muted-foreground">{empty}</CardContent></Card>;
  return <>
    <div className="hidden overflow-x-auto rounded-md border md:block">
      <Table><TableHeader><TableRow>{columns.map((column) => <TableHead key={column.id}>{column.header}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{items.map((item) => <TableRow key={item.id}>{columns.map((column) => <TableCell key={column.id}>{column.desktop(item)}</TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </div>
    <div className="space-y-3 md:hidden">{items.map((item) => <Card key={item.id}><CardContent className="p-4">{mobile(item)}</CardContent></Card>)}</div>
  </>;
}
