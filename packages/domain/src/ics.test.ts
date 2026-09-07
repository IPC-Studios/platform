import { describe, expect, it } from 'vitest'
import { buildIcs, icsDate, icsText } from './ics'

describe('ics', () => {
  it('formats dates in compact UTC', () => {
    expect(icsDate(new Date('2026-09-05T10:30:00+05:30'))).toBe('20260905T050000Z')
  })

  it('escapes the characters the format reserves', () => {
    expect(icsText('Sharma, Priya; venue\nMumbai')).toBe('Sharma\\, Priya\\; venue\\nMumbai')
  })

  it('builds one VEVENT with organizer and attendees, CRLF-terminated', () => {
    const ics = buildIcs({
      uid: 'meeting-1@ipc',
      title: 'Wedding recce',
      start: new Date('2026-09-10T04:30:00Z'),
      end: new Date('2026-09-10T05:30:00Z'),
      description: 'Walk the venue',
      location: 'Taj Lands End',
      organizer: { name: 'IPC Studios', email: 'hello@ipc.in' },
      attendees: [{ name: 'Priya', email: 'priya@x.in' }],
      stamp: new Date('2026-09-05T00:00:00Z'),
    })
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('UID:meeting-1@ipc')
    expect(ics).toContain('DTSTART:20260910T043000Z')
    expect(ics).toContain('DTEND:20260910T053000Z')
    expect(ics).toContain('SUMMARY:Wedding recce')
    expect(ics).toContain('ORGANIZER;CN=IPC Studios:mailto:hello@ipc.in')
    expect(ics).toContain('ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE;CN=Priya:mailto:priya@x.in')
    expect(ics).toContain('DTSTAMP:20260905T000000Z')
  })

  it('folds long lines at 75 octets', () => {
    const ics = buildIcs({
      uid: 'x',
      title: 'A'.repeat(120),
      start: new Date('2026-09-10T04:30:00Z'),
      end: new Date('2026-09-10T05:30:00Z'),
    })
    const summary = ics.split('\r\n').filter((l) => l.startsWith('SUMMARY:') || l.startsWith(' '))
    expect(summary[0]!.length).toBe(75)
    expect(summary[1]!.startsWith(' ')).toBe(true)
  })
})
