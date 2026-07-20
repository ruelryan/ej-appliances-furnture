-- E & J — Team tasks & collaboration (Phase 5)
-- Anyone can create a task and assign it to a person or a whole team (role),
-- optionally linked to a contract/customer, with a comment thread. In-app only.

-- ──────────────────────────────────────────────────────────────
-- 0. Helper: the caller's role (used by RLS + the nav badge)
-- ──────────────────────────────────────────────────────────────
create or replace function public.my_role()
returns text
language sql stable
security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active;
$$;

-- ──────────────────────────────────────────────────────────────
-- 1. Tasks
-- ──────────────────────────────────────────────────────────────
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  task_no text unique not null,                  -- 'TSK####'
  title text not null,
  body text,
  created_by uuid references public.profiles (id),
  assignee_id uuid references public.profiles (id),      -- a person
  assignee_role text check (assignee_role in (
    'owner', 'admin', 'collector', 'sales_agent', 'delivery'
  )),                                                    -- a team
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  due_date date,
  contract_id uuid references public.contracts (id),
  customer_id uuid references public.customers (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references public.profiles (id),
  -- exactly one assignee target (a person OR a team)
  constraint tasks_one_assignee check ((assignee_id is not null) <> (assignee_role is not null))
);

create index tasks_assignee_id on public.tasks (assignee_id);
create index tasks_assignee_role on public.tasks (assignee_role);
create index tasks_status on public.tasks (status);
create index tasks_contract on public.tasks (contract_id);

create trigger touch_tasks before update on public.tasks
  for each row execute function public.touch_updated_at();

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  body text not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index task_comments_task on public.task_comments (task_id);

-- ──────────────────────────────────────────────────────────────
-- 2. Shared visibility predicate (owner / creator / assignee / team member)
-- ──────────────────────────────────────────────────────────────
create or replace function public.can_see_task(p_task_id uuid)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id and (
      public.is_owner()
      or t.created_by = auth.uid()
      or t.assignee_id = auth.uid()
      or t.assignee_role = public.my_role()
    )
  );
$$;

-- ──────────────────────────────────────────────────────────────
-- 3. RPCs
-- ──────────────────────────────────────────────────────────────
create or replace function public.create_task(
  p_title text,
  p_body text default null,
  p_assignee_id uuid default null,
  p_assignee_role text default null,
  p_priority text default 'normal',
  p_due_date date default null,
  p_contract_id uuid default null,
  p_customer_id uuid default null
)
returns public.tasks
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.tasks;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'Task title is required';
  end if;
  if (p_assignee_id is not null) = (p_assignee_role is not null) then
    raise exception 'Assign to exactly one of a person or a team';
  end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.profiles where id = p_assignee_id and active
  ) then
    raise exception 'Assignee is not an active user';
  end if;

  insert into public.tasks (
    task_no, title, body, created_by, assignee_id, assignee_role,
    priority, due_date, contract_id, customer_id
  ) values (
    'TSK' || lpad(public.next_counter('task')::text, 4, '0'),
    trim(p_title), nullif(trim(coalesce(p_body, '')), ''), auth.uid(),
    p_assignee_id, p_assignee_role,
    coalesce(p_priority, 'normal'), p_due_date, p_contract_id, p_customer_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.set_task_status(p_task_id uuid, p_status text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Task not found';
  end if;
  -- owner, creator, assigned person, or a member of the assigned team
  if not (
    public.is_owner()
    or v_task.created_by = auth.uid()
    or v_task.assignee_id = auth.uid()
    or v_task.assignee_role = public.my_role()
  ) then
    raise exception 'Not authorized';
  end if;
  if p_status not in ('open', 'in_progress', 'done', 'cancelled') then
    raise exception 'Invalid status';
  end if;

  update public.tasks
  set status = p_status,
      completed_at = case when p_status = 'done' then now() else null end,
      completed_by = case when p_status = 'done' then auth.uid() else null end
  where id = p_task_id;
end;
$$;

create or replace function public.reassign_task(
  p_task_id uuid,
  p_assignee_id uuid,
  p_assignee_role text
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Task not found';
  end if;
  if not (public.is_owner() or v_task.created_by = auth.uid()) then
    raise exception 'Only the owner or the task creator can reassign';
  end if;
  if (p_assignee_id is not null) = (p_assignee_role is not null) then
    raise exception 'Assign to exactly one of a person or a team';
  end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.profiles where id = p_assignee_id and active
  ) then
    raise exception 'Assignee is not an active user';
  end if;

  update public.tasks
  set assignee_id = p_assignee_id, assignee_role = p_assignee_role
  where id = p_task_id;
end;
$$;

create or replace function public.add_task_comment(p_task_id uuid, p_body text)
returns public.task_comments
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.task_comments;
begin
  if not public.can_see_task(p_task_id) then
    raise exception 'Not authorized';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Comment cannot be empty';
  end if;

  insert into public.task_comments (task_id, body, created_by)
  values (p_task_id, trim(p_body), auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 4. RLS (reads; writes via the RPCs above)
-- ──────────────────────────────────────────────────────────────
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;

create policy tasks_select on public.tasks
  for select using (
    public.is_active_user() and (
      public.is_owner()
      or created_by = auth.uid()
      or assignee_id = auth.uid()
      or assignee_role = public.my_role()
    )
  );

create policy task_comments_select on public.task_comments
  for select using (
    public.is_active_user() and public.can_see_task(task_id)
  );
