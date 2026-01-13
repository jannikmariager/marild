import Stripe from 'stripe';
import { createClient } from './supabase/server';

// Initialize Stripe with secret key from environment
// Use a dummy key for build time if not available
const stripeKey = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy_key_for_build';
const stripe = new Stripe(stripeKey, {
  apiVersion: '2025-11-17.clover',
});

export interface RevenueMetrics {
  mrr: number;
  arr: number;
  activeSubscriptions: number;
  churnRate: number;
  lifetimeValue: number;
  revenueGrowth: number;
}

export interface SubscriptionBreakdown {
  plan: string;
  count: number;
  revenue: number;
}

export interface RevenueChartData {
  date: string;
  revenue: number;
  subscriptions: number;
}

/**
 * Calculate Monthly Recurring Revenue (MRR) from active subscriptions
 */
export async function calculateMRR(): Promise<number> {
  try {
    const subscriptions = await stripe.subscriptions.list({
      status: 'active',
      limit: 100,
    });

    let mrr = 0;
    for (const sub of subscriptions.data) {
      // Sum up all active subscription items
      for (const item of sub.items.data) {
        const amount = item.price.unit_amount || 0;
        const quantity = item.quantity || 1;
        
        // Convert to monthly amount based on interval
        if (item.price.recurring?.interval === 'month') {
          mrr += (amount / 100) * quantity;
        } else if (item.price.recurring?.interval === 'year') {
          mrr += (amount / 100 / 12) * quantity;
        }
      }
    }

    return Math.round(mrr * 100) / 100;
  } catch (error) {
    console.error('Error calculating MRR:', error);
    return 0;
  }
}

/**
 * Calculate Annual Recurring Revenue (ARR)
 */
export async function calculateARR(): Promise<number> {
  const mrr = await calculateMRR();
  return Math.round(mrr * 12 * 100) / 100;
}

/**
 * Get active subscription count
 */
export async function getActiveSubscriptionCount(): Promise<number> {
  try {
    const subscriptions = await stripe.subscriptions.list({
      status: 'active',
      limit: 1,
    });
    return subscriptions.data.length > 0 ? subscriptions.data[0].id ? await stripe.subscriptions.list({ status: 'active' }).then(s => s.data.length) : 0 : 0;
  } catch (error) {
    console.error('Error getting subscription count:', error);
    return 0;
  }
}

/**
 * Calculate churn rate (last 30 days)
 */
export async function calculateChurnRate(): Promise<number> {
  try {
    const supabase = await createClient();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get churned subscriptions from subscription_logs
    const { data: churnedSubs, error: churnError } = await supabase
      .from('subscription_logs')
      .select('id')
      .eq('event_type', 'subscription.deleted')
      .gte('timestamp', thirtyDaysAgo.toISOString());

    if (churnError) {
      console.error('Error fetching churned subscriptions:', churnError.message || churnError);
      return 0;
    }

    // Get total active subscriptions at start of period
    const { data: totalSubs, error: totalError } = await supabase
      .from('subscription_logs')
      .select('id')
      .eq('event_type', 'subscription.created')
      .lte('timestamp', thirtyDaysAgo.toISOString());

    if (totalError) {
      console.error('Error fetching total subscriptions:', totalError.message || totalError);
      return 0;
    }

    const churned = churnedSubs?.length || 0;
    const total = totalSubs?.length || 1; // Avoid division by zero

    return Math.round((churned / total) * 100 * 100) / 100;
  } catch (error) {
    console.error('Error calculating churn rate:', error instanceof Error ? error.message : String(error));
    return 0;
  }
}

/**
 * Calculate average Lifetime Value (LTV)
 */
export async function calculateLTV(): Promise<number> {
  try {
    const mrr = await calculateMRR();
    const churnRate = await calculateChurnRate();
    
    if (churnRate === 0) return 0;

    // LTV = ARPU / Churn Rate
    const activeCount = await getActiveSubscriptionCount();
    const arpu = activeCount > 0 ? mrr / activeCount : 0;
    const ltv = arpu / (churnRate / 100);

    return Math.round(ltv * 100) / 100;
  } catch (error) {
    console.error('Error calculating LTV:', error);
    return 0;
  }
}

/**
 * Calculate revenue growth (MoM percentage)
 */
