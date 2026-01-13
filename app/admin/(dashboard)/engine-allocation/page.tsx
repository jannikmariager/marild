'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type OwnerRow = {
  symbol: string;
  active_engine_key: string | null;
  active_engine_version: string | null;
  locked_until: string | null;
  last_promotion_at: string | null;
  updated_at: string | null;
  last_score: number | null;
};

type ComparisonEntry = {
  engine_key: string;
  engine_version: string | null;
  score: number;
  expectancy_r: number;
  max_dd_r: number;
  trades: number;
  style: string;
};

type PromotionRow = {
  ts: string;
  symbol: string;
  from_engine_key: string | null;
  to_engine_key: string | null;
  from_version: string | null;
  to_version: string | null;
  delta: number | null;
  applied: boolean;
  reason: string | null;
  pending_reason?: string | null;
  decision_mode?: string | null;
  locked_until?: string | null;
};

export default function EngineAllocationPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [owners, setOwners] = useState<OwnerRow[]>([]);
  const [promotions, setPromotions] = useState<PromotionRow[]>([]);
  const [comparisons, setComparisons] = useState<Record<string, ComparisonEntry[]>>({});
  const [savingFlags, setSavingFlags] = useState(false);
  const [savingOwner, setSavingOwner] = useState(false);
  const [comparisonSymbol, setComparisonSymbol] = useState<string | null>(null);

  const [ownerForm, setOwnerForm] = useState({
    symbol: '',
    engine_key: 'SWING',
    engine_version: 'BASELINE',
    lock_days: 45,
  });

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/engine-allocation');
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      setEnabled(Boolean(data.enabled));
      setAllowlist(Array.isArray(data.allowlist) ? data.allowlist : []);
      setOwners(Array.isArray(data.owners) ? data.owners : []);
      setPromotions(Array.isArray(data.promotions) ? data.promotions : []);
      setComparisons(data.comparisons ?? {});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function lockOwner(symbol: string, days = 30) {
    try {
      const res = await fetch('/api/admin/engine-allocation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lock_owner', symbol, lock_days: days }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to lock (${res.status})`);
      }
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function revertOwner(symbol: string) {
    try {
      const res = await fetch('/api/admin/engine-allocation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revert_owner', symbol }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to revert (${res.status})`);
      }
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const allowlistText = useMemo(() => allowlist.join('\n'), [allowlist]);

  async function saveFlags() {
    setSavingFlags(true);
    setError(null);
    try {
      const nextAllowlist = (document.getElementById('allowlist-textarea') as HTMLTextAreaElement | null)?.value
        ?.split('\n')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean) || [];

      const res = await fetch('/api/admin/engine-allocation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_flags', enabled, allowlist: nextAllowlist }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to save flags (${res.status})`);
      }
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingFlags(false);
    }
  }

  async function saveOwnerOverride() {
    setSavingOwner(true);
    setError(null);
    try {
      const payload = {
        action: 'set_owner',
        symbol: ownerForm.symbol.trim().toUpperCase(),
        engine_key: ownerForm.engine_key.trim().toUpperCase(),
        engine_version: ownerForm.engine_version.trim(),
        lock_days: Number(ownerForm.lock_days || 45),
      };
      if (!payload.symbol) throw new Error('Symbol is required');
      const res = await fetch('/api/admin/engine-allocation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to set owner (${res.status})`);
      }
      setOwnerForm((f) => ({ ...f, symbol: '' }));
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingOwner(false);
    }
  }

  if (loading) {
    return <div className="space-y-4"><h1 className="text-3xl font-bold">Engine Allocation</h1><p className="text-muted-foreground">Loading…</p></div>;
  }

  if (error) {
    return <div className="space-y-4"><h1 className="text-3xl font-bold">Engine Allocation</h1><p className="text-red-600 text-sm">{error}</p></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Engine Allocation</h1>
        <p className="text-muted-foreground mt-1">Control multi-engine ticker ownership, rollout flags, and view promotion history.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Routing Flow (cheatsheet)</CardTitle>
          <CardDescription>From focus list to allocation and live execution</CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <ol className="list-decimal list-inside space-y-1">
            <li>Pre-market sweep builds <span className="font-semibold">daily_focus_tickers</span> (signals only from this list for SWING).</li>
            <li>Signal generators write <span className="font-semibold">ai_signals</span> when trade gate is open.</li>
            <li><span className="font-semibold">model_portfolio_manager</span> filters to focus list → applies trade gate.</li>
            <li>If <span className="font-semibold">engine_allocation_enabled</span> AND symbol in allowlist → use <span className="font-semibold">ticker_engine_owner</span> to pick engine_key/version; else fallback to SWING/BASELINE.</li>
            <li>Live entries store engine_key/version on positions/trades/decision log; publish flags recorded.</li>
            <li>Daily <span className="font-semibold">engine_allocation_scoring</span> reads shadow <span className="font-semibold">engine_trades</span>, scores, and may upsert <span className="font-semibold">ticker_engine_owner</span> (respecting allowlist & cooldown and skipping symbols with open live positions).</li>
            <li>Admin controls here: toggle flag, edit allowlist, manual owner override (locks for N days).</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rollout Controls</CardTitle>
          <CardDescription>Toggle allocation and edit symbol allowlist used for phased rollout.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <div className="text-sm">
              <div className="font-semibold">Enable allocation for allowed symbols</div>
              <div className="text-muted-foreground text-xs">When off, promotion job only proposes; routing stays BASELINE.</div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Symbol allowlist</div>
              <div className="text-xs text-muted-foreground">{allowlist.length} symbols</div>
            </div>
            <Textarea
              id="allowlist-textarea"
              defaultValue={allowlistText}
              className="min-h-[160px] font-mono text-xs"
              placeholder="One symbol per line, e.g. NVDA"
            />
          </div>

          <Button onClick={saveFlags} disabled={savingFlags}>
            {savingFlags ? 'Saving…' : 'Save rollout settings'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ticker Ownership</CardTitle>
          <CardDescription>Current owning engine per symbol. Manual overrides lock for the specified days.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Input
              placeholder="Symbol (e.g. NVDA)"
              value={ownerForm.symbol}
              onChange={(e) => setOwnerForm((f) => ({ ...f, symbol: e.target.value }))}
            />
            <Input
              placeholder="Engine key"
              value={ownerForm.engine_key}
              onChange={(e) => setOwnerForm((f) => ({ ...f, engine_key: e.target.value }))}
            />
            <Input
              placeholder="Engine version"
              value={ownerForm.engine_version}
              onChange={(e) => setOwnerForm((f) => ({ ...f, engine_version: e.target.value }))}
            />
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                className="w-24"
                value={ownerForm.lock_days}
                onChange={(e) => setOwnerForm((f) => ({ ...f, lock_days: Number(e.target.value || 0) }))}
              />
              <Button onClick={saveOwnerOverride} disabled={savingOwner}>Set owner</Button>
            </div>
          </div>

          <div className="border rounded-md overflow-x-auto">
            <Table className="text-sm">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Symbol</TableHead>
                  <TableHead>Engine</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Last score</TableHead>
                  <TableHead>Locked until</TableHead>
                  <TableHead>Last promotion</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {owners.map((o) => (
                  <TableRow key={o.symbol}>
                    <TableCell className="font-semibold">{o.symbol}</TableCell>
                    <TableCell>{o.active_engine_key || '—'}</TableCell>
                    <TableCell><Badge variant="outline">{o.active_engine_version || '—'}</Badge></TableCell>
                    <TableCell className="text-xs">{o.last_score != null ? o.last_score.toFixed(2) : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{o.locked_until ? new Date(o.locked_until).toLocaleString() : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{o.last_promotion_at ? new Date(o.last_promotion_at).toLocaleString() : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{o.updated_at ? new Date(o.updated_at).toLocaleString() : '—'}</TableCell>
                    <TableCell className="text-xs space-y-1">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" onClick={() => setComparisonSymbol(o.symbol)}>
                          View engines
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => lockOwner(o.symbol, 30)}>
                          Lock 30d
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => revertOwner(o.symbol)}>
                          Revert baseline
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {comparisonSymbol && (
            <div className="border rounded-md p-4 bg-muted/40 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Engine comparison — {comparisonSymbol}</h3>
                  <p className="text-xs text-muted-foreground">Top candidates from the last 60-day scoring window.</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setComparisonSymbol(null)}>
                  Close
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {(comparisons[comparisonSymbol] || []).map((entry, idx) => (
                  <div key={`${comparisonSymbol}-${entry.engine_key}-${idx}`} className="rounded-lg border bg-white p-3 text-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{entry.engine_key}{entry.engine_version ? ` / ${entry.engine_version}` : ''}</div>
                      <span className="text-[11px] text-muted-foreground">{entry.style}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">Score</div>
                        <div className="font-mono">{entry.score.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Expectancy (R)</div>
                        <div className="font-mono">{entry.expectancy_r.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Max DD (R)</div>
                        <div className="font-mono">{entry.max_dd_r.toFixed(2)}</div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">Trades: {entry.trades}</div>
                  </div>
                ))}
                {(!comparisons[comparisonSymbol] || comparisons[comparisonSymbol].length === 0) && (
                  <p className="text-xs text-muted-foreground col-span-full">No comparison data available.</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Promotion Log (recent)</CardTitle>
          <CardDescription>Latest proposals and applied promotions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="border rounded-md overflow-x-auto">
            <Table className="text-sm">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Time</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Delta</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promotions.map((p, idx) => (
                  <TableRow key={`${p.symbol}-${idx}`}>
                    <TableCell className="text-xs text-muted-foreground">{p.ts ? new Date(p.ts).toLocaleString() : '—'}</TableCell>
                    <TableCell className="font-semibold">{p.symbol}</TableCell>
                    <TableCell className="text-xs">{[p.from_engine_key, p.from_version].filter(Boolean).join(' / ') || '—'}</TableCell>
                    <TableCell className="text-xs">{[p.to_engine_key, p.to_version].filter(Boolean).join(' / ') || '—'}</TableCell>
                    <TableCell className={`text-right font-mono ${Number(p.delta ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {(p.delta ?? 0).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.applied ? 'default' : 'secondary'}>{p.applied ? 'APPLIED' : 'PROPOSAL'}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.reason || '—'}
                      {p.pending_reason && <span className="ml-1 italic">({p.pending_reason})</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.decision_mode || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
