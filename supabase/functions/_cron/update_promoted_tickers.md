# Promoted Tickers Update Cron Job

## Schedule
Runs **weekly on Sundays at 00:00 UTC** to update the promoted tickers list for V2.

## Cron Expression
```
0 0 * * 0
```

## Function
`update_promoted_tickers`

## Setup in Supabase

### Via Dashboard:
1. Go to Supabase Dashboard → Edge Functions
2. Click on `update_promoted_tickers`
3. Add cron trigger: `0 0 * * 0`

### Via CLI:
```bash
supabase functions deploy update_promoted_tickers
```

Then add to `supabase/functions/cron.yml` (if using pg_cron):
```yaml
- name: update_promoted_tickers_weekly
  schedule: '0 0 * * 0'  # Every Sunday at midnight UTC
  function: update_promoted_tickers
```

## Behavior

### Phase 1: Manual List (First 2-4 weeks)
- **Condition**: V2 has < 50 trades
- **Action**: Keeps the manual seed list of 20 tickers
- **Returns**: `auto_promotion_enabled: false`

### Phase 2: Auto-Promotion (After 50+ trades)
- **Condition**: V2 has ≥ 50 trades
- **Action**: Analyzes V2 performance and promotes top 20 tickers based on:
  - 30% Average AI confidence score (last 30 days)
  - 30% Win rate from V2 shadow trades
  - 25% Average R-multiple from V2 shadow trades
  - 15% Signal frequency (capped at 20 signals)
- **Filters**:
  - Minimum 3 signals per ticker
  - Minimum 45% win rate
  - Blacklist excluded
- **Returns**: `auto_promotion_enabled: true` + top ticker list

## Manual Trigger

To manually update promoted tickers:

```bash
curl -X POST https://your-project.supabase.co/functions/v1/update_promoted_tickers \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

Or via Supabase dashboard: Functions → update_promoted_tickers → Invoke

## Monitoring

Check logs after each run:
```bash
supabase functions logs update_promoted_tickers
```

Look for:
- `✅ Promoted tickers updated successfully`
- List of top 20 tickers with scores
- Auto-promotion status

## Blacklist

To exclude problem tickers, edit the function and add to `BLACKLIST`:

```typescript
const BLACKLIST = new Set([
  "PROBLEMATIC_TICKER",
  "ANOTHER_BAD_ONE"
]);
```

Then redeploy:
```bash
supabase functions deploy update_promoted_tickers
```
