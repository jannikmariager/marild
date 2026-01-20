-- Recent job run statuses with error counts
select job_name,
       started_at,
       ok,
       error,
       counts
from job_run_log
order by started_at desc
limit 20;

-- Focused report for signal generation runs
select started_at,
       ok,
       counts,
       error
from job_run_log
where job_name = 'signals_generate_1h'
order by started_at desc
limit 10;
