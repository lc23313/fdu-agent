import { useEffect, useState, useRef } from 'react';
import type { Snapshot } from '../../client/src/client.ts';
import { reminderAt } from '../../core/src/schedule.ts';
type Notice = { key: string; text: string; taskId?: string };
export function Reminders({
  snapshot,
  open,
  clock,
}: {
  snapshot: Snapshot;
  open?: (id: string) => void;
  clock?: number;
}) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const last = useRef<Snapshot['learning']['assignments'] | null>(null);
  useEffect(() => {
    if (last.current) {
      for (const item of snapshot.learning.assignments) {
        const old = last.current.find((a) => a.id === item.id);
        if (old && old.original_due_at === item.original_due_at) continue;
        const key = `fdu-assignment-notice:${item.id}:${item.original_due_at}`;
        if (localStorage.getItem(key)) continue;
        localStorage.setItem(key, 'shown');
        setNotices((n) => [
          ...n,
          { key, text: `${old ? '作业截止时间变更' : '新作业'}：${item.original_title}` },
        ]);
      }
    }
    last.current = snapshot.learning.assignments;
  }, [snapshot.learning.assignments]);
  useEffect(() => {
    const now = Date.now(),
      added = new Map<string, Notice>();
    for (const task of snapshot.tasks) {
      const at = reminderAt(task);
      if (task.status === 'completed' || !at || task.time_kind === 'day') continue;
      for (const reminder of task.reminders) {
        const when = Date.parse(at) - reminder.minutes_before * 60000;
        const key = `fdu-reminder:${task.id}:${at}:${reminder.minutes_before}`;
        const previous = localStorage.getItem(key);
        if (previous === 'shown' || (previous && Number(previous) > now)) continue;
        if (!previous && (now < when || now - when > 86400000)) continue;
        localStorage.setItem(key, 'shown');
        const message = `${task.title} · ${task.time_kind === 'range' || !task.due_at ? '开始' : '截止'} ${new Date(at).toLocaleString('zh-CN')}`;
        added.set(task.id, { key, taskId: task.id, text: message });
      }
    }
    if (!added.size) return;
    const next = [...added.values()];
    setNotices((before) => [...before.filter((n) => !n.taskId || !added.has(n.taskId)), ...next]);
    if ('Notification' in window && Notification.permission === 'granted')
      try {
        const notification = new Notification('FDU Agent 提醒', {
          body: next.length === 1 ? next[0]!.text : `${next.length} 项任务需要关注，打开应用查看。`,
          tag: 'fdu-task-reminders',
        });
        notification.onclick = () => {
          window.focus();
          if (next.length === 1 && next[0]!.taskId) open?.(next[0]!.taskId);
          notification.close();
        };
      } catch {}
  }, [snapshot, clock, open]);
  const visible = notices.filter(
    (n) => !n.taskId || snapshot.tasks.some((t) => t.id === n.taskId && t.status !== 'completed'),
  );
  return visible.length ? (
    <section className="notice" role="status" aria-label="任务与作业提醒">
      {visible.slice(0, 5).map((notice) => (
        <div key={notice.key}>
          <p>{notice.text}</p>
          {notice.taskId && (
            <>
              {open && <button onClick={() => open(notice.taskId!)}>打开任务</button>}
              <button
                onClick={() => {
                  localStorage.setItem(notice.key, String(Date.now() + 10 * 60000));
                  setNotices((before) => before.filter((n) => n.key !== notice.key));
                }}
              >
                10 分钟后提醒
              </button>
            </>
          )}
          <button
            aria-label={`关闭提醒 ${notice.text}`}
            onClick={() => setNotices((before) => before.filter((n) => n.key !== notice.key))}
          >
            知道了
          </button>
        </div>
      ))}
      {visible.length > 5 && <p>另有 {visible.length - 5} 项提醒，处理上方事项后继续查看。</p>}
      {visible.length > 1 && <button onClick={() => setNotices([])}>全部知道了</button>}
    </section>
  ) : null;
}
