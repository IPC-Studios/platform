-- The three things a studio hands a client on a link.
--
-- Terms already worked this way since 0017 (issue → tokenised link → public
-- reader → acknowledgement with evidence). A quotation, a payment receipt and
-- a finished-work delivery are the same shape, and the token helper from 0010
-- serves all three. What was missing was the rows to point at and the public
-- readers.

-- ── quotations ────────────────────────────────────────────────
-- A quotation is a snapshot, not a view of the project. The client agreed to
-- the prices in front of them that day; a deliverable added next week must not
-- silently change what they accepted.
create table if not exists project_quotations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies (id) on delete cascade,
  project_id    uuid not null references projects (id) on delete cascade,
  -- { items: [{ title, amount, chargeable }], package_cost, add_ons, total }
  snapshot      jsonb not null,
  notes         text,
  accepted_at   timestamptz,
  accepted_by_name text,
  accepted_ip   text,
  accepted_user_agent text,
  declined_at   timestamptz,
  created_by    uuid references users (user_id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists pq_project_idx on project_quotations (company_id, project_id);

alter table project_quotations enable row level security;
drop policy if exists project_quotations_select on project_quotations;
drop policy if exists project_quotations_write on project_quotations;
create policy project_quotations_select on project_quotations for select to authenticated
  using (company_id = get_current_company_id());
create policy project_quotations_write on project_quotations for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());

-- Build the snapshot in SQL rather than trusting a browser with it: the prices
-- a client is shown are the ones the database holds, or they are worth nothing
-- as a record of what was offered.
create or replace function issue_project_quotation(
  p_project_id uuid,
  p_notes      text default null,
  p_ttl_hours  int  default 720
)
returns table (quotation_id uuid, token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company  uuid := get_current_company_id();
  v_project  projects;
  v_items    jsonb;
  v_quote    uuid;
  v_token    text;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_project from projects
   where id = p_project_id and company_id = v_company;
  if v_project.id is null then
    raise exception 'project not found' using errcode = 'P0001';
  end if;

  -- Only what the studio marked client-visible and quotable. The same rule the
  -- totals trigger uses, so the sum on the page matches the project.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'title', d.title,
               'chargeable', d.is_additional_charge,
               'amount', case when d.is_additional_charge
                              then d.additional_charge_amount else 0 end
             )
             order by d.is_additional_charge, d.title
           ),
           '[]'::jsonb
         )
    into v_items
    from deliverables d
   where d.project_id = p_project_id
     and d.company_id = v_company
     and d.visibility_scope = 'client'
     and d.show_on_quotation;

  insert into project_quotations (company_id, project_id, snapshot, notes, created_by)
  values (
    v_company, p_project_id,
    jsonb_build_object(
      'items', v_items,
      'package_cost', v_project.package_cost,
      'add_ons', v_project.additional_deliverables_cost,
      'total', v_project.total_cost,
      'project_name', v_project.name
    ),
    p_notes, auth.uid()
  )
  returning id into v_quote;

  v_token := issue_access_token('quotation', v_quote, p_ttl_hours);
  return query select v_quote, v_token;
end;
$$;

create or replace function get_quotation_for_token(p_raw text)
returns table (
  snapshot jsonb, notes text, accepted_at timestamptz, accepted_by_name text,
  declined_at timestamptz, client_name text, company_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select q.snapshot, q.notes, q.accepted_at, q.accepted_by_name, q.declined_at,
         cl.name, co.name
    from project_quotations q
    join projects p on p.id = q.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = q.company_id
   where q.id = resolve_access_token('quotation', p_raw)
$$;

-- Accept or decline. Declining does not consume the token: a client who says
-- no on Monday and yes on Tuesday should not need a new link.
create or replace function respond_to_quotation(
  p_raw        text,
  p_accept     boolean,
  p_name       text default null,
  p_ip         text default null,
  p_user_agent text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_quote uuid := resolve_access_token('quotation', p_raw);
begin
  if v_quote is null then
    return false;
  end if;
  if p_accept then
    update project_quotations
       set accepted_at = now(), accepted_by_name = p_name,
           accepted_ip = p_ip, accepted_user_agent = p_user_agent,
           declined_at = null
     where id = v_quote and accepted_at is null;
  else
    update project_quotations
       set declined_at = now()
     where id = v_quote and accepted_at is null;
  end if;
  return found;
end;
$$;

-- ── payment receipts ──────────────────────────────────────────
-- Nothing new to store: a receipt is a payment already recorded, shown to the
-- person who made it. The token points straight at the payment row.
create or replace function issue_payment_receipt(p_payment_id uuid, p_ttl_hours int default 8760)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_company uuid := get_current_company_id();
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from received_payments where id = p_payment_id and company_id = v_company
  ) then
    raise exception 'payment not found' using errcode = 'P0001';
  end if;
  return issue_access_token('receipt', p_payment_id, p_ttl_hours);
end;
$$;

create or replace function get_receipt_for_token(p_raw text)
returns table (
  amount numeric, paid_on date, mode text, reference text,
  project_name text, client_name text, company_name text,
  total_cost numeric, received_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select rp.amount, rp.paid_on, rp.mode, rp.reference,
         p.name, cl.name, co.name, p.total_cost,
         (select coalesce(sum(x.amount), 0) from received_payments x
           where x.project_id = p.id)
    from received_payments rp
    join projects p on p.id = rp.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = rp.company_id
   where rp.id = resolve_access_token('receipt', p_raw)
$$;

-- ── work delivery ─────────────────────────────────────────────
-- 0010 issued the delivery token and then had nowhere to spend it. This is the
-- reader the client's link needs.
create or replace function get_delivery_for_token(p_raw text)
returns table (
  submission_link text, notes text, delivered_at timestamptz,
  project_name text, client_name text, company_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select s.submission_link, s.notes,
         (select max(d.delivered_at) from team_work_client_deliveries d
           where d.submission_id = s.id),
         p.name, cl.name, co.name
    from team_work_submissions s
    left join projects p on p.id = s.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = s.company_id
   where s.id = resolve_access_token('work_delivery', p_raw)
     and s.status = 'approved'
$$;

revoke all on function issue_project_quotation(uuid, text, int) from public, anon;
revoke all on function issue_payment_receipt(uuid, int)         from public, anon;
revoke all on function get_quotation_for_token(text)            from public;
revoke all on function respond_to_quotation(text, boolean, text, text, text) from public;
revoke all on function get_receipt_for_token(text)              from public;
revoke all on function get_delivery_for_token(text)             from public;
grant execute on function issue_project_quotation(uuid, text, int) to authenticated;
grant execute on function issue_payment_receipt(uuid, int)         to authenticated;
grant execute on function get_quotation_for_token(text)            to anon, authenticated;
grant execute on function respond_to_quotation(text, boolean, text, text, text) to anon, authenticated;
grant execute on function get_receipt_for_token(text)              to anon, authenticated;
grant execute on function get_delivery_for_token(text)             to anon, authenticated;
