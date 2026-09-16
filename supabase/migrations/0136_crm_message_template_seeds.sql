-- Starter message templates, so a new studio is not staring at an empty list.
--
-- The old app has a "Seed defaults" button on its Message Templates tab. Ours
-- had no seeding of any kind for CRM messages: every studio wrote the first
-- enquiry reply, the follow-up nudge and the quotation note from scratch,
-- which in practice means most never make templates at all and retype the
-- same WhatsApp message all season.
--
-- The placeholders are the ones renderTemplate actually substitutes
-- (packages/domain/src/template.ts via crmTemplateVars): name, phone, email,
-- studio, follow_up_date, city, group, event_type, event_date, deal_value.
-- A placeholder that is not in that list renders as empty text, so writing a
-- seed against an invented variable would silently produce a message with a
-- hole in it.

create or replace function seed_crm_message_templates(p_company uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
  r record;
begin
  for r in
    select * from (values
      ('First reply — enquiry',
       'whatsapp', 'Enquiry',
       'Hi {{name}}, thanks for reaching out to {{studio}}! We would love to be part of your {{event_type}}. Could you share the date and venue so we can check our availability?'),
      ('Availability confirmed',
       'whatsapp', 'Enquiry',
       'Good news {{name}} — we are free on {{event_date}}. Shall I put together a quotation for you?'),
      ('Quotation sent',
       'whatsapp', 'Proposal',
       'Hi {{name}}, I have just sent across the quotation for your {{event_type}}. Have a look whenever you get a moment and tell me what you think — happy to adjust the package.'),
      ('Gentle follow-up',
       'whatsapp', 'Follow-up',
       'Hi {{name}}, just checking in on the quotation we sent. No rush at all — let me know if you would like any changes.'),
      ('Follow-up reminder',
       'whatsapp', 'Follow-up',
       'Hi {{name}}, hope you are well. We had pencilled in {{follow_up_date}} to touch base about your {{event_type}}. Is now a good time?'),
      ('Booking confirmed',
       'whatsapp', 'Won',
       'Welcome aboard {{name}}! Your date is blocked with {{studio}}. I will send the agreement and the advance details shortly.'),
      ('Enquiry reply — email',
       'email', 'Enquiry',
       E'Hi {{name}},\n\nThank you for getting in touch with {{studio}}.\n\nWe would love to hear more about your {{event_type}} on {{event_date}}. Could you tell us a little about the day — the venue, rough guest count, and what coverage you have in mind?\n\nWarm regards,\n{{studio}}'),
      ('Quotation — email',
       'email', 'Proposal',
       E'Hi {{name}},\n\nPlease find our quotation for your {{event_type}} attached.\n\nIt covers everything we discussed. If you would like to move anything around, just say — we can shape the package around what matters most to you.\n\nWarm regards,\n{{studio}}'),
      ('Lost — keep in touch',
       'note', 'Lost',
       'Did not go ahead this time. Worth a check-in closer to {{event_date}} next year, or if they refer someone in {{city}}.')
    ) as t(name, kind, category, body)
  loop
    -- Name is the identity a studio recognises, so re-running adds only what
    -- is missing and never overwrites one they have since edited.
    if exists (select 1 from crm_templates c where c.company_id = p_company and c.name = r.name) then
      continue;
    end if;
    insert into crm_templates (company_id, name, body, kind, category)
    values (p_company, r.name, r.body, r.kind, r.category);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function seed_crm_message_templates(uuid) from public, anon;
grant execute on function seed_crm_message_templates(uuid) to authenticated, service_role;