export async function calculateRevenueGrowth(): Promise<number> {
  try {
    const supabase = await createClient();
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // Get current month revenue
    const { data: currentRevenue } = await supabase
      .from('subscription_logs')
      .select('amount_usd')
      .gte('timestamp', currentMonthStart.toISOString())
      .in('event_type', ['payment_intent.succeeded', 'invoice.payment_succeeded']);

    // Get last month revenue
    const { data: lastRevenue } = await supabase
      .from('subscription_logs')
      .select('amount_usd')
      .gte('timestamp', lastMonthStart.toISOString())
      .lte('timestamp', lastMonthEnd.toISOString())
      .in('event_type', ['payment_intent.succeeded', 'invoice.payment_succeeded']);

    const currentTotal = currentRevenue?.reduce((sum, log) => sum + (log.amount_usd || 0), 0) || 0;
    const lastTotal = lastRevenue?.reduce((sum, log) => sum + (log.amount_usd || 0), 0) || 1;

    const growth = ((currentTotal - lastTotal) / lastTotal) * 100;
    return Math.round(growth * 100) / 100;
  } catch (error) {
    console.error('Error calculating revenue growth:', error);
    return 0;
  }
}

/**
 * Get all revenue metrics
 */
export async function getRevenueMetrics(): Promise<RevenueMetrics> {
  const [mrr, arr, activeSubscriptions, churnRate, lifetimeValue, revenueGrowth] = await Promise.all([
    calculateMRR(),
    calculateARR(),
    getActiveSubscriptionCount(),
    calculateChurnRate(),
    calculateLTV(),
    calculateRevenueGrowth(),
  ]);

  return {
    mrr,
    arr,
    activeSubscriptions,
    churnRate,
    lifetimeValue,
    revenueGrowth,
  };
}

/**
 * Get subscription breakdown by plan
 */
export async function getSubscriptionBreakdown(): Promise<SubscriptionBreakdown[]> {
  try {
    const subscriptions = await stripe.subscriptions.list({
      status: 'active',
      limit: 100,
    });

    const breakdown = new Map<string, { count: number; revenue: number }>();

    for (const sub of subscriptions.data) {
      for (const item of sub.items.data) {
        const planName = item.price.nickname || item.price.id;
        const amount = (item.price.unit_amount || 0) / 100;
        const quantity = item.quantity || 1;

        // Convert to monthly revenue
        let monthlyRevenue = amount * quantity;
        if (item.price.recurring?.interval === 'year') {
          monthlyRevenue = monthlyRevenue / 12;
        }

        const existing = breakdown.get(planName) || { count: 0, revenue: 0 };
        breakdown.set(planName, {
          count: existing.count + quantity,
          revenue: existing.revenue + monthlyRevenue,
        });
      }
    }

    return Array.from(breakdown.entries()).map(([plan, data]) => ({
      plan,
      count: data.count,
      revenue: Math.round(data.revenue * 100) / 100,
    }));
  } catch (error) {
    console.error('Error getting subscription breakdown:', error);
    return [];
  }
}

/**
 * Get revenue chart data for the last 12 months
 */
export async function getRevenueChartData(): Promise<RevenueChartData[]> {
  try {
    const supabase = await createClient();
    const data: RevenueChartData[] = [];

    for (let i = 11; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

      // Get revenue for this month
      const { data: payments } = await supabase
        .from('subscription_logs')
        .select('amount_usd')
        .gte('timestamp', monthStart.toISOString())
        .lte('timestamp', monthEnd.toISOString())
        .in('event_type', ['payment_intent.succeeded', 'invoice.payment_succeeded']);

      // Get subscription count for this month
      const { data: subs } = await supabase
        .from('subscription_logs')
        .select('id')
        .gte('timestamp', monthStart.toISOString())
        .lte('timestamp', monthEnd.toISOString())
        .eq('event_type', 'subscription.created');

      const revenue = payments?.reduce((sum, log) => sum + (log.amount_usd || 0), 0) || 0;
      const subscriptions = subs?.length || 0;

      data.push({
        date: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        revenue: Math.round(revenue * 100) / 100, // amount_usd is already in dollars
        subscriptions,
      });
    }

    return data;
  } catch (error) {
    console.error('Error getting revenue chart data:', error);
    return [];
  }
}

/**
 * Get failed payments in the last 30 days
 */
export async function getFailedPayments(): Promise<Array<{
  id: string;
  customer: string;
  amount: number;
  reason: string;
  created: number;
}>> {
  try {
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
    
    const charges = await stripe.charges.list({
      created: { gte: thirtyDaysAgo },
      limit: 100,
    });

    return charges.data
      .filter(charge => charge.status === 'failed')
      .map(charge => ({
        id: charge.id,
        customer: charge.customer as string || 'Unknown',
        amount: charge.amount / 100,
        reason: charge.failure_message || 'Unknown',
        created: charge.created,
      }));
  } catch (error) {
    console.error('Error getting failed payments:', error);
    return [];
  }
}

export { stripe };
