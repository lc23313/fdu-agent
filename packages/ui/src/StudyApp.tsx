import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ClientApi, Snapshot } from '../../client/src/client.ts';
import { dayKey } from '../../core/src/schedule.ts';
import {
  activeSession,
  effectiveSeconds,
  importPlan,
  recoverSession,
  sessionRecord,
  type StudyTask,
  type StudyBlock,
  type StudySession,
  type StudyRecord,
  type StudyData,
} from '../../study/src/model.ts';
import type { StudyCommand } from '../../study/src/commands.ts';
import { Modal } from './Modal.tsx';
import { StudyExcelImport } from './StudyExcelImport.tsx';
import './study.css';

const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const time = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const duration = (s: number) =>
  `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
const methodName = (m: string) =>
  ({ complete: '完成打卡', stopwatch: '正计时', pomodoro: '番茄钟' })[m];
const localTime = (s: string) => {
  const d = new Date(s);
  return `${dayKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};
type Target = { task: StudyTask; preset: boolean };
export function StudyApp({
  api,
  snapshot,
  reload,
  back,
}: {
  api: ClientApi;
  snapshot: Snapshot;
  reload: () => Promise<void>;
  back: () => void;
}) {
  const { data, pending, conflicts, error: syncError } = snapshot.study;
  const [tab, setTab] = useState('home'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now()),
    [picker, setPicker] = useState<Target | null>(null),
    [switchTo, setSwitchTo] = useState<Target | null>(null);
  const nextTask = useRef<Target | null>(null);
  const [taskEditor, setTaskEditor] = useState<StudyTask | null>(null),
    [recordEditor, setRecordEditor] = useState<StudyRecord | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(true),
    [date, setDate] = useState(dayKey(new Date())),
    [importOpen, setImportOpen] = useState(false);
  const [deleteTask, setDeleteTask] = useState<StudyTask | null>(null),
    [conflictOpen, setConflictOpen] = useState(false);
  const [recoverIds, setRecoverIds] = useState<string[]>([]);
  const [excelOpen, setExcelOpen] = useState(false);
  const raw = activeSession(data),
    current = raw ? recoverSession(raw, clock) : null;
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setSummaryOpen(true);
  }, [raw?.id, raw?.status]);
  const run = async (command: StudyCommand) => {
    setBusy(true);
    setError('');
    try {
      await api.study(command);
      await reload();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await reload();
      return false;
    } finally {
      setBusy(false);
    }
  };
  const choose = (target: Target) => {
    if (raw) {
      if (raw.status === 'summary') {
        nextTask.current = target;
        setSummaryOpen(true);
      } else setSwitchTo(target);
    } else setPicker(target);
  };
  const records = Object.values(data.records).sort((a, b) =>
    b.started_at.localeCompare(a.started_at),
  );
  const today = dayKey(new Date(clock)),
    monday = new Date(clock);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const total = (from: string) =>
    records.filter((r) => r.date >= from && r.date <= today).reduce((n, r) => n + r.seconds, 0);
  const unresolved = conflicts.filter((c) => !c.resolved);
  return (
    <section className={`study-app study-view-${tab}`} aria-label="学习打卡">
      <div className="study-heading">
        <button onClick={back}>← 返回 Plan</button>
        <small>记录实际学习，按自己的节奏</small>
      </div>
      <nav className="study-nav" aria-label="学习模块导航">
        {[
          ['home', '学习主页'],
          ['schedule', '预设安排'],
          ['temporary', '临时安排'],
          ['records', '学习记录'],
          ['tasks', '任务管理'],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id!)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {syncError && (
        <p role="status" className="notice">
          {syncError}
          <button onClick={() => void api.sync(true).then(reload)}>重试同步</button>
        </p>
      )}
      {pending > 0 && <p className="muted">{pending} 项学习操作已存本机，等待云端确认</p>}
      {unresolved.length > 0 && (
        <button className="study-conflict" onClick={() => setConflictOpen(true)}>
          有 {unresolved.length} 项跨设备冲突 · 查看并处理原始记录
        </button>
      )}
      {tab === 'home' && (
        <>
          <div className="study-stats">
            <article>
              <small>今日学习</small>
              <strong>{duration(total(today))}</strong>
            </article>
            <article>
              <small>本周学习</small>
              <strong>{duration(total(dayKey(monday)))}</strong>
            </article>
          </div>
          {current && raw && (
            <SessionCard
              session={current}
              now={clock}
              busy={busy}
              act={(action) => void run({ type: 'transition', before: raw, action })}
              summary={() => setSummaryOpen(true)}
            />
          )}
          <div className="study-shortcuts">
            <button onClick={() => setTab('schedule')}>
              预设安排<span>查看每周时间表 →</span>
            </button>
            <button onClick={() => setTab('temporary')}>
              临时安排<span>现在开始一件事 →</span>
            </button>
          </div>
          <h3>最近学习记录</h3>
          <RecordList records={records.slice(0, 6)} edit={setRecordEditor} />
        </>
      )}
      {tab !== 'home' && current && raw && (
        <SessionCard
          session={current}
          now={clock}
          busy={busy}
          act={(action) => void run({ type: 'transition', before: raw, action })}
          summary={() => setSummaryOpen(true)}
        />
      )}
      {tab === 'schedule' && (
        <>
          <div className="study-toolbar study-schedule-imports">
            <p>07:30—22:00</p>
            <button onClick={() => setExcelOpen(true)}>从 Excel 导入</button>
            <button
              disabled={!!data.meta['plan-import']?.imported}
              onClick={() => setImportOpen(true)}
            >
              {data.meta['plan-import']?.imported ? '已从 Plan 导入' : '从 Plan 导入'}
            </button>
          </div>
          <StudyTimetable data={data} run={run} choose={choose} busy={busy} />
        </>
      )}
      {tab === 'temporary' && (
        <TaskForm
          categories={Object.values(data.tasks).map((t) => t.category)}
          label="开始临时学习"
          submit={async (task) => {
            choose({ task, preset: false });
            return false;
          }}
          savePreset={(task) => run({ type: 'task', value: task, before: null })}
        />
      )}
      {tab === 'tasks' && (
        <>
          <div className="study-toolbar">
            <p>任务配置独立于预设时间块</p>
            <button
              onClick={() =>
                setTaskEditor({
                  id: crypto.randomUUID(),
                  name: '',
                  category: '',
                  mode: 'timer',
                  focus_minutes: 25,
                })
              }
            >
              新建任务
            </button>
          </div>
          {Object.values(data.tasks).length === 0 && (
            <p className="study-empty">还没有预设任务。添加任务后，可在周表中安排时间。</p>
          )}
          {Object.values(data.tasks).map((t) => (
            <article className="study-row" key={t.id}>
              <div>
                <strong>{t.name}</strong>
                <small>
                  {t.category || '未分类'} ·{' '}
                  {t.mode === 'complete' ? '完成模式' : `计时模式 · 专注 ${t.focus_minutes} 分钟`}
                </small>
              </div>
              <button onClick={() => choose({ task: t, preset: true })}>开始</button>
              <button onClick={() => setTaskEditor(t)}>编辑</button>
              <button onClick={() => setDeleteTask(t)}>删除</button>
            </article>
          ))}
        </>
      )}
      {tab === 'records' && (
        <>
          <div className="study-toolbar">
            <h3>按日期查看</h3>
            <input
              aria-label="记录日期"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <RecordList records={records.filter((r) => r.date === date)} edit={setRecordEditor} />
        </>
      )}
      {picker && (
        <StartDialog
          target={picker}
          busy={busy}
          close={() => setPicker(null)}
          start={async (method, focus, rest) => {
            if (
              await run({
                type: 'start',
                ...picker,
                method,
                focus_minutes: focus,
                rest_minutes: rest,
              })
            ) {
              setPicker(null);
              setTab('home');
            }
          }}
        />
      )}
      {switchTo && (
        <Modal title="结束当前学习" close={() => setSwitchTo(null)}>
          <p>
            将先结束「{raw?.task.name}」，确认保存学习总结后，再开始「{switchTo.task.name}」。
          </p>
          <button
            disabled={busy}
            onClick={async () => {
              if (!raw) return;
              if (await run({ type: 'transition', before: raw, action: 'end' })) {
                nextTask.current = switchTo;
                setSwitchTo(null);
                setSummaryOpen(true);
              }
            }}
          >
            结束并查看总结
          </button>
        </Modal>
      )}
      {raw?.status === 'summary' && summaryOpen && (
        <RecordDialog
          record={sessionRecord(raw)}
          summary
          close={() => setSummaryOpen(false)}
          busy={busy}
          save={async (record) => {
            if (await run({ type: 'save', before: raw, record })) {
              setSummaryOpen(false);
              const target = nextTask.current;
              nextTask.current = null;
              if (target) setPicker(target);
            }
          }}
        />
      )}
      {recordEditor && (
        <RecordDialog
          record={recordEditor}
          busy={busy}
          close={() => {
            setRecordEditor(null);
            setRecoverIds([]);
          }}
          save={async (record) => {
            const ok = await run(
              recoverIds.length
                ? { type: 'resolve', ids: recoverIds, record }
                : { type: 'record', before: recordEditor, value: record },
            );
            if (ok) {
              setRecordEditor(null);
              setRecoverIds([]);
            }
          }}
          remove={
            recoverIds.length
              ? undefined
              : async () => {
                  if (
                    await run({ type: 'deleteRecord', id: recordEditor.id, before: recordEditor })
                  )
                    setRecordEditor(null);
                }
          }
        />
      )}
      {taskEditor && (
        <Modal
          title={data.tasks[taskEditor.id] ? '修改任务' : '新建任务'}
          close={() => setTaskEditor(null)}
        >
          <TaskForm
            initial={taskEditor}
            categories={Object.values(data.tasks).map((t) => t.category)}
            label="保存任务"
            submit={async (value) => {
              const ok = await run({
                type: 'task',
                value,
                before: data.tasks[value.id] ? taskEditor : null,
              });
              if (ok) setTaskEditor(null);
              return ok;
            }}
          />
        </Modal>
      )}
      {deleteTask && (
        <Modal title="删除学习任务" close={() => setDeleteTask(null)}>
          <p>
            删除「{deleteTask.name}」和关联的{' '}
            {Object.values(data.blocks).filter((b) => b.task_id === deleteTask.id).length}{' '}
            个未来预设时间块？历史记录与已开始的会话会保留。
          </p>
          <button
            disabled={busy}
            onClick={async () => {
              if (
                await run({
                  type: 'deleteTask',
                  id: deleteTask.id,
                  before: deleteTask,
                  block_ids: Object.values(data.blocks)
                    .filter((b) => b.task_id === deleteTask.id)
                    .map((b) => b.id),
                })
              )
                setDeleteTask(null);
            }}
          >
            确认删除
          </button>
        </Modal>
      )}
      {importOpen && (
        <ImportDialog
          data={data}
          tasks={snapshot.tasks}
          close={() => setImportOpen(false)}
          save={async () => {
            if (await run({ type: 'importPlan' })) setImportOpen(false);
          }}
        />
      )}
      {excelOpen && <StudyExcelImport data={data} close={() => setExcelOpen(false)} run={run} />}
      {conflictOpen && (
        <Modal title="跨设备冲突" close={() => setConflictOpen(false)} wide>
          <p>这些操作未覆盖云端数据。原始操作会保留；请核对两个设备的学习时间，再决定如何记录。</p>
          {unresolved.map((c) => (
            <article key={c.operation.id}>
              <p>
                {new Date(c.operation.at).toLocaleString()} · {c.reason}
              </p>
              <details>
                <summary>查看原始操作</summary>
                <pre className="study-raw">{JSON.stringify(c.operation, null, 2)}</pre>
              </details>
            </article>
          ))}
          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(conflicts, null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'study-conflicts.json';
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            导出全部原始操作
          </button>
          {(() => {
            const sessions = unresolved.flatMap((c) =>
              c.operation.changes
                .filter((v) => v.collection === 'sessions' && v.after)
                .map((v) => v.after as StudySession),
            );
            const latest = sessions.at(-1);
            return latest ? (
              <button
                onClick={() => {
                  const s = recoverSession(latest);
                  if (!s.ended_at) {
                    s.intervals
                      .filter((i) => !i.end)
                      .forEach((i) => {
                        i.end = new Date().toISOString();
                      });
                    s.ended_at = new Date().toISOString();
                  }
                  const record = sessionRecord(s);
                  record.id = crypto.randomUUID();
                  setRecoverIds(
                    unresolved
                      .filter((c) =>
                        c.operation.changes.some(
                          (v) => v.collection === 'sessions' && v.id === latest.id,
                        ),
                      )
                      .map((c) => c.operation.id),
                  );
                  setRecordEditor(record);
                  setConflictOpen(false);
                }}
              >
                核对最近冲突会话并另存记录
              </button>
            ) : null;
          })()}
          <button
            disabled={busy}
            onClick={async () => {
              if (await run({ type: 'resolve', ids: unresolved.map((c) => c.operation.id) }))
                setConflictOpen(false);
            }}
          >
            采用云端结果，保留原始操作备查
          </button>
        </Modal>
      )}
    </section>
  );
}

function SessionCard({
  session: s,
  now,
  busy,
  act,
  summary,
}: {
  session: StudySession;
  now: number;
  busy: boolean;
  act: (a: 'pause' | 'resume' | 'end' | 'rest' | 'next') => void;
  summary: () => void;
}) {
  const seconds = effectiveSeconds(s, now);
  return (
    <article className="study-session">
      <small>当前学习 · {methodName(s.method)}</small>
      <h3>{s.task.name}</h3>
      <strong className="study-clock">{duration(seconds)}</strong>
      {s.method === 'pomodoro' && (
        <p>
          第 {s.round} 轮 ·{' '}
          {s.status === 'focus'
            ? `本轮剩余 ${duration(Math.max(0, s.focus_minutes * 60 - effectiveSeconds(s, now, s.round)))}`
            : s.status === 'rest'
              ? `休息剩余 ${duration(Math.max(0, Math.ceil((Date.parse(s.rest_until!) - now) / 1000)))}`
              : s.status === 'awaiting'
                ? '本轮已结束，下一步由你决定'
                : ''}
        </p>
      )}
      <div className="study-toolbar">
        {s.status === 'focus' && (
          <button disabled={busy} onClick={() => act('pause')}>
            暂停
          </button>
        )}
        {s.status === 'paused' && (
          <button disabled={busy} onClick={() => act('resume')}>
            恢复
          </button>
        )}
        {s.status === 'awaiting' && !s.rest_until && (
          <button disabled={busy} onClick={() => act('rest')}>
            休息 {s.rest_minutes} 分钟
          </button>
        )}
        {['awaiting', 'rest'].includes(s.status) && (
          <button disabled={busy} onClick={() => act('next')}>
            开始下一轮
          </button>
        )}
        {s.status === 'summary' ? (
          <button onClick={summary}>确认学习总结</button>
        ) : (
          <button className="primary" disabled={busy} onClick={() => act('end')}>
            结束学习
          </button>
        )}
      </div>
      {dayKey(s.started_at) !== dayKey(new Date(now)) ||
      now - Date.parse(s.started_at) > 21600000 ? (
        <p>计时已跨日或超过 6 小时，结束时请核对实际时长。</p>
      ) : null}
    </article>
  );
}
function TaskForm({
  initial,
  categories,
  label,
  submit,
  savePreset,
}: {
  initial?: StudyTask;
  categories: string[];
  label: string;
  submit: (t: StudyTask) => Promise<boolean>;
  savePreset?: (t: StudyTask) => Promise<boolean>;
}) {
  const [task, setTask] = useState<StudyTask>(
    () =>
      initial ?? {
        id: crypto.randomUUID(),
        name: '',
        category: '',
        mode: 'timer',
        focus_minutes: 25,
      },
  );
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const handle = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await submit(task);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="study-form" onSubmit={handle}>
      <label>
        任务名称
        <input
          required
          maxLength={200}
          value={task.name}
          onChange={(e) => {
            setSaved(false);
            setTask({ ...task, name: e.target.value });
          }}
        />
      </label>
      <label>
        分类（可选，可自定义）
        <input
          list="study-categories"
          maxLength={100}
          value={task.category}
          onChange={(e) => setTask({ ...task, category: e.target.value })}
        />
      </label>
      <datalist id="study-categories">
        {[...new Set(categories)].filter(Boolean).map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <label>
        打卡方式
        <select
          aria-label="打卡方式"
          value={task.mode}
          onChange={(e) => setTask({ ...task, mode: e.target.value as StudyTask['mode'] })}
        >
          <option value="timer">计时模式</option>
          <option value="complete">完成模式</option>
        </select>
      </label>
      {task.mode === 'timer' && (
        <label>
          默认番茄钟专注时长（分钟）
          <input
            type="number"
            min={1}
            max={360}
            required
            value={task.focus_minutes}
            onChange={(e) => setTask({ ...task, focus_minutes: Number(e.target.value) })}
          />
        </label>
      )}
      <div className="study-toolbar">
        <button className="primary" disabled={busy}>
          {label}
        </button>
        {savePreset && (
          <button
            type="button"
            disabled={busy || saved || !task.name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                if (await savePreset({ ...task, id: crypto.randomUUID() })) setSaved(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {saved ? '已保存为预设任务' : '保存为预设任务'}
          </button>
        )}
      </div>
    </form>
  );
}
function StartDialog({
  target,
  busy,
  close,
  start,
}: {
  target: Target;
  busy: boolean;
  close: () => void;
  start: (m: 'complete' | 'stopwatch' | 'pomodoro', f: number, r: number) => Promise<void>;
}) {
  const [focus, setFocus] = useState(target.task.focus_minutes),
    [rest, setRest] = useState(5),
    [method, setMethod] = useState<'stopwatch' | 'pomodoro'>('stopwatch');
  return (
    <Modal title={target.task.mode === 'complete' ? '确认完成' : '选择计时方式'} close={close}>
      <h3>{target.task.name}</h3>
      {target.task.mode === 'complete' ? (
        <>
          <p>确认完成这次学习？只记录完成，不填写学习时长。</p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void start('complete', focus, rest)}
          >
            确认完成
          </button>
        </>
      ) : (
        <form
          className="study-form"
          onSubmit={(e) => {
            e.preventDefault();
            void start(method, focus, rest);
          }}
        >
          <label>
            计时方式
            <select
              aria-label="计时方式"
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
            >
              <option value="stopwatch">正计时</option>
              <option value="pomodoro">番茄钟</option>
            </select>
          </label>
          {method === 'pomodoro' && (
            <>
              <label>
                本次专注（分钟）
                <input
                  type="number"
                  required
                  min={1}
                  max={360}
                  value={focus}
                  onChange={(e) => setFocus(Number(e.target.value))}
                />
              </label>
              <label>
                本次休息（分钟）
                <input
                  type="number"
                  required
                  min={1}
                  max={120}
                  value={rest}
                  onChange={(e) => setRest(Number(e.target.value))}
                />
              </label>
              <p>每次一轮；结束后由你决定休息、继续或结束。</p>
            </>
          )}
          <button className="primary" disabled={busy}>
            开始学习
          </button>
        </form>
      )}
    </Modal>
  );
}
function RecordList({ records, edit }: { records: StudyRecord[]; edit: (r: StudyRecord) => void }) {
  return records.length ? (
    <div>
      {records.map((r) => (
        <article className="study-row" key={r.id}>
          <div>
            <strong>{r.task.name}</strong>
            <small>
              {r.date} · {r.task.category || '未分类'} · {methodName(r.method)}
              {r.method === 'pomodoro' ? ` · ${r.rounds} 轮${r.early ? ' · 提前结束' : ''}` : ''}
            </small>
          </div>
          <span>{r.method === 'complete' ? '已完成' : duration(r.seconds)}</span>
          <button onClick={() => edit(r)}>修改</button>
        </article>
      ))}
    </div>
  ) : (
    <p className="study-empty">暂无学习记录。完成或结束一次学习后，会显示在这里。</p>
  );
}
function RecordDialog({
  record,
  summary = false,
  busy,
  close,
  save,
  remove,
}: {
  record: StudyRecord;
  summary?: boolean;
  busy: boolean;
  close: () => void;
  save: (r: StudyRecord) => Promise<void>;
  remove?: () => Promise<void>;
}) {
  const [value, setValue] = useState(record),
    [confirmed, setConfirmed] = useState(false),
    [deleting, setDeleting] = useState(false);
  const long =
    Date.parse(value.ended_at) - Date.parse(value.started_at) > 21600000 ||
    dayKey(value.started_at) !== dayKey(value.ended_at);
  return (
    <Modal title={summary ? '学习总结' : '修改学习记录'} close={close}>
      <form
        className="study-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save(value);
        }}
      >
        {summary ? (
          <h3>{value.task.name}</h3>
        ) : (
          <>
            <label>
              任务名称
              <input
                required
                maxLength={200}
                value={value.task.name}
                onChange={(e) =>
                  setValue({ ...value, task: { ...value.task, name: e.target.value } })
                }
              />
            </label>
            <label>
              分类
              <input
                maxLength={100}
                value={value.task.category}
                onChange={(e) =>
                  setValue({ ...value, task: { ...value.task, category: e.target.value } })
                }
              />
            </label>
          </>
        )}
        <p>
          {methodName(value.method)}
          {value.method === 'pomodoro'
            ? ` · ${value.rounds} 轮 · ${value.early ? '提前结束' : '完成本轮'}`
            : ''}
        </p>
        <label>
          日期
          <input
            required
            type="date"
            value={value.date}
            onChange={(e) => setValue({ ...value, date: e.target.value })}
          />
        </label>
        <label>
          开始时间
          <input
            required
            type="datetime-local"
            step="1"
            value={localTime(value.started_at)}
            onChange={(e) => {
              if (e.target.value)
                setValue({ ...value, started_at: new Date(e.target.value).toISOString() });
            }}
          />
        </label>
        <label>
          结束时间
          <input
            required
            type="datetime-local"
            step="1"
            value={localTime(value.ended_at)}
            onChange={(e) => {
              if (e.target.value)
                setValue({ ...value, ended_at: new Date(e.target.value).toISOString() });
            }}
          />
        </label>
        {value.method !== 'complete' && (
          <label>
            实际有效学习时长（秒，可修正）
            <input
              required
              type="number"
              min={0}
              max={604800}
              value={value.seconds}
              onChange={(e) => setValue({ ...value, seconds: Number(e.target.value) })}
            />
            <small>{duration(value.seconds)}</small>
          </label>
        )}
        {long && (
          <label className="study-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              required
            />
            已核对跨日或超过 6 小时的实际学习时长
          </label>
        )}
        <button className="primary" disabled={busy || (long && !confirmed)}>
          确认保存
        </button>
        {remove &&
          (deleting ? (
            <button type="button" disabled={busy} onClick={() => void remove()}>
              确认删除这条记录
            </button>
          ) : (
            <button type="button" onClick={() => setDeleting(true)}>
              删除记录
            </button>
          ))}
      </form>
    </Modal>
  );
}
function ImportDialog({
  data,
  tasks,
  close,
  save,
}: {
  data: StudyData;
  tasks: Snapshot['tasks'];
  close: () => void;
  save: () => Promise<void>;
}) {
  const [preview] = useState(() => importPlan(tasks, data));
  const blocks = Object.values(preview.data.blocks).filter((b) => !data.blocks[b.id]);
  return (
    <Modal title="从 Plan 一次性导入" close={close} wide>
      <p>复制 Plan 中的时间段安排，保留星期和时长，相同名称共用任务配置。原 Plan 不受影响。</p>
      <p>可导入 {blocks.length} 个时间块。导入后可在任务管理中调整打卡方式。</p>
      {blocks.map((b) => (
        <p key={b.id}>
          {weekdays[b.day]} {time(b.start)}—{time(b.end)} · {preview.data.tasks[b.task_id]?.name}
        </p>
      ))}
      {preview.skipped.length > 0 && (
        <p role="status">
          以下安排超出 07:30—22:00、不符合半小时刻度或发生重叠，未导入：{preview.skipped.join('、')}
        </p>
      )}
      {!blocks.length && <p>当前 Plan 没有可导入的时间段。请先在 Plan 中录入原表。</p>}
      <button className="primary" disabled={!blocks.length} onClick={() => void save()}>
        确认一次性导入
      </button>
    </Modal>
  );
}

