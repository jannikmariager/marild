'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createClient } from '@/lib/supabaseBrowser';

export function SettingsForm() {
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [defaultTimeframe, setDefaultTimeframe] = useState('1H');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('user_profile')
      .select('notification_frequency')
      .eq('user_id', user.id)
      .single();

    if (error) {
      console.error('Error loading settings:', error);
    } else if (data) {
      // Map notification_frequency to email settings
      if (data.notification_frequency) {
        setEmailNotifications(data.notification_frequency !== 'never');
      }
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      alert('You must be logged in');
      setSaving(false);
      return;
    }

    // Map settings to notification_frequency
    let notificationFreq = 'never';
    if (emailNotifications && pushNotifications) {
      notificationFreq = 'daily';
    } else if (emailNotifications) {
      notificationFreq = 'few_per_week';
    } else if (pushNotifications) {
      notificationFreq = 'important_only';
    }

    const { error } = await supabase
      .from('user_profile')
      .update({ notification_frequency: notificationFreq })
      .eq('user_id', user.id);

    if (error) {
      console.error('Error saving settings:', error);
      alert('Failed to save settings');
    } else {
      alert('Settings saved successfully!');
    }

    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>Manage how you receive alerts and updates</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Email Notifications</Label>
              <p className="text-sm text-muted-foreground">
                Receive TradeSignal alerts via email
              </p>
            </div>
            <Switch
              checked={emailNotifications}
              onCheckedChange={setEmailNotifications}
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Push Notifications</Label>
              <p className="text-sm text-muted-foreground">
                Get real-time alerts in your browser
              </p>
            </div>
            <Switch
              checked={pushNotifications}
              onCheckedChange={setPushNotifications}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Customize your experience</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Dark Mode</Label>
              <p className="text-sm text-muted-foreground">
                Use dark theme across the app
              </p>
            </div>
            <Switch
              checked={darkMode}
              onCheckedChange={setDarkMode}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trading Preferences</CardTitle>
          <CardDescription>Set your default trading parameters</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Default Timeframe</Label>
            <Select value={defaultTimeframe} onValueChange={setDefaultTimeframe}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15m">15 Minutes</SelectItem>
                <SelectItem value="1H">1 Hour</SelectItem>
                <SelectItem value="4H">4 Hours</SelectItem>
                <SelectItem value="1D">1 Day</SelectItem>
                <SelectItem value="1W">1 Week</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Used when requesting new TradeSignals
            </p>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} className="w-full" disabled={saving || loading}>
        {saving ? 'Saving...' : 'Save Settings'}
      </Button>
    </div>
  );
}
