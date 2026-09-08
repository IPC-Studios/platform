import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const dir = 'supabase/migrations'
const OWNER = '11111111-1111-1111-1111-111111111111'
const db = new PGlite()
await db.exec(`create schema if not exists auth;`)
await db.exec(`create table auth.users (id uuid primary key default gen_random_uuid(), email text, encrypted_password text);`)
await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`)
for (const r of ['authenticated', 'anon', 'service_role']) await db.exec(`create role ${r};`)
for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql') && !f.startsWith('0000')).sort()) {
  await db.exec(readFileSync(`${dir}/${f}`, 'utf8'))
}
await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
await db.query(`select register_company_and_admin('Studio','Owner');`)
const co = (await db.query(`select get_current_company_id() as c`)).rows[0].c
await db.exec(`
  insert into clients (company_id, name, phone) values ('${co}', 'Acme', '9000000000');
  insert into projects (company_id, client_id, name, package_cost, status)
    values ('${co}', (select id from clients limit 1), 'Wedding', 100000, 'active');
`)
const proj = (await db.query(`select id from projects limit 1`)).rows[0].id
const first = await db.query(`select * from issue_terms_document(p_project_id => '${proj}', p_rendered_body => 'Terms v1')`)
console.log('issued', first.rows[0])
const listQuery = `
  select distinct on (d.project_id)
         d.id, d.project_id, p.name as project_name,
         cl.name as client_name, cl.phone as client_phone,
         d.acknowledged_at, d.acknowledged_by_name, d.created_at,
         (t.id is not null and t.used_at is null and (t.expires_at is null or t.expires_at > now())) as has_active_link,
         t.expires_at as link_expires_at
    from project_terms_documents d
    left join projects p on p.id = d.project_id
    left join clients cl on cl.id = p.client_id
    left join lateral (
      select id, expires_at, used_at from access_tokens
       where purpose = 'terms_ack' and subject_id = d.id
       order by created_at desc limit 1
    ) t on true
   where d.company_id = '${co}'
   order by d.project_id, d.created_at desc`
const list = await db.query(listQuery)
console.log('list', JSON.stringify(list.rows, null, 2))
