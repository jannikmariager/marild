"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TradesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  label: string;
  trades: any[];
}

export function TradesModal({ open, onOpenChange, symbol, label, trades }: TradesModalProps) {
  const normalized = (trades || []).map((t) => {
    const tsRaw =
      t.entryTime ??
      t.entry_time ??
      t.timestamp ??
      t.t ??
      null;

    const ts = tsRaw ? new Date(tsRaw).getTime() : NaN;

    const directionRaw = (t.direction ?? t.side ?? "").toString().toUpperCase();
    const direction = directionRaw.includes("SHORT") ? "SHORT" : "LONG";

    const entry = Number(t.entryPrice ?? t.entry_price ?? 0);
    const exit = Number(t.exitPrice ?? t.exit_price ?? 0);
    const r = Number(
      t.rMultiple ??
      t.r_multiple ??
      t.r ??
      0,
    );

    return {
      ts,
      direction,
      entry,
      exit,
      r,
    };
  }).filter((row) => Number.isFinite(row.ts));

  normalized.sort((a, b) => a.ts - b.ts);

  const formatter = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "-");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-full max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Trades – {symbol} – {label}
          </DialogTitle>
        </DialogHeader>

        {normalized.length === 0 ? (
          <div className="py-8 text-sm text-muted-foreground text-center">
            No trades recorded for this configuration.
          </div>
        ) : (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Timestamp</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Direction</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Entry</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Exit</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">R multiple</th>
                </tr>
              </thead>
              <tbody>
                {normalized.map((row, idx) => (
                  <tr key={idx} className="border-b last:border-0">
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(row.ts).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      <span className={row.direction === "LONG" ? "text-emerald-600" : "text-red-600"}>
                        {row.direction}
                      </span>
                    </td>
                    <td className="px-3 py-2">${formatter(row.entry)}</td>
                    <td className="px-3 py-2">${formatter(row.exit)}</td>
                    <td className="px-3 py-2">{formatter(row.r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