function StudyTimetable({
  data,
  busy,
  run,
  choose,
}: {
  data: StudyData;
  busy: boolean;
  run: (c: StudyCommand) => Promise<boolean>;
  choose: (t: Target) => void;
}) {
  const [editing, setEditing] = useState(false),
    [day, setDay] = useState((new Date().getDay() + 6) % 7),
    [block, setBlock] = useState<StudyBlock | null>(null),
    [original, setOriginal] = useState<StudyBlock | null>(null);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 700px)').matches);
  useEffect(() => {
    const mq = matchMedia('(max-width: 700px)');
    const change = () => setMobile(mq.matches);
    mq.addEventListener('change', change);
    return () => mq.removeEventListener('change', change);
  }, []);
  const grid = useRef<HTMLDivElement>(null),
    gesture = useRef<{
      day: number;
      slot: number;
      block?: StudyBlock;
      kind: 'create' | 'move' | 'start' | 'end';
      moved: boolean;
    } | null>(null),
    touch = useRef<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<StudyBlock | null>(null);
  const point = (x: number, y: number) => {
    const rect = grid.current!.getBoundingClientRect();
    return {
      day: mobile ? day : Math.max(0, Math.min(6, Math.floor((x - rect.left) / (rect.width / 7)))),
      slot: Math.max(0, Math.min(28, Math.floor((y - rect.top) / 36))),
    };
  };
  const days = mobile ? [day] : [0, 1, 2, 3, 4, 5, 6];
  const now = new Date(),
    today = (now.getDay() + 6) % 7,
    minute = now.getHours() * 60 + now.getMinutes();
  const allBlocks = Object.values(data.blocks),
    visibleBlocks = allBlocks.filter((b) => !mobile || b.day === day);
  const plannedMinutes = visibleBlocks.reduce((n, b) => n + b.end - b.start, 0);
  return (
    <>
      <div className="study-schedule-overview">
        <div>
          <h3>{mobile ? `${weekdays[day]}的预设` : '每周预设'}</h3>
          <p>
            {visibleBlocks.length} 个时间块 · 已安排 {Number((plannedMinutes / 60).toFixed(1))} 小时
          </p>
        </div>
        <span className="study-schedule-note">
          <i className="study-legend-scheduled" />
          已安排
          <i className="study-legend-empty" />
          未安排
        </span>
      </div>
      <div className="study-toolbar">
        <button
          aria-pressed={editing}
          onClick={() => {
            setEditing(!editing);
            gesture.current = null;
            setPreview(null);
          }}
        >
          {editing ? '完成编辑' : '编辑时间表'}
        </button>
        {editing && (
          <button
            onClick={() => {
              setOriginal(null);
              setBlock({
                id: crypto.randomUUID(),
                day,
                start: 450,
                end: 480,
                task_id: Object.keys(data.tasks)[0] ?? '',
              });
            }}
          >
            添加时间块
          </button>
        )}
        <small>{editing ? '拖选空白创建；拖动时间块或上下边缘调整' : '点击任务开始学习'}</small>
        <button
          onClick={() => {
            setDay(today);
            if (grid.current)
              grid.current.parentElement!.parentElement!.scrollTop = Math.max(
                0,
                ((minute - 450) / 30) * 36 - 72,
              );
          }}
        >
          定位现在
        </button>
      </div>
      {mobile && (
        <nav className="study-days" aria-label="切换星期">
          {weekdays.map((d, i) => (
            <button key={d} aria-label={d} aria-pressed={day === i} onClick={() => setDay(i)}>
              <span>{d}</span>
              <small>{allBlocks.filter((b) => b.day === i).length} 项</small>
            </button>
          ))}
        </nav>
      )}
      <div
        className="study-timetable-scroll"
        onTouchStart={(e) => {
          touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
        }}
        onTouchEnd={(e) => {
          if (!mobile || editing || !touch.current) return;
          const dx = e.changedTouches[0]!.clientX - touch.current.x,
            dy = e.changedTouches[0]!.clientY - touch.current.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5)
            setDay((day + (dx < 0 ? 1 : 6)) % 7);
          touch.current = null;
        }}
      >
        <div
          className="study-table-head"
          style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}
        >
          <span>时间</span>
          {days.map((d) => (
            <strong key={d} className={d === today ? 'is-today' : ''}>
              <span>
                {weekdays[d]}
                {d === today && <i>今天</i>}
              </span>
              <small>{['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'][d]}</small>
            </strong>
          ))}
        </div>
        <div className="study-table-body">
          <div className="study-hours">
            {Array.from({ length: 30 }, (_, i) => (
              <span
                key={i}
                className={(450 + i * 30) % 60 === 0 ? 'is-hour' : ''}
                style={{ top: i * 36 }}
              >
                {time(450 + i * 30)}
              </span>
            ))}
          </div>
          <div
            ref={grid}
            className={`study-grid${editing ? ' editing' : ''}`}
            style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
            onPointerDown={(e) => {
              if (!editing || busy || e.button !== 0) return;
              const p = point(e.clientX, e.clientY);
              const target = (e.target as HTMLElement).closest<HTMLElement>('[data-block]');
              const b = target ? data.blocks[target.dataset.block!] : undefined;
              const edge = (e.target as HTMLElement).dataset.edge as 'start' | 'end' | undefined;
              gesture.current = {
                ...p,
                block: b,
                kind: edge ?? (b ? 'move' : 'create'),
                moved: false,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const g = gesture.current;
              if (!g) return;
              const p = point(e.clientX, e.clientY);
              if (p.slot !== g.slot || p.day !== g.day) g.moved = true;
              const delta = (p.slot - g.slot) * 30;
              let b: StudyBlock;
              if (g.block) {
                b = { ...g.block };
                if (g.kind === 'move') {
                  const length = b.end - b.start;
                  b.start = Math.min(1320 - length, Math.max(450, b.start + delta));
                  b.end = b.start + length;
                  b.day = p.day;
                } else if (g.kind === 'start')
                  b.start = Math.min(b.end - 30, Math.max(450, b.start + delta));
                else b.end = Math.max(b.start + 30, Math.min(1320, b.end + delta));
              } else
                b = {
                  id: 'preview',
                  day: g.day,
                  start: 450 + Math.min(g.slot, p.slot) * 30,
                  end: 480 + Math.max(g.slot, p.slot) * 30,
                  task_id: Object.keys(data.tasks)[0] ?? '',
                };
              setPreview(b);
            }}
            onPointerCancel={() => {
              gesture.current = null;
              setPreview(null);
            }}
            onPointerUp={(e) => {
              const g = gesture.current;
              if (!g) return;
              gesture.current = null;
              e.currentTarget.releasePointerCapture(e.pointerId);
              const candidate = preview;
              setPreview(null);
              if (g.block) {
                if (g.moved && candidate)
                  void run({ type: 'block', value: candidate, before: g.block });
                else {
                  setOriginal(g.block);
                  setBlock(g.block);
                }
              } else {
                setOriginal(null);
                setBlock({
                  ...(candidate ?? {
                    day: g.day,
                    start: 450 + g.slot * 30,
                    end: 480 + g.slot * 30,
                    task_id: Object.keys(data.tasks)[0] ?? '',
                  }),
                  id: crypto.randomUUID(),
                });
              }
            }}
          >
            {days.map((d) => (
              <div className={`study-day-column${d >= 5 ? ' is-weekend' : ''}`} key={d}>
                {Array.from({ length: 29 }, (_, i) => (
                  <div
                    className={`study-cell${(450 + i * 30) % 60 === 30 ? ' is-half' : ''}`}
                    key={i}
                  />
                ))}
                {Object.values(data.blocks)
                  .filter((b) => b.day === d)
                  .map((b) => (
                    <button
                      key={b.id}
                      className="study-block"
                      data-block={b.id}
                      data-compact={b.end - b.start === 30}
                      aria-label={`${data.tasks[b.task_id]?.name} ${weekdays[d]} ${time(b.start)}—${time(b.end)}`}
                      title={`${data.tasks[b.task_id]?.name} · ${time(b.start)}—${time(b.end)} · ${b.end - b.start} 分钟`}
                      style={{
                        top: ((b.start - 450) / 30) * 36,
                        height: ((b.end - b.start) / 30) * 36,
                      }}
                      onClick={() => {
                        if (!editing && data.tasks[b.task_id])
                          choose({ task: data.tasks[b.task_id]!, preset: true });
                      }}
                      onKeyDown={(e) => {
                        if (editing && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          setOriginal(b);
                          setBlock(b);
                        }
                      }}
                    >
                      <span>{data.tasks[b.task_id]?.name}</span>
                      <small>
                        {time(b.start)}—{time(b.end)}
                      </small>
                      {editing && (
                        <>
                          <i data-edge="start" className="study-edge top" />
                          <i data-edge="end" className="study-edge bottom" />
                        </>
                      )}
                      {b.end - b.start >= 90 && (
                        <em>
                          {data.tasks[b.task_id]?.category ||
                            (data.tasks[b.task_id]?.mode === 'complete'
                              ? '完成打卡'
                              : '计时学习')}{' '}
                          · {b.end - b.start} 分钟
                        </em>
                      )}
                    </button>
                  ))}
                {preview?.day === d && (
                  <div
                    className="study-block study-preview"
                    style={{
                      top: ((preview.start - 450) / 30) * 36,
                      height: ((preview.end - preview.start) / 30) * 36,
                    }}
                  >
                    {time(preview.start)}—{time(preview.end)}
                  </div>
                )}
                {d === today && minute >= 450 && minute < 1320 && (
                  <div
                    className="study-now-line"
                    style={{ top: ((minute - 450) / 30) * 36 }}
                    aria-label={`当前时间 ${time(minute)}`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {block && (
        <Modal title={original ? '编辑时间块' : '创建时间块'} close={() => setBlock(null)}>
          <form
            className="study-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run({ type: 'block', value: block, before: original })) setBlock(null);
            }}
          >
            <label>
              预设任务
              <select
                required
                aria-label="预设任务"
                value={block.task_id}
                onChange={(e) => setBlock({ ...block, task_id: e.target.value })}
              >
                <option value="">请选择任务</option>
                {Object.values(data.tasks).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {!Object.keys(data.tasks).length && <p>请先在任务管理中添加任务配置。</p>}
            <label>
              星期
              <select
                aria-label="星期"
                value={block.day}
                onChange={(e) => setBlock({ ...block, day: Number(e.target.value) })}
              >
                {weekdays.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            {(['start', 'end'] as const).map((key) => (
              <label key={key}>
                {key === 'start' ? '开始时间' : '结束时间'}
                <select
                  aria-label={key === 'start' ? '开始时间' : '结束时间'}
                  value={block[key]}
                  onChange={(e) => setBlock({ ...block, [key]: Number(e.target.value) })}
                >
                  {Array.from({ length: 30 }, (_, i) => 450 + i * 30).map((n) => (
                    <option key={n} value={n}>
                      {time(n)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button className="primary" disabled={busy}>
              保存时间块
            </button>
            {original && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOriginal(null);
                    setBlock({ ...block, id: crypto.randomUUID() });
                  }}
                >
                  复制为新时间块
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (await run({ type: 'deleteBlock', id: original.id, before: original }))
                      setBlock(null);
                  }}
                >
                  删除此时间块
                </button>
              </>
            )}
          </form>
        </Modal>
      )}
    </>
  );
}
