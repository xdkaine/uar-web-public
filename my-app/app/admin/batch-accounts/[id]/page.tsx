import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { NextRequest } from 'next/server';

import { GET as getBatchDetail } from '@/app/api/admin/batch-accounts/[id]/route';

import BatchDetailClient, { type BatchDetail } from './BatchDetailClient';

export const dynamic = 'force-dynamic';

interface BatchDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function BatchDetailPage({ params }: BatchDetailPageProps) {
  const { id } = await params;
  const response = await getBatchDetail(
    new NextRequest(`http://uar.internal/api/admin/batch-accounts/${encodeURIComponent(id)}`, {
      headers: new Headers(await headers()),
    }),
    { params: Promise.resolve({ id }) }
  );

  if (response.status === 401) {
    redirect(`/login?redirect=${encodeURIComponent(`/admin/batch-accounts/${id}`)}`);
  }

  if (response.status === 403) {
    redirect('/admin');
  }

  if (response.status === 404) {
    notFound();
  }

  const body = await response.json() as { batch?: BatchDetail; error?: string };
  if (!response.ok || !body.batch) {
    throw new Error(body.error ?? 'Unable to load this batch');
  }

  return <BatchDetailClient batch={body.batch} />;
}
