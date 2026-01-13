import { QueryProvider } from '@/components/providers/query-provider';
import { VersionCard } from '@/components/admin/engines/VersionCard';
import { Suspense } from 'react';

async function fetchVersions() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ''}/api/engines`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Failed to load engine versions');
  return res.json();
}

interface PageProps {
  params: { version: string };
}

async function VersionDetail({ version }: { version: string }) {
  const data = await fetchVersions();
  const v = (data as any[]).find((row) => row.version === version);

  if (!v) {
    return <div className="text-sm text-muted-foreground">Version {version} not found.</div>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-foreground">Engine {version}</h1>
      <VersionCard version={v.version} notes={v.notes} metrics={v.metrics} />
      <p className="text-xs text-muted-foreground">
        This page can be extended with best/worst tickers, regressions, and exports.
      </p>
    </div>
  );
}

export default function EngineVersionPage({ params }: PageProps) {
  const { version } = params;

  return (
    <QueryProvider>
      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading version {version}…</div>}>
        <VersionDetail version={version} />
      </Suspense>
    </QueryProvider>
  );
}
