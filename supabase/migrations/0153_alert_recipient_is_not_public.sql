-- crm_alert_recipient should never have been executable by anon.
--
-- 0151 granted it to anon on the reasoning that accept_quote and
-- decline_quote call it and those ARE called by anon, from the public quote
-- link. That reasoning is wrong: both callers are SECURITY DEFINER, so the
-- calls inside them are checked against the function owner's privileges, not
-- the web visitor's. The grant bought nothing.
--
-- What it cost: crm_alert_recipient(p_company, null) returns a company's owner
-- user_id, and with execute granted to anon, anyone on the internet could ask
-- for any company's. Company ids are uuids and not enumerable, so this is a
-- narrow leak rather than an open door — but it is a user id handed to an
-- unauthenticated caller by a function that had no reason to answer them.
--
-- Found by the tenancy suite the first time it ran against a current schema.
-- That suite's freshDb() had been pinned at migration 0096 while the schema
-- reached 0152, so this check — "no CRM definer function is executable by anon
-- except the tokened quote pages" — had not covered anything added in 56
-- migrations. It caught this on the first run afterwards.

revoke all on function crm_alert_recipient(uuid, uuid) from public, anon;
grant execute on function crm_alert_recipient(uuid, uuid) to authenticated, service_role;
