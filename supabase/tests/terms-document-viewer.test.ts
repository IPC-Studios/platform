import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Reading a terms document as the studio rather than as the client.
 *
 * Everything that rendered a terms sheet went through the token function,
 * which is `volatile` because it increments access_count on both the token and
 * the document — the number the Documents page reports as client engagement.
 * So the only way to check what had been sent also corrupted the one figure
 * saying whether the client had read it.
 *
 * The tests that matter here are the two that are invisible from the screen:
 * that looking counts nothing, and that a document cannot be read across
 * studios.
 */
const migDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const OWNER = '11111111-1111-1111-1111-111111111111'
const COMPANY = '22222222-2222-2222-2222-222222222222'
const OTHER_CO = '33333333-3333-3333-3333-333333333333'

let db: PGlite
const q = async <T>(sql: string) => (await db.query<T>(sql)).rows
const one = async <T>(sql: string) => (await q<T>(sql))[0]

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
  for (const f of readdirSync(migDir).filter((x) => x.endsWith('.sql') && !x.startsWith('0000_')).sort()) {
    await db.exec(readFileSync(join(migDir, f), 'utf8'))
  }
  await db.exec(`insert into auth.users (id, email) values ('${OWNER}', 'o@s.test');`)
  await db.exec(`
    insert into companies (id, name, owner_user_id) values ('${COMPANY}', 'Studio', '${OWNER}');
    insert into users (user_id, company_id, role, name, email) values
      ('${OWNER}', '${COMPANY}', 'super_admin', 'Owner', 'o@s.test');
  `)
  await db.exec(`set request.jwt.claim.sub = '${OWNER}';`)
})



const docId = '66666666-6666-6666-6666-666666666666'

const makeDoc = async (company: string, id: string, body = 'These are the terms.') =>
  await db.exec(`
    insert into project_terms_documents (id, company_id, project_id, rendered_body, title)
    values ('${id}', '${company}', null, '${body}', 'Wedding terms');`)

const views = async (id: string) =>
  (await one<{ access_count: number }>(
    `select coalesce(access_count, 0) as access_count from project_terms_documents where id = '${id}';`,
  ))!.access_count

const read = async (id: string) =>
  await one<{ body: string; title: string; revoked: boolean; access_count: number }>(
    `select body, title, revoked, access_count from get_terms_payload_for_document('${id}'::uuid);`,
  )

beforeEach(async () => {
  await db.exec(`delete from access_tokens where purpose = 'terms_ack';`)
  await db.exec(`delete from project_terms_documents;`)
})

describe('reading a document in the app', () => {
  it('returns the document the studio actually sent', async () => {
    await makeDoc(COMPANY, docId, 'Fifty percent on booking.')
    const row = await read(docId)
    expect(row!.body).toBe('Fifty percent on booking.')
    expect(row!.title).toBe('Wedding terms')
  })

  /**
   * The one that protects a number somebody reads.
   *
   * get_terms_payload_for_token bumps access_count every call. If the in-app
   * viewer went through that, "opened by the client 9 times" would mostly be
   * the studio checking its own paperwork.
   */
  it('does not count as the client opening it', async () => {
    await makeDoc(COMPANY, docId)
    expect(await views(docId)).toBe(0)
    await read(docId)
    await read(docId)
    await read(docId)
    expect(await views(docId)).toBe(0)
  })

  it('still shows a document whose link was revoked', async () => {
    // The lapsed one is usually the one somebody needs to re-read — "what did
    // we send them in March" does not stop mattering because the link died.
    await makeDoc(COMPANY, docId)
    await db.exec(`update project_terms_documents set revoked_at = now() where id = '${docId}';`)
    const row = await read(docId)
    expect(row).toBeDefined()
    expect(row!.revoked).toBe(true)
  })

  it('still shows a document whose link expired', async () => {
    await makeDoc(COMPANY, docId)
    await db.exec(`update project_terms_documents set expires_at = now() - interval '1 day' where id = '${docId}';`)
    expect(await read(docId)).toBeDefined()
  })

  it('will not read another studio’s document', async () => {
    // The token version gets its tenancy from the token. Addressed by id, the
    // company check IS the security boundary.
    await db.exec(`
      insert into companies (id, name, owner_user_id) values ('${OTHER_CO}', 'Other studio', '${OWNER}')
      on conflict (id) do nothing;`)
    const foreign = '77777777-7777-7777-7777-777777777777'
    await makeDoc(OTHER_CO, foreign, 'Not yours.')
    expect(await read(foreign)).toBeUndefined()
  })

  it('returns nothing for a document that does not exist', async () => {
    expect(await read('88888888-8888-8888-8888-888888888888')).toBeUndefined()
  })

  it('reports whether the client agreed, and who', async () => {
    await makeDoc(COMPANY, docId)
    await db.exec(`
      update project_terms_documents
         set acknowledged_at = now(), acknowledged_by_name = 'Aarav Mehta'
       where id = '${docId}';`)
    const row = await one<{ acknowledged_by_name: string | null; acknowledged_at: Date | null }>(
      `select acknowledged_by_name, acknowledged_at from get_terms_payload_for_document('${docId}'::uuid);`,
    )
    expect(row!.acknowledged_by_name).toBe('Aarav Mehta')
    expect(row!.acknowledged_at).not.toBeNull()
  })

  it('reports the client’s real view count without changing it', async () => {
    await makeDoc(COMPANY, docId)
    await db.exec(`update project_terms_documents set access_count = 4 where id = '${docId}';`)
    expect((await read(docId))!.access_count).toBe(4)
    expect(await views(docId)).toBe(4)
  })
})
