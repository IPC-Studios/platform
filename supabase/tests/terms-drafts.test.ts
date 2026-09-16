import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Terms drafts — a sheet you can stop writing and come back to.
 *
 * The risk worth a test is not the saving, it is the LIST. Documents are shown
 * one row per project, newest first, and a draft is newer than the issued
 * document it was started from — so an unfiltered list would let saving a
 * draft hide the live document, its link and its acknowledgement state.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const CLIENT = '33333333-3333-3333-3333-333333333333'
const PROJECT = '44444444-4444-4444-4444-444444444444'

let db: PGlite

/** The API's upsert, verbatim apart from the bound values. */
async function saveDraft(body: string, title: string) {
  return db.query<{ id: string }>(`
    insert into project_terms_documents
      (company_id, project_id, is_draft, rendered_body, title)
    values ('${COMPANY}', '${PROJECT}', true, '${body}', '${title}')
    on conflict (company_id, project_id) where is_draft and project_id is not null
    do update set rendered_body = excluded.rendered_body, title = excluded.title
    returning id;`)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create schema if not exists auth;`)
  await db.exec(
    `create table auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, encrypted_password text);`,
  )
  await db.exec(
    `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`,
  )
  for (const r of ['authenticated', 'anon', 'service_role', 'authenticator']) await db.exec(`create role ${r};`)

  const files = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('0000_'))
    .sort()
  for (const f of files) await db.exec(readFileSync(join(migDir, f), 'utf8'))

  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'owner@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email)
    values ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'owner@s.test');
    insert into clients (id, company_id, name) values ('${CLIENT}', '${COMPANY}', 'A Client');
    insert into projects (id, company_id, client_id, name) values ('${PROJECT}', '${COMPANY}', '${CLIENT}', 'Wedding');
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})

describe('terms drafts', () => {
  it('saving twice updates the one draft instead of piling up', async () => {
    const first = await saveDraft('half written', 'Wedding terms')
    const second = await saveDraft('a bit more', 'Wedding terms v2')
    expect(second.rows[0]!.id).toBe(first.rows[0]!.id)

    const all = await db.query<{ n: string }>(
      `select count(*) as n from project_terms_documents where project_id = '${PROJECT}' and is_draft;`,
    )
    expect(Number(all.rows[0]!.n)).toBe(1)

    const body = await db.query<{ rendered_body: string }>(
      `select rendered_body from project_terms_documents where is_draft and project_id = '${PROJECT}';`,
    )
    expect(body.rows[0]!.rendered_body).toBe('a bit more')
  })

  it('a draft never appears in the documents list', async () => {
    const rows = await db.query(`select * from list_project_terms_documents();`)
    expect(rows.rows.length).toBe(0)
  })

  it('a draft does not hide the issued document it was started from', async () => {
    // Issue a real one. It is OLDER than the draft saved above, which is
    // exactly the ordering that would shadow it in a distinct-on list.
    const issued = await db.query<{ document_id: string }>(
      `select * from issue_terms_document(p_project_id => '${PROJECT}', p_rendered_body => 'The real terms');`,
    )
    expect(issued.rows[0]!.document_id).toBeTruthy()
    await saveDraft('still fiddling', 'Draft again')

    const list = await db.query<{ id: string }>(`select id from list_project_terms_documents();`)
    expect(list.rows.length).toBe(1)
    expect(list.rows[0]!.id).toBe(issued.rows[0]!.document_id)
  })

  it('two projects can each hold their own draft', async () => {
    const other = '55555555-5555-5555-5555-555555555555'
    await db.exec(
      `insert into projects (id, company_id, client_id, name) values ('${other}', '${COMPANY}', '${CLIENT}', 'Reception');`,
    )
    await db.exec(`
      insert into project_terms_documents (company_id, project_id, is_draft, rendered_body)
      values ('${COMPANY}', '${other}', true, 'other draft');`)
    const n = await db.query<{ n: string }>(
      `select count(*) as n from project_terms_documents where is_draft;`,
    )
    expect(Number(n.rows[0]!.n)).toBe(2)
  })
})
