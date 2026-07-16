-- DTR GPS geofence.
--
-- Staff punches (clock_in / clock_out) are only accepted within radius_m of
-- an active row in dtr_locations; outside the fence the punch is BLOCKED and
-- the message directs staff to the time-correction flow (0007) for legit
-- field work. Enforcement is ON iff at least one active location exists —
-- an empty/inactive table is the kill switch.
--
-- Honesty note: coordinates come from the browser Geolocation API and are
-- client-supplied — a determined user can spoof them. This is a deterrent
-- and an audit trail, not cryptographic proof of presence.

-- ──────────────────────────────────────────────────────────────
-- Office locations (owner-managed, same pattern as holidays)
-- ──────────────────────────────────────────────────────────────
create table public.dtr_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_m integer not null default 150 check (radius_m between 25 and 5000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.dtr_locations enable row level security;

-- everyone active reads (the clock card needs to know if the fence is on),
-- owner writes directly (same as holidays)
create policy dtr_locations_select on public.dtr_locations
  for select using (public.is_active_user());
create policy dtr_locations_insert on public.dtr_locations
  for insert with check (public.is_owner());
create policy dtr_locations_update on public.dtr_locations
  for update using (public.is_owner());
create policy dtr_locations_delete on public.dtr_locations
  for delete using (public.is_owner());

-- ──────────────────────────────────────────────────────────────
-- Punch coordinates on time_records (audit trail; null for
-- owner-entered records and pre-geofence punches)
-- ──────────────────────────────────────────────────────────────
alter table public.time_records
  add column in_lat double precision,
  add column in_lng double precision,
  add column in_accuracy_m double precision,
  add column out_lat double precision,
  add column out_lng double precision,
  add column out_accuracy_m double precision;

-- ──────────────────────────────────────────────────────────────
-- Haversine distance in meters (sphere, R = 6371 km — good to
-- ~0.5%, irrelevant at fence scale)
-- ──────────────────────────────────────────────────────────────
create or replace function public.distance_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql immutable
as $$
  select 2 * 6371000.0 * asin(least(1.0, sqrt(
    pow(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2))
      * pow(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$;

-- ──────────────────────────────────────────────────────────────
-- Geofence gate: no-op when no active location exists; otherwise
-- raises unless within radius + capped GPS-accuracy slack of the
-- nearest active location. Slack helps honest users with poor GPS;
-- spoofers fake the coords themselves, so it costs nothing.
-- ──────────────────────────────────────────────────────────────
create or replace function public.check_dtr_geofence(
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision,
  p_action text          -- 'clock in' | 'clock out', for messages
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_name text;
  v_radius int;
  v_dist double precision;
  v_slack double precision :=
    least(greatest(coalesce(p_accuracy_m, 0), 0), 100);
begin
  if not exists (select 1 from public.dtr_locations where active) then
    return;  -- geofence off
  end if;

  if p_lat is null or p_lng is null then
    raise exception
      'Your location is needed to %. Allow location access for this site and try again.',
      p_action;
  end if;

  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Invalid location reading — please try again.';
  end if;

  select l.name, l.radius_m, public.distance_m(p_lat, p_lng, l.lat, l.lng)
  into v_name, v_radius, v_dist
  from public.dtr_locations l
  where l.active
  order by public.distance_m(p_lat, p_lng, l.lat, l.lng)
  limit 1;

  if v_dist > v_radius + v_slack then
    raise exception
      'You appear to be about % from % — you can only % at the store. On a delivery or field work? File a time correction request for today instead.',
      case when v_dist >= 1000
           then round((v_dist / 1000)::numeric, 1)::text || ' km'
           else round(v_dist)::int::text || ' m' end,
      v_name, p_action;
  end if;
end;
$$;

-- Internal helper: keep it off the PostgREST API surface so the fence
-- can't be probed (clock_in/clock_out run as the function owner, who
-- always retains execute).
revoke execute on function
  public.check_dtr_geofence(double precision, double precision, double precision, text)
  from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────
-- clock_in / clock_out with optional coordinates.
-- The zero-arg versions MUST be dropped first: CREATE OR REPLACE
-- with a new signature would create an overload and PostgREST
-- rpc("clock_in") calls would become ambiguous. All params default
-- to null, so an old frontend's empty-body call still resolves.
-- ──────────────────────────────────────────────────────────────
drop function if exists public.clock_in();

create function public.clock_in(
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null
)
returns public.time_records
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.time_records;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized';
  end if;

  perform public.check_dtr_geofence(p_lat, p_lng, p_accuracy_m, 'clock in');

  insert into public.time_records
    (profile_id, work_date, time_in, created_by, in_lat, in_lng, in_accuracy_m)
  values (
    auth.uid(),
    public.ph_today(),
    date_trunc('minute', now() at time zone 'Asia/Manila')::time,
    auth.uid(),
    p_lat, p_lng, p_accuracy_m
  )
  returning * into v_row;

  return v_row;
exception when unique_violation then
  raise exception 'Already clocked in today';
end;
$$;

drop function if exists public.clock_out();

create function public.clock_out(
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m double precision default null
)
returns public.time_records
language plpgsql
security definer set search_path = public
as $$
declare
  v_out time := date_trunc('minute', now() at time zone 'Asia/Manila')::time;
  v_row public.time_records;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized';
  end if;

  perform public.check_dtr_geofence(p_lat, p_lng, p_accuracy_m, 'clock out');

  select * into v_row from public.time_records
  where profile_id = auth.uid()
    and work_date = public.ph_today()
    and time_out is null;

  if not found then
    raise exception 'Not clocked in today (or already clocked out)';
  end if;

  if v_out <= v_row.time_in then
    raise exception 'Clock out must be after clock in — wait a minute and try again';
  end if;

  update public.time_records
  set time_out = v_out,
      out_lat = p_lat,
      out_lng = p_lng,
      out_accuracy_m = p_accuracy_m
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;
