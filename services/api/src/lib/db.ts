import postgres, { type Sql, type TransactionSql } from 'postgres'
import type { Env } from '../context'

/**
 * The Postgres client (replaces supabase-js / PostgREST). One pooled connection
 * per process; the API connects as the `authenticator` role and SET ROLEs per
 * request, mirroring PostgREST so every RLS policy + SECURITY DEFINER function
 * behaves identically to the Supabase setup.
 */
let _sql: Sql | null = null

const ident = (v: unknown): unknown => v

/**
 * PostgREST returned JSON, so the zod contracts expect ISO timestamp strings,
 * "YYYY-MM-DD" dates, and JSON numbers. postgres.js instead yields Date objects
 * and numeric-as-string. These read-side parsers realign the wire shape to what
 * the contracts already validate, centrally — so no query or contract changes.
 */
function pgTimestampToIso(v: string): string {
  // "2026-06-01 10:00:00.123+00" -> "2026-06-01T10:00:00.123+00:00"
  let s = v.replace(' ', 'T')
  const m = s.match(/([+-]\d{2})(\d{2})?$/)
  if (m && m.index !== undefined) s = s.slice(0, m.index) + m[1] + ':' + (m[2] ?? '00')
  return s
}

const TYPES = {
  // numeric/decimal -> Number (money contracts are z.number()).
  numeric: { to: 1700, from: [1700], serialize: ident, parse: (v: string) => Number(v) },
  // int8/bigint -> Number (counts).
  int8: { to: 20, from: [20], serialize: ident, parse: (v: string) => Number(v) },
  // date -> "YYYY-MM-DD" string (isoDate), not a Date object.
  date: { to: 1082, from: [1082], serialize: ident, parse: ident },
  // timestamp(tz) -> ISO-8601 string with offset (isoDateTime).
  timestamptz: { to: 1184, from: [1114, 1184], serialize: ident, parse: pgTimestampToIso },
}

export function db(env: Env): Sql {
  if (!_sql) {
    _sql = postgres(env.DATABASE_URL, {
      max: 10,
      // Function-heavy workload with dynamic SQL; skip the prepared-statement
      // cache to avoid plan-cache surprises across SET ROLE boundaries.
      prepare: false,
      types: TYPES,
    })
  }
  return _sql
}

/** For tests / graceful shutdown. */
export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end({ timeout: 5 })
    _sql = null
  }
}

/**
 * Run `fn` as the `authenticated` role with `auth.uid()` bound to `uid`, inside
 * one transaction. This is the RLS-scoped path — the equivalent of supabase-js's
 * anon-key-plus-JWT client. Every tenant read/write goes through here.
 */
export function withUser<T>(env: Env, uid: string, fn: (sql: TransactionSql) => Promise<T>): Promise<T> {
  return db(env).begin(async (sql) => {
    // set_config(..., true) = local to this transaction; auth.uid() reads it.
    await sql`select set_config('request.jwt.claim.sub', ${uid}, true)`
    await sql`set local role authenticated`
    return fn(sql)
  }) as Promise<T>
}

/**
 * Run `fn` as `service_role` (BYPASSRLS) — the narrow escape hatch for payments,
 * webhooks, cron, and cross-tenant platform ops. Never expose to a tenant path.
 */
export function withService<T>(env: Env, fn: (sql: TransactionSql) => Promise<T>): Promise<T> {
  return db(env).begin(async (sql) => {
    await sql`set local role service_role`
    return fn(sql)
  }) as Promise<T>
}
