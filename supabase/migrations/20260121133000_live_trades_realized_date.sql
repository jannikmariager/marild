alter table public.live_trades
  add column if not exists realized_pnl_date date;

update public.live_trades
set realized_pnl_date = date(exit_timestamp)
where exit_timestamp is not null
  and realized_pnl_dollars is not null
  and realized_pnl_date is null;

alter table public.live_trades
  drop constraint if exists live_trades_realized_pnl_requires_close,
  drop constraint if exists live_trades_realized_date_requires_close;

alter table public.live_trades
  add constraint live_trades_realized_pnl_requires_close
    check (exit_timestamp is not null or realized_pnl_dollars is null),
  add constraint live_trades_realized_date_requires_close
    check (exit_timestamp is not null or realized_pnl_date is null);

create or replace function public.live_trades_realized_guard()
returns trigger as $$
begin
  if NEW.exit_timestamp is null then
    NEW.realized_pnl_date := null;
    if NEW.realized_pnl_dollars is not null then
      raise exception 'Cannot set realized P&L on an open trade';
    end if;
  else
    if NEW.realized_pnl_date is null then
      NEW.realized_pnl_date := date(NEW.exit_timestamp);
    end if;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists live_trades_realized_guard on public.live_trades;
create trigger live_trades_realized_guard
before insert or update on public.live_trades
for each row execute function public.live_trades_realized_guard();
