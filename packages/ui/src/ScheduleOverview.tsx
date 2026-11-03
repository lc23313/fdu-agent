import type { Task } from '../../core/src/task.ts';
import { dateKey, occursOn } from './PlanCalendar.tsx';
export function countdown(at: string, now = Date.now()) {
  const minutes = Math.ceil((Date.parse(at) - now) / 60000);
  return minutes < 0
    ? `已逾期 ${Math.ceil(-minutes / 60)} 小时`
    : minutes < 60
      ? `${minutes} 分钟后`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟后`
        : `${Math.floor(minutes / 1440)} 天后`;
}
export function ScheduleOverview({
  tasks,
  open,
  choose,
}: {
  tasks: Task[];
  open: (id: string) => void;
  choose: (day: string) => void;
}) {
  const next = tasks
    .filter((t) => t.status !== 'completed' && (t.due_at || t.start_at))
    .sort((a, b) => (a.due_at ?? a.start_at!).localeCompare(b.due_at ?? b.start_at!))[0];
  return (
    <section className="schedule-overview">
      {next && (
        <button
          className="next-task"
          aria-label="查看下一项待处理任务"
          onClick={() => open(next.id)}
        >
          <small>下一项待处理</small>
          <b>{next.title}</b>
          <span>{countdown(next.due_at ?? next.start_at!)}</span>
        </button>
      )}
      <div className="seven-days" aria-label="未来七天">
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() + i);
          const key = dateKey(d);
          const count = tasks.filter((t) => t.status !== 'completed' && occursOn(t, key)).length;
          return (
            <button key={key} onClick={() => choose(key)} aria-label={`${key}，${count}项待办`}>
              <small>
                {i === 0 ? '今天' : d.toLocaleDateString('zh-CN', { weekday: 'short' })}
              </small>
              <b>{d.getDate()}</b>
              <small>{count ? `${count} 项` : '·'}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}
