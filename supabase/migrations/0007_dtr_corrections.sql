-- DTR correction requests: staff can't edit their own punches (clock times
-- stay trustworthy) — instead they file a request with a reason, and the
-- owner approves (which applies the times to time_records) or rejects.

create table public.time_correction_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id),
  work_date date not null,
  requested_time_in time not null,
  requested_time_out time,
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint req_out_after_in
    check (requested_time_out is null or requested_time_out > requested_time_in)
);

-- One open request per person per day
create unique index one_pending_request_per_day
  on public.time_correction_requests (profile_id, work_date)
  where status = 'pending';

drop trigger if exists touch_time_correction_requests on public.time_correction_requests;
create trigger touch_time_correction_requests
  before update on public.time_correction_requests
  for each row execute function public.touch_updated_at();
drop trigger if exists audit_time_correction_requests on public.time_correction_requests;
create trigger audit_time_correction_requests
  after update on public.time_correction_requests
  for each row execute function public.audit_row_changes();

-- ──────────────────────────────────────────────────────────────
-- Write entry points
-- ──────────────────────────────────────────────────────────────
create or replace function public.request_time_correction(
  p_work_date date,
  p_time_in time,
  p_time_out time default null,
  p_reason text default null
)
returns public.time_correction_requests
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.time_correction_requests;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized';
  end if;

  if p_work_date > public.ph_today() then
    raise exception 'Cannot request a fix for a future date';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required';
  end if;

  if p_time_out is not null and p_time_out <= p_time_in then
    raise exception 'Time out must be after time in';
  end if;

  insert into public.time_correction_requests
    (profile_id, work_date, requested_time_in, requested_time_out, reason)
  values (auth.uid(), p_work_date, p_time_in, p_time_out, trim(p_reason))
  returning * into v_row;

  return v_row;
exception when unique_violation then
  raise exception 'You already have a pending request for this day';
end;
$$;

create or replace function public.cancel_time_correction(p_request_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_active_user() then
    raise exception 'Not authorized';
  end if;

  delete from public.time_correction_requests
  where id = p_request_id
    and profile_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'Request not found or already resolved';
  end if;
end;
$$;

-- Approving applies the requested times to the day's record (creating it if
-- it doesn't exist) with the request reason as the record note.
create or replace function public.resolve_time_correction(
  p_request_id uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_req public.time_correction_requests;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can resolve correction requests';
  end if;

  select * into v_req from public.time_correction_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Request not found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'Request already resolved';
  end if;

  if p_approve then
    insert into public.time_records
      (profile_id, work_date, time_in, time_out, note, created_by)
    values
      (v_req.profile_id, v_req.work_date, v_req.requested_time_in,
       v_req.requested_time_out, v_req.reason, auth.uid())
    on conflict (profile_id, work_date) do update
    set time_in = excluded.time_in,
        time_out = excluded.time_out,
        note = excluded.note;
  end if;

  update public.time_correction_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      resolved_by = auth.uid(),
      resolved_at = now()
  where id = p_request_id;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- Row Level Security
-- ──────────────────────────────────────────────────────────────
alter table public.time_correction_requests enable row level security;

-- staff read their own requests, owner reads all; writes only via the
-- security definer functions above
create policy time_correction_requests_select on public.time_correction_requests
  for select using (
    public.is_active_user() and (profile_id = auth.uid() or public.is_owner())
  );
