import { useEffect, useState, useRef } from 'react';
import type { Snapshot } from '../../client/src/client.ts';
export function Reminders({ snapshot }: { snapshot: Snapshot }) {
  const [notices, setNotices] = useState<string[]>([]);
  const last = useRef<Snapshot['learning']['assignments'] | null>(null);
  useEffect(() => {
    if (last.current) {
      for (const item of snapshot.learning.assignments) {
        const old = last.current.find((a) => a.id === item.id);
        if (old && old.original_due_at === item.original_due_at) continue;
        const key = `fdu-assignment-notice:${item.id}:${item.original_due_at}`;
        if (localStorage.getItem(key)) continue;
        localStorage.setItem(key, 'shown');
        setNotices((n) =>
          [`${old ? '作业截止时间变更' : '新作业'}：${item.original_title}`, ...n].slice(0, 5),
        );
      }
    }
    last.current = snapshot.learning.assignments;
  }, [snapshot.learning.assignments]);
  useEffect(() => {
    const now = Date.now();
    for (const task of snapshot.tasks) {
      if (task.status === 'completed' || !task.due_at) continue;
      for (const reminder of task.reminders) {
        const when = Date.parse(task.due_at) - reminder.minutes_before * 60000;
        const key = `fdu-reminder:${task.id}:${task.due_at}:${reminder.minutes_before}`;
        if (now < when || now - when > 86400000 || localStorage.getItem(key)) continue;
        localStorage.setItem(key, 'shown');
        const message = `${task.title} · ${Date.parse(task.due_at) < now ? '已经到期' : `截止 ${new Date(task.due_at).toLocaleString('zh-CN')}`}`;
        setNotices((list) => [message, ...list].slice(0, 5));
        if ('Notification' in window && Notification.permission === 'granted')
          try {
            new Notification('FDU Agent 提醒', { body: message, tag: key });
          } catch {}
      }
    }
  }, [snapshot]);
  return notices.length ? (
    <section className="notice" role="status">
      {notices.map((n, i) => (
        <p key={i}>{n}</p>
      ))}
      <button onClick={() => setNotices([])}>知道了</button>
    </section>
  ) : null;
}
