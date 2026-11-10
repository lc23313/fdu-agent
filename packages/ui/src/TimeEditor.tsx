import type { TaskPatch } from '../../core/src/task.ts';
import { dayKey } from '../../core/src/schedule.ts';
export function TimeEditor({
  value,
  change,
}: {
  value: TaskPatch;
  change: (patch: TaskPatch) => void;
}) {
  const kind =
    value.time_kind ??
    (value.start_at && value.due_at
      ? 'range'
      : value.due_at
        ? 'deadline'
        : value.start_at
          ? 'day'
          : 'none');
  const date = value.start_at ?? value.due_at;
  const day = date ? dayKey(date) : dayKey(new Date());
  const clock = (v: string | null | undefined, fallback: string) =>
    v ? new Date(v).toTimeString().slice(0, 5) : fallback;
  const start = clock(value.start_at, '09:00'),
    end = clock(value.due_at, kind === 'range' ? '10:00' : '23:59');
  const set = (mode: string, d = day, s = start, finish = end) => {
    const begin = new Date(`${d}T${s}`),
      stop = new Date(`${d}T${finish}`);
    if (mode === 'range' && finish < s) stop.setDate(stop.getDate() + 1);
    if (
      mode === 'range' &&
      value.start_at &&
      value.due_at &&
      finish === end &&
      (s !== start || d !== day)
    ) {
      const delta = begin.getTime() - Date.parse(value.start_at);
      change({
        time_kind: 'range',
        start_at: begin.toISOString(),
        due_at: new Date(Date.parse(value.due_at) + delta).toISOString(),
      });
      return;
    }
    localStorage.setItem('fdu-last-time-kind', mode);
    change({
      time_kind: mode === 'none' ? null : (mode as 'day'),
      start_at:
        mode === 'day'
          ? new Date(`${d}T00:00`).toISOString()
          : mode === 'range'
            ? begin.toISOString()
            : null,
      due_at: mode === 'range' || mode === 'deadline' ? stop.toISOString() : null,
      ...(mode === 'none' ? { repeat: null } : {}),
    });
  };
  return (
    <section className="time-editor">
      <div className="view-tabs" aria-label="时间安排">
        {[
          ['none', '稍后安排'],
          ['day', '某天完成'],
          ['deadline', '仅截止'],
          ['range', '时间段'],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={kind === id ? 'selected' : ''}
            aria-pressed={kind === id}
            onClick={() => {
              const next = new Date(Math.ceil((Date.now() + 60000) / 1800000) * 1800000);
              const stop = new Date(next.getTime() + 3600000);
              const freshRange = id === 'range' && kind !== 'range';
              set(
                id!,
                freshRange && day === dayKey(new Date()) ? dayKey(next) : day,
                freshRange ? clock(next.toISOString(), '09:00') : start,
                freshRange ? clock(stop.toISOString(), '10:00') : end,
              );
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {kind !== 'none' && (
        <>
          <label>
            日期
            <input
              type="date"
              aria-label="任务日期"
              value={day}
              required
              onChange={(e) => {
                if (e.target.value) set(kind, e.target.value);
              }}
            />
          </label>
          <div className="date-shortcuts">
            {[
              ['今天', 0],
              ['明天', 1],
              ['后天', 2],
              ['一周后', 7],
            ].map(([label, n]) => (
              <button
                type="button"
                key={label}
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + Number(n));
                  set(kind, dayKey(d));
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {kind === 'range' ? (
            <>
              <div className="form-grid">
                <label>
                  开始
                  <input
                    aria-label="日程开始时间"
                    type="time"
                    value={start}
                    required
                    onChange={(e) => {
                      if (e.target.value) set(kind, day, e.target.value);
                    }}
                  />
                </label>
                <label>
                  结束
                  <input
                    aria-label="日程结束时间"
                    type="time"
                    value={end}
                    required
                    onChange={(e) => {
                      if (e.target.value) set(kind, day, start, e.target.value);
                    }}
                  />
                </label>
              </div>
              <div className="date-shortcuts">
                {[30, 60, 90, 120, 180].map((n) => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => {
                      const d = new Date(`${day}T${start}`);
                      d.setMinutes(d.getMinutes() + n);
                      set(kind, day, start, clock(d.toISOString(), '10:00'));
                    }}
                  >
                    {n} 分钟
                  </button>
                ))}
              </div>
              <details
                className="range-end-date"
                open={!!value.due_at && dayKey(value.due_at) !== day}
              >
                <summary>
                  结束日期{value.due_at && dayKey(value.due_at) !== day ? ' · 跨天' : ' · 同一天'}
                </summary>
                <label>
                  结束日期
                  <input
                    aria-label="结束日期"
                    type="date"
                    min={day}
                    value={value.due_at ? dayKey(value.due_at) : day}
                    onChange={(e) => {
                      if (e.target.value)
                        change({ due_at: new Date(`${e.target.value}T${end}`).toISOString() });
                    }}
                  />
                </label>
              </details>
              {end < start && <p className="notice">跨天：结束时间在次日</p>}
              {end === start && <p role="alert">开始与结束不能相同，请选择结束时间。</p>}
            </>
          ) : kind === 'deadline' ? (
            <label>
              截止时间
              <input
                aria-label="日程截止时间"
                type="time"
                required
                value={end}
                onChange={(e) => {
                  if (e.target.value) set(kind, day, start, e.target.value);
                }}
              />
            </label>
          ) : (
            <small>只安排日期，不设置具体时刻，也不判断为逾期。</small>
          )}
        </>
      )}
    </section>
  );
}
