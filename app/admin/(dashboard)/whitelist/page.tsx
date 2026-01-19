'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PlusCircle, RefreshCw, Upload, Search, Filter, CheckCircle2, XCircle, Trash2, Edit3, StickyNote } from 'lucide-react';

type WhitelistRow = {
  symbol: string;
  is_enabled: boolean;
  is_top8: boolean;
  manual_priority: number;
  notes: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type WhitelistResponse = {
  rows: WhitelistRow[];
  total: number;
  enabled: number;
  disabled: number;
  top8: number;
  limit: number;
  offset: number;
};

type EnabledFilter = 'all' | 'enabled' | 'disabled';

export default function TickerWhitelistPage() {
  const [rows, setRows] = useState<WhitelistRow[]>([]);
  const [stats, setStats] = useState({ total: 0, enabled: 0, disabled: 0, top8: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>('all');

  const [addForm, setAddForm] = useState({
    symbol: '',
    manual_priority: 0,
    is_top8: false,
    is_enabled: true,
    notes: '',
  });
  const [addSaving, setAddSaving] = useState(false);

  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    text: '',
    manual_priority: 0,
    is_top8: false,
    is_enabled: true,
    notes: '',
  });

  const [notesEditor, setNotesEditor] = useState<{ symbol: string; notes: string }>({ symbol: '', notes: '' });
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);

  const limit = 200;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfo(null);

    const params = new URLSearchParams();
    if (activeQuery) params.set('q', activeQuery);
    if (enabledFilter === 'enabled') params.set('enabled', 'true');
    if (enabledFilter === 'disabled') params.set('enabled', 'false');
    params.set('limit', String(limit));

    try {
      const res = await fetch(`/api/admin/whitelist?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load whitelist (${res.status})`);
      }
      const data: WhitelistResponse = await res.json();
      setRows(data.rows ?? []);
      setStats({
        total: data.total ?? 0,
        enabled: data.enabled ?? 0,
        disabled: data.disabled ?? 0,
        top8: data.top8 ?? 0,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeQuery, enabledFilter, limit]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const summaryCards = useMemo(
    () => [
      { label: 'Enabled', value: stats.enabled, icon: CheckCircle2, color: 'text-emerald-600' },
      { label: 'Disabled', value: stats.disabled, icon: XCircle, color: 'text-amber-600' },
      { label: 'Top 8', value: stats.top8, icon: StarIcon, color: 'text-indigo-600' },
      { label: 'Total', value: stats.total, icon: DatabaseIcon, color: 'text-slate-600' },
    ],
    [stats],
  );

  async function handleAction(action: string, payload: Record<string, unknown>, successMessage?: string) {
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/admin/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      if (successMessage) setInfo(successMessage);
      await loadData();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  async function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.symbol.trim()) {
      setError('Symbol is required');
      return;
    }
    setAddSaving(true);
    const success = await handleAction('upsert', {
      symbol: addForm.symbol,
      manual_priority: addForm.manual_priority,
      is_top8: addForm.is_top8,
      is_enabled: addForm.is_enabled,
      notes: addForm.notes,
    }, 'Symbol saved');
    setAddSaving(false);
    if (success) {
      setAddForm({ symbol: '', manual_priority: 0, is_top8: false, is_enabled: true, notes: '' });
    }
  }

  async function handleBulkSubmit() {
    if (!bulkForm.text.trim()) {
      setError('Paste at least one symbol');
      return;
    }
    setBulkSaving(true);
    const success = await handleAction('bulk_upsert', {
      text: bulkForm.text,
      manual_priority: bulkForm.manual_priority,
      is_top8: bulkForm.is_top8,
      is_enabled: bulkForm.is_enabled,
      notes: bulkForm.notes,
    }, 'Bulk import complete');
    setBulkSaving(false);
    if (success) {
      setBulkForm({ text: '', manual_priority: 0, is_top8: false, is_enabled: true, notes: '' });
    }
  }

  async function handleNotesSave() {
    if (!notesEditor.symbol) return;
    setNotesSaving(true);
    const success = await handleAction('set_notes', {
      symbol: notesEditor.symbol,
      notes: notesEditor.notes,
    }, 'Notes updated');
    setNotesSaving(false);
    if (success) setNotesOpen(false);
  }

  function openNotesDialog(row: WhitelistRow) {
    setNotesEditor({ symbol: row.symbol, notes: row.notes ?? '' });
    setNotesOpen(true);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActiveQuery(searchInput.trim());
  }

  function resetSearch() {
    setSearchInput('');
    setActiveQuery('');
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Ticker Whitelist</h1>
        <p className="text-muted-foreground mt-1">Manage the canonical trading universe: enable symbols, flag Top 8, and adjust manual priority.</p>
      </div>

      {(error || info) && (
        <Alert variant={error ? 'destructive' : 'default'}>
          {error ? (
            <>
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </>
          ) : (
            <>
              <AlertTitle>Success</AlertTitle>
              <AlertDescription>{info}</AlertDescription>
            </>
          )}
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        {summaryCards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value.toLocaleString()}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Search and filter the whitelist.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex w-full items-center gap-2">
              <Input
                placeholder="Search symbol..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full"
              />
              <Button type="submit" variant="default">
                <Search className="mr-2 h-4 w-4" />
                Search
              </Button>
              {activeQuery && (
                <Button type="button" variant="ghost" onClick={resetSearch}>
                  Clear
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select
                className="rounded-md border px-3 py-2 text-sm"
                value={enabledFilter}
                onChange={(e) => setEnabledFilter(e.target.value as EnabledFilter)}
              >
                <option value="all">All</option>
                <option value="enabled">Enabled only</option>
                <option value="disabled">Disabled only</option>
              </select>
              <Button type="button" variant="outline" onClick={loadData}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Add or Update Symbol</CardTitle>
            <CardDescription>Quickly upsert a single ticker.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleAddSubmit}>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Symbol</label>
                <Input
                  placeholder="NVDA"
                  value={addForm.symbol}
                  onChange={(e) => setAddForm((form) => ({ ...form, symbol: e.target.value.toUpperCase() }))}
                />
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={addForm.is_enabled}
                    onChange={(e) => setAddForm((form) => ({ ...form, is_enabled: e.target.checked }))}
                  />
                  <span className="text-sm">Enabled</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={addForm.is_top8}
                    onChange={(e) => setAddForm((form) => ({ ...form, is_top8: e.target.checked }))}
                  />
                  <span className="text-sm">Top 8 slot</span>
                </div>
                <div className="grid gap-1">
                  <label className="text-xs text-muted-foreground">Manual priority (0-100)</label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={addForm.manual_priority}
                    onChange={(e) => setAddForm((form) => ({ ...form, manual_priority: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Notes</label>
                <Textarea
                  placeholder="Optional notes"
                  value={addForm.notes}
                  onChange={(e) => setAddForm((form) => ({ ...form, notes: e.target.value }))}
                />
              </div>
              <Button type="submit" disabled={addSaving}>
                <PlusCircle className="mr-2 h-4 w-4" />
                {addSaving ? 'Saving…' : 'Save symbol'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bulk Import</CardTitle>
            <CardDescription>Paste newline or comma-separated tickers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder="AAPL, MSFT, NVDA"
              value={bulkForm.text}
              onChange={(e) => setBulkForm((form) => ({ ...form, text: e.target.value }))}
              rows={5}
            />
            <div className="grid gap-3 md:grid-cols-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={bulkForm.is_enabled}
                  onChange={(e) => setBulkForm((form) => ({ ...form, is_enabled: e.target.checked }))}
                />
                <span className="text-sm">Enabled</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={bulkForm.is_top8}
                  onChange={(e) => setBulkForm((form) => ({ ...form, is_top8: e.target.checked }))}
                />
                <span className="text-sm">Top 8</span>
              </div>
              <div className="grid gap-1">
                <label className="text-xs text-muted-foreground">Manual priority</label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={bulkForm.manual_priority}
                  onChange={(e) => setBulkForm((form) => ({ ...form, manual_priority: Number(e.target.value) }))}
                />
              </div>
            </div>
            <Textarea
              placeholder="Optional notes applied to all symbols"
              value={bulkForm.notes}
              onChange={(e) => setBulkForm((form) => ({ ...form, notes: e.target.value }))}
              rows={3}
            />
            <Button type="button" onClick={handleBulkSubmit} disabled={bulkSaving}>
              <Upload className="mr-2 h-4 w-4" />
              {bulkSaving ? 'Importing…' : 'Import symbols'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Whitelist</CardTitle>
          <CardDescription>{loading ? 'Loading latest data…' : `${rows.length.toLocaleString()} rows loaded`}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border rounded-md overflow-x-auto">
            <Table className="text-sm">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Symbol</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                      {loading ? 'Loading whitelist…' : 'No rows match the filters.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.symbol}>
                      <TableCell className="font-semibold">
                        <div className="flex items-center gap-2">
                          {row.symbol}
                          {row.is_top8 && <Badge variant="secondary">Top 8</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.is_enabled ? (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700">
                            Enabled
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700">
                            Disabled
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            defaultValue={row.manual_priority}
                            className="w-20"
                            onBlur={(e) => {
                              const next = Number(e.target.value);
                              if (!Number.isFinite(next) || next === row.manual_priority) return;
                              handleAction('set_priority', { symbol: row.symbol, manual_priority: next });
                            }}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="line-clamp-2 text-muted-foreground">
                            {row.notes ? truncate(row.notes, 60) : '—'}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs"
                            onClick={() => openNotesDialog(row)}
                          >
                            <StickyNote className="mr-1 h-4 w-4" />
                            Edit
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.updated_at ? new Date(row.updated_at).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAction('set_enabled', { symbol: row.symbol, is_enabled: !row.is_enabled })}
                        >
                          {row.is_enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAction('set_top8', { symbol: row.symbol, is_top8: !row.is_top8 })}
                        >
                          {row.is_top8 ? 'Unset Top 8' : 'Set Top 8'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-600"
                          onClick={() => {
                            if (confirm(`Delete ${row.symbol} from whitelist?`)) {
                              handleAction('delete', { symbol: row.symbol }, 'Symbol deleted');
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={notesOpen} onOpenChange={setNotesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit notes — {notesEditor.symbol}</DialogTitle>
            <DialogDescription>Store optional context or reminders for this ticker.</DialogDescription>
          </DialogHeader>
          <Textarea
            value={notesEditor.notes}
            onChange={(e) => setNotesEditor((prev) => ({ ...prev, notes: e.target.value }))}
            rows={6}
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNotesOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleNotesSave} disabled={notesSaving}>
              <Edit3 className="mr-2 h-4 w-4" />
              {notesSaving ? 'Saving…' : 'Save notes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function truncate(value: string, max = 60) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function StarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2.25l2.92 6.07 6.7.97-4.84 4.72 1.14 6.66L12 17.77l-5.92 3.14 1.14-6.66-4.84-4.72 6.7-.97L12 2.25z" />
    </svg>
  );
}

function DatabaseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <ellipse cx="12" cy="6" rx="7" ry="3" strokeWidth="1.5" />
      <path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" strokeWidth="1.5" />
      <path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" strokeWidth="1.5" />
    </svg>
  );
}
