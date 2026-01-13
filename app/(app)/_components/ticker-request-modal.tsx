'use client';

import { useState } from 'react';
import { AlertCircle, Send, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useUser } from '@/components/providers/user-provider';
import { useIsPro } from '@/hooks/useIsPro';
import { createClient } from '@/lib/supabaseBrowser';
import { trackEvent } from '@/lib/analytics';
import { toast } from 'sonner';
import type { TickerRequestSource, TickerRequestMode } from '@/types/ticker-request';

interface TickerRequestModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTicker: string;
  source: TickerRequestSource;
  mode?: TickerRequestMode;
}

export function TickerRequestModal({
  open,
  onOpenChange,
  initialTicker,
  source,
  mode,
}: TickerRequestModalProps) {
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  
  const user = useUser();
  const isPro = useIsPro();
  const supabase = createClient();

  // PRO-gating check when modal opens
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen && !isPro) {
      trackEvent('ticker_request_upgrade_required', {
        ticker: initialTicker,
        source,
        mode,
      });
      setShowUpgradeDialog(true);
      return;
    }

    if (newOpen) {
      trackEvent('ticker_request_opened', {
        ticker: initialTicker,
        source,
        mode,
      });
    }

    onOpenChange(newOpen);
  };

  const handleSubmit = async () => {
    if (!user) {
      toast.error('You must be logged in to request tickers');
      return;
    }

    if (!isPro) {
      setShowUpgradeDialog(true);
      return;
    }

    setIsSubmitting(true);

    try {
      const context = {
        mode,
        notes: notes.trim() || undefined,
      };

      const { data, error } = await supabase.rpc('request_ticker', {
        _ticker: initialTicker.toUpperCase(),
        _user_id: user.id,
        _source: source,
        _context: context,
      });

      if (error) throw error;

      trackEvent('ticker_request_submitted', {
        ticker: initialTicker,
        source,
        mode,
        request_count: data?.request_count,
      });

      toast.success(`Thanks! We’ve recorded your request for ${initialTicker.toUpperCase()}.`);
      
      // Reset and close
      setNotes('');
      onOpenChange(false);
    } catch (error) {
      console.error('Error submitting ticker request:', error);
      
      trackEvent('ticker_request_failed', {
        ticker: initialTicker,
        source,
        mode,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      toast.error('Error submitting request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Upgrade Dialog
  if (showUpgradeDialog) {
    return (
      <Dialog open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-500/10">
                <Sparkles className="h-5 w-5 text-amber-500" />
              </div>
              <DialogTitle>Upgrade to PRO</DialogTitle>
            </div>
            <DialogDescription>
              Ticker requests are a PRO feature. Upgrade to request new tickers and help shape the Marild AI platform.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-start">
            <Button
              variant="default"
              onClick={() => {
                // TODO: Navigate to pricing/upgrade page
                window.location.href = '/pricing';
              }}
            >
              View PRO Plans
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowUpgradeDialog(false)}
            >
              Maybe Later
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Main Request Modal
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Send className="h-5 w-5 text-primary" />
            </div>
            <DialogTitle>Request Ticker</DialogTitle>
          </div>
          <DialogDescription>
            Help us prioritize new ticker additions. We’ll notify you when {initialTicker.toUpperCase()} becomes available.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Ticker Display */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Ticker
            </label>
            <div className="px-3 py-2 rounded-lg border bg-muted/50 font-mono text-lg font-semibold">
              {initialTicker.toUpperCase()}
            </div>
          </div>

          {/* Mode Display (if provided) */}
          {mode && mode !== 'mixed' && (
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
                Trading Mode
              </label>
              <div className="px-3 py-2 rounded-lg border bg-muted/50 text-sm">
                {mode}
              </div>
            </div>
          )}

          {/* Optional Notes */}
          <div>
            <label htmlFor="notes" className="text-sm font-medium text-muted-foreground mb-1.5 block">
              Additional Notes (Optional)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any specific requirements or use cases?"
              className="w-full px-3 py-2 rounded-lg border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground mt-1">
              {notes.length}/500 characters
            </p>
          </div>

          {/* Info Notice */}
          <div className="flex gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <AlertCircle className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Your request will be reviewed by our team. Frequently requested tickers are prioritized for addition.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                Submitting...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Submit Request
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
