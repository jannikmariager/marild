'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TradingStyleSelector, type TradingStyle } from '@/components/tradesignal/trading-style-selector';
import { createClient } from '@/lib/supabaseBrowser';
import { toast } from 'sonner';

export function TradingPreferences() {
  const [defaultTradingStyle, setDefaultTradingStyle] = useState<TradingStyle>('swing');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        const { data: profile } = await supabase
          .from('user_profile')
          .select('trading_style')
          .eq('user_id', user.id)
          .single();
          
        if (profile?.trading_style) {
          setDefaultTradingStyle(profile.trading_style as TradingStyle);
        }
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveTradingStyle() {
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        const { error } = await supabase
          .from('user_profile')
          .update({ trading_style: defaultTradingStyle })
          .eq('user_id', user.id);
          
        if (error) {
          toast.error('Failed to update trading style');
        } else {
          toast.success('Default trading style updated');
        }
      }
    } catch (error) {
      console.error('Error saving trading style:', error);
      toast.error('Failed to update trading style');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Loading preferences...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trading Preferences</CardTitle>
        <CardDescription>
          Set your default trading style for signal generation
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Default Trading Style</label>
            <TradingStyleSelector
              value={defaultTradingStyle}
              onChange={setDefaultTradingStyle}
            />
            <p className="text-xs text-muted-foreground">
              This will be your default when requesting new signals. You can override it per request.
            </p>
          </div>
          <Button onClick={handleSaveTradingStyle} disabled={saving}>
            {saving ? 'Saving...' : 'Save Preferences'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
