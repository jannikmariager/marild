import { Topbar } from '@/components/layout/topbar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/auth';
import { ManageSubscriptionButton } from '@/components/account/manage-subscription-button';
import { getDevModeLabel } from '@/lib/subscription/devOverride';
import { Badge } from '@/components/ui/badge';

export default async function AccountPage() {
  const user = await getCurrentUser();
  const devModeLabel = getDevModeLabel();


  return (
    <div>
      <Topbar title="Account" />
      <div className="p-6">
        <div className="max-w-2xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account Information</CardTitle>
              <CardDescription>Your subscription and profile details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {devModeLabel && (
                <div className="p-3 rounded-md bg-orange-50 border border-orange-200">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className="bg-orange-500">{devModeLabel}</Badge>
                    <p className="text-sm font-medium">Development Mode Active</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    All PRO features are unlocked. This mode is only active in development.
                  </p>
                </div>
              )}
              <div>
                <p className="text-sm font-medium">Email</p>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
              </div>
              <div>
                <p className="text-sm font-medium">Subscription Tier</p>
                <p className="text-sm text-muted-foreground uppercase">{user?.subscription_tier}</p>
              </div>
              <div>
                <p className="text-sm font-medium">Country</p>
                <p className="text-sm text-muted-foreground">{user?.country || 'Not set'}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Manage Subscription</CardTitle>
              <CardDescription>Update billing details and subscription plan</CardDescription>
            </CardHeader>
            <CardContent>
              <ManageSubscriptionButton />
              <p className="text-xs text-muted-foreground mt-2">
                You will be redirected to the Stripe billing portal
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
