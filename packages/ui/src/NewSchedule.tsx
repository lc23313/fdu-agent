import { useState } from 'react';
import type { TaskPatch } from '../../core/src/task.ts';
import { dateKey } from './PlanCalendar.tsx';
export function NewSchedule({
  title,
  day,
  courses,
  save,
  close,
}: {
  title: string;
  day: string;
  courses: { id: string; name: string }[];
  save: (title: string, patch: TaskPatch) => Promise<unknown>;
  close: () => void;
}) {
  const [kind, setKind] = useState('due'),
    [date, setDate] = useState(day || dateKey(new Date())),
    [start, setStart] = useState('09:00'),
    [end, setEnd] = useState('10:00'),
    [due, setDue] = useState('23:59'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const overnight = kind === 'range' && end <= start;
  return (
    <div className="modal-backdrop">
      <section
        className="settings-modal schedule-modal"
        role="dialog"
        aria-modal="true"
        aria-label="添加日程"
      >
        <div className="detail-heading">
          <h2>添加日程</h2>
          <button onClick={close} aria-label="关闭添加日程">
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError('');
            const begin = new Date(`${date}T${start}`),
              finish = new Date(`${date}T${kind === 'due' ? due : end}`);
            if (overnight) finish.setDate(finish.getDate() + 1);
            void save(String(f.get('title')), {
              start_at: kind === 'range' ? begin.toISOString() : null,
              due_at: kind === 'none' ? null : finish.toISOString(),
              course_id: String(f.get('course')) || null,
              priority: f.get('important') === 'on' ? 3 : 0,
              notes: String(f.get('notes')),
              reminders: Number(f.get('reminder'))
                ? [{ minutes_before: Number(f.get('reminder')) }]
                : [],
            })
              .then(close)
              .catch((e) => setError(String(e)))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            日程标题
            <input
              name="title"
              aria-label="日程标题"
              autoFocus
              defaultValue={title}
              placeholder="例如：实验课、提交报告"
              required
              maxLength={200}
            />
          </label>
          <div className="view-tabs">
            {[
              ['due', '仅截止'],
              ['range', '时间段'],
              ['none', '稍后安排'],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={kind === id ? 'selected' : ''}
                onClick={() => setKind(id!)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="subtitle">
            {kind === 'due'
              ? '用于交作业、提交申请等只有截止时间的事项。'
              : kind === 'range'
                ? '用于课程、自习或会议，结束较早时自动安排在次日。'
                : '先收进任务列表，不设置日期。'}
          </p>
          {kind !== 'none' && (
            <>
              <label>
                日期
                <input
                  aria-label="日程日期"
                  type="date"
                  value={date}
                  required
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <div className="date-shortcuts">
                {[
                  ['今天', 0],
                  ['明天', 1],
                  ['后天', 2],
                  ['一周后', 7],
                ].map(([label, offset]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + Number(offset));
                      setDate(dateKey(d));
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <small>
                {new Date(`${date}T12:00`).toLocaleDateString('zh-CN', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </small>
              {kind === 'due' ? (
                <label>
                  日程截止时间
                  <input
                    aria-label="日程截止时间"
                    type="time"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                    required
                  />
                </label>
              ) : (
                <>
                  <div className="form-grid">
                    <label>
                      开始
                      <input
                        aria-label="日程开始时间"
                        type="time"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      结束
                      <input
                        aria-label="日程结束时间"
                        type="time"
                        value={end}
                        onChange={(e) => setEnd(e.target.value)}
                        required
                      />
                    </label>
                  </div>
                  <div className="date-shortcuts">
                    {[30, 60, 90, 120].map((n) => (
                      <button
                        type="button"
                        key={n}
                        onClick={() => {
                          const [h, m] = start.split(':').map(Number);
                          const minutes = (h! * 60 + m! + n) % 1440;
                          setEnd(
                            `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
                          );
                        }}
                      >
                        {n} 分钟
                      </button>
                    ))}
                  </div>
                  {overnight && <p className="notice">跨天日程：结束时间在次日</p>}
                </>
              )}
            </>
          )}
          <label>
            课程
            <select name="course">
              <option value="">个人日程</option>
              {courses.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            提前提醒
            <select name="reminder">
              <option value="0">不提醒</option>
              {[15, 30, 60, 1440].map((n) => (
                <option key={n} value={n}>
                  {n === 1440 ? '一天' : `${n} 分钟`}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="important" />
            标为重要
          </label>
          <label>
            日程备注
            <textarea name="notes" maxLength={20000} />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? '正在保存…' : '保存日程'}
          </button>
        </form>
      </section>
    </div>
  );
}
