import type { Task } from '../../core/src/task.ts';

export const dateKey = (value: string | Date) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const occursOn = (task: Task, day: string) =>
  task.start_at && task.due_at
    ? dateKey(task.start_at) <= day && dateKey(task.due_at) >= day
    : !!(task.due_at ?? task.start_at) && dateKey(task.due_at ?? task.start_at!) === day;
export function PlanCalendar({
  mode,
  anchor,
  day,
  tasks,
  select,
  move,
  open,
  drop,
}: {
  mode: 'week' | 'month';
  anchor: string;
  day: string;
  tasks: Task[];
  select: (day: string) => void;
  move: (day: string) => void;
  open: (id: string) => void;
  drop: (id: string, day: string) => void;
}) {
  const current = new Date(`${anchor}T12:00:00`);
  const start = new Date(current);
  if (mode === 'month') start.setDate(1);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const shift = (direction: number) => {
    const next = new Date(current);
    if (mode === 'month') {
      next.setDate(1);
      next.setMonth(next.getMonth() + direction);
    } else next.setDate(next.getDate() + direction * 7);
    move(dateKey(next));
  };
  return (
    <section className="calendar" aria-label={mode === 'week' ? '周历' : '月历'}>
      <div className="calendar-heading">
        <button onClick={() => shift(-1)} aria-label={mode === 'week' ? '上一周' : '上一月'}>
          ‹
        </button>
        <span>{mode === 'month' ? anchor.slice(0, 7) : `${dateKey(start)} 起的一周`}</span>
        <button onClick={() => shift(1)} aria-label={mode === 'week' ? '下一周' : '下一月'}>
          ›
        </button>
        <button
          onClick={() => {
            const today = dateKey(new Date());
            move(today);
            select(today);
          }}
        >
          回到今天
        </button>
      </div>
      <div className={`calendar-grid ${mode === 'week' ? 'week-grid' : ''}`}>
        {'一二三四五六日'.split('').map((d) => (
          <small key={d}>周{d}</small>
        ))}
        {Array.from({ length: mode === 'week' ? 7 : 42 }, (_, i) => {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          const key = dateKey(d);
          const items = tasks.filter((t) => occursOn(t, key));
          return (
            <div
              key={key}
              className={`calendar-day ${key === day ? 'selected' : ''} ${key === dateKey(new Date()) ? 'is-today' : ''} ${mode === 'month' && key.slice(0, 7) !== anchor.slice(0, 7) ? 'muted' : ''}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                drop(e.dataTransfer.getData('text/fdu-task'), key);
              }}
            >
              <button aria-label={key} onClick={() => select(key)}>
                {d.getDate()}
                {items.length > 0 && <small>{items.length} 项</small>}
              </button>
              {mode === 'week' &&
                items.map((t) => (
                  <button className="calendar-task" key={t.id} onClick={() => open(t.id)}>
                    {t.title}
                    <small>
                      {t.due_at
                        ? new Date(t.due_at).toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '已安排'}
                    </small>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
