import type { Task } from './task.ts';
import { dayKey, reminderAt } from './schedule.ts';

export function calendarExport(tasks: Task[], now = new Date()) {
  const stamp = (at: string | Date) =>
    new Date(at)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z/, 'Z');
  const escape = (value: string) =>
    value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, '\\$&');
  const events = tasks
    .filter(
      (task) => !task.deleted_at && task.status !== 'completed' && (task.start_at || task.due_at),
    )
    .map((task) => {
      const at =
        task.time_kind === 'deadline'
          ? (task.due_at ?? task.start_at!)
          : (task.start_at ?? task.due_at!);
      const alarms =
        task.time_kind === 'day'
          ? []
          : task.reminders.map((reminder) => {
              const baseline = Date.parse(reminderAt(task)!);
              return [
                'BEGIN:VALARM',
                `TRIGGER;VALUE=DATE-TIME:${stamp(new Date(baseline - reminder.minutes_before * 60000))}`,
                'ACTION:DISPLAY',
                `DESCRIPTION:${escape(task.title)}`,
                'END:VALARM',
              ].join('\r\n');
            });
      return [
        'BEGIN:VEVENT',
        `UID:${task.id}@fdu-agent`,
        `DTSTAMP:${stamp(now)}`,
        task.time_kind === 'day'
          ? `DTSTART;VALUE=DATE:${dayKey(at).replaceAll('-', '')}`
          : `DTSTART:${stamp(at)}`,
        ...(task.time_kind === 'range' && task.due_at ? [`DTEND:${stamp(task.due_at)}`] : []),
        `SUMMARY:${escape(task.title)}`,
        ...alarms,
        'END:VEVENT',
      ].join('\r\n');
    });
  const raw = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FDU Agent//Personal Tasks//ZH',
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  const encoder = new TextEncoder();
  return raw
    .split('\r\n')
    .map((line) => {
      let folded = '',
        width = 0;
      for (const character of line) {
        const size = encoder.encode(character).length;
        if (width + size > 75) {
          folded += '\r\n ';
          width = 1;
        }
        folded += character;
        width += size;
      }
      return folded;
    })
    .join('\r\n');
}
