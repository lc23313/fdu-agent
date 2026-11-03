import { Reminders } from './Reminders.tsx';
import { readBackup } from '../../core/src/backup.ts';
import { NavIcon } from './NavIcon.tsx';
import brandIcon from '../../../apps/pwa/public/icon-192.png';
import { NewSchedule } from './NewSchedule.tsx';
import { AiAssistant, DraftReview } from './AiAssistant.tsx';
import { SetupGuide } from './SetupGuide.tsx';
import { ScheduleOverview, countdown } from './ScheduleOverview.tsx';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { ClientApi, Snapshot } from '../../client/src/client.ts';
import { LearningConnection } from './LearningConnection.tsx';
import type { Task, TaskPatch } from '../../core/src/task.ts';
import { PlanCalendar, dateKey, occursOn } from './PlanCalendar.tsx';
import { submissionLabel } from '../../elearning/src/schema.ts';
import { Courses } from './Courses.tsx';
const views = [
  ['today', '今天', '◉'],
  ['inbox', '收集箱', '▣'],
  ['upcoming', '计划', '▦'],
  ['completed', '已完成', '✓'],
  ['courses', '课程', '▤'],
  ['ai', 'AI 助手', '✧'],
] as const;
const localTime = (v: string | null) =>
  v ? `${dateKey(v)}T${new Date(v).toTimeString().slice(0, 5)}` : '';
const iso = (v: FormDataEntryValue | null) => (v ? new Date(String(v)).toISOString() : null);
function Detail({
  task,
  tasks,
  courses,
  save,
  remove,
  create,
  close,
  assignment,
}: {
  task: Task;
  tasks: Task[];
  courses: Snapshot['courses'];
  assignment?: Snapshot['learning']['assignments'][number];
  save: (id: string, p: TaskPatch) => Promise<void>;
  remove: (id: string) => Promise<void>;
  create: (t: string, p: TaskPatch) => Promise<unknown>;
  close: () => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [child, setChild] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    try {
      if (
        data.get('start') &&
        data.get('due') &&
        new Date(String(data.get('start'))) > new Date(String(data.get('due')))
      )
        throw new Error('截止时间不能早于开始时间');
      await save(task.id, {
        title: String(data.get('title')),
        description: String(data.get('description')),
        notes: String(data.get('notes')),
        status: String(data.get('status')) as Task['status'],
        priority: Number(data.get('priority')),
        start_at: iso(data.get('start')),
        due_at: iso(data.get('due')),
        course_id: String(data.get('course')) || null,
        parent_id: String(data.get('parent')) || null,
        tags: String(data.get('tags'))
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        reminders: String(data.get('reminders'))
          .split(/[,，]/)
          .filter((v) => v.trim())
          .map((v) => ({ minutes_before: Number(v) })),
      });
      close();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="fdu-detail" aria-label="任务详情">
      <div className="detail-heading">
        <span>任务详情</span>
        <button onClick={close} aria-label="关闭任务详情">
          ✕
        </button>
      </div>
      {assignment && (
        <section className="assignment-row">
          <b>eLearning 原始信息</b>
          <p>{assignment.original_title}</p>
          <p>
            官方截止：
            {assignment.original_due_at
              ? new Date(assignment.original_due_at).toLocaleString('zh-CN')
              : '未设置截止'}
          </p>
          <p>Canvas 提交：{submissionLabel(assignment.submission_state)}</p>
          <p>
            提交时间：
            {assignment.submitted_at
              ? new Date(assignment.submitted_at).toLocaleString('zh-CN')
              : '未提供'}
          </p>
          <small>个人标题、日期、备注与完成状态不会被课程刷新覆盖。</small>
          <a href={assignment.official_url} target="_blank" rel="noreferrer">
            打开官方作业 ↗
          </a>
        </section>
      )}
      <form onSubmit={submit}>
        <label>
          标题
          <input name="title" defaultValue={task.title} required maxLength={200} />
        </label>
        <div className="form-grid">
          <label>
            个人状态
            <select aria-label="个人状态" name="status" defaultValue={task.status}>
              <option value="todo">待办</option>
              <option value="in_progress">进行中</option>
              <option value="completed">已完成</option>
            </select>
          </label>
          <label>
            优先级
            <select aria-label="优先级" name="priority" defaultValue={task.priority}>
              <option value="0">无优先级</option>
              <option value="1">低</option>
              <option value="2">中</option>
              <option value="3">高</option>
            </select>
          </label>
          <label>
            开始时间
            <input type="datetime-local" name="start" defaultValue={localTime(task.start_at)} />
          </label>
          <label>
            截止时间
            <input
              type="datetime-local"
              aria-label="截止时间"
              name="due"
              defaultValue={localTime(task.due_at)}
            />
            <div className="date-shortcuts">
              {[
                ['今天', 0],
                ['明天', 1],
                ['一周后', 7],
              ].map(([label, offset]) => (
                <button
                  key={label}
                  type="button"
                  onClick={(e) => {
                    const input = e.currentTarget
                      .closest('form')!
                      .elements.namedItem('due') as HTMLInputElement;
                    const d = new Date();
                    d.setDate(d.getDate() + Number(offset));
                    input.value = `${dateKey(d)}T18:00`;
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
        </div>
        <label>
          课程
          <select aria-label="课程" name="course" defaultValue={task.course_id ?? ''}>
            <option value="">个人任务</option>
            {courses.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          父任务
          <select aria-label="父任务" name="parent" defaultValue={task.parent_id ?? ''}>
            <option value="">独立任务</option>
            {tasks
              .filter((t) => t.id !== task.id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          标签
          <input name="tags" defaultValue={task.tags.join('，')} placeholder="用逗号分隔" />
        </label>
        <label>
          截止前提醒（分钟）
          <input
            name="reminders"
            defaultValue={task.reminders.map((r) => r.minutes_before).join(',')}
            placeholder="例如 60,1440"
          />
        </label>
        <small>提醒配置会同步。系统通知与 iPhone 推送将在后续阶段提供。</small>
        <label>
          任务描述
          <textarea name="description" defaultValue={task.description} rows={2} />
        </label>
        <label>
          备注
          <textarea name="notes" defaultValue={task.notes} rows={4} />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="detail-actions">
          <button className="primary" disabled={busy}>
            {busy ? '保存中…' : '保存任务'}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (confirm('删除此任务？子任务会保留。'))
                void remove(task.id)
                  .then(close)
                  .catch((e) => setError(String(e)));
            }}
          >
            删除任务
          </button>
        </div>
      </form>
      <section className="subtasks">
        <h3>子任务</h3>
        {tasks
          .filter((t) => t.parent_id === task.id)
          .map((t) => (
            <div key={t.id}>
              <input
                aria-label={`完成 ${t.title}`}
                type="checkbox"
                checked={t.status === 'completed'}
                onChange={() =>
                  void save(t.id, {
                    status: t.status === 'completed' ? 'todo' : 'completed',
                  }).catch((e) => setError(String(e)))
                }
              />
              <span>{t.title}</span>
              <button
                onClick={() => {
                  if (confirm('删除子任务？')) void remove(t.id).catch((e) => setError(String(e)));
                }}
              >
                删除
              </button>
            </div>
          ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create(child, { parent_id: task.id, course_id: task.course_id })
              .then(() => setChild(''))
              .catch((e) => setError(String(e)));
          }}
        >
          <input
            aria-label="子任务标题"
            placeholder="添加一个小步骤"
            value={child}
            onChange={(e) => setChild(e.target.value)}
            required
          />
          <button>添加</button>
        </form>
      </section>
      <small>个人完成状态独立于 eLearning 提交状态。</small>
    </aside>
  );
}
export function TodoApp({
  api,
  assistant,
  library,
  modelSettings,
}: {
  api: ClientApi;
  assistant?: ReactNode;
  library?: ReactNode;
  modelSettings?: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(''),
    [view, setView] = useState('today'),
    [query, setQuery] = useState(''),
    [course, setCourse] = useState(''),
    [priority, setPriority] = useState(''),
    [source, setSource] = useState(''),
    [status, setStatus] = useState(''),
    [tag, setTag] = useState(''),
    [sort, setSort] = useState('due'),
    [selected, setSelected] = useState<string | null>(null),
    [title, setTitle] = useState(''),
    [settings, setSettings] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [update, setUpdate] = useState(false),
    [day, setDay] = useState(''),
    [anchor, setAnchor] = useState(() => dateKey(new Date())),
    [planMode, setPlanMode] = useState(() => localStorage.getItem('fdu-plan-view') || 'list'),
    [models, setModels] = useState(false),
    [newSchedule, setNewSchedule] = useState(false);
  const refresh = () =>
    api
      .snapshot()
      .then(setSnapshot)
      .catch((e) => setError(String(e)));
  const run = async (fn: () => Promise<unknown>) => {
    try {
      setError('');
      await fn();
      await refresh();
      void api
        .sync()
        .then(refresh)
        .catch(() => refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refresh();
      throw e;
    }
  };
  useEffect(() => {
    void refresh();
    const tick = () => {
      setOnline(navigator.onLine);
      if (document.visibilityState !== 'hidden')
        void api
          .sync()
          .catch(() => {})
          .finally(refresh);
    };
    window.addEventListener('online', tick);
    window.addEventListener('offline', tick);
    document.addEventListener('visibilitychange', tick);
    const updated = () => setUpdate(true);
    window.addEventListener('fdu-update', updated);
    const interval = setInterval(tick, 30000);
    const mirror = setInterval(refresh, 2000);
    tick();
    return () => {
      clearInterval(interval);
      clearInterval(mirror);
      window.removeEventListener('online', tick);
      window.removeEventListener('offline', tick);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('fdu-update', updated);
    };
  }, [api]);
  useEffect(() => {
    if (!snapshot) return;
    const theme = snapshot.catalog.theme;
    const root = document.documentElement;
    root.dataset.fduTheme = theme;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      root.classList.toggle('dark', dark);
      root.classList.toggle('light', !dark);
      root.style.colorScheme = dark ? 'dark' : 'light';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [snapshot?.catalog.theme]);
  useEffect(() => {
    const openModels = () => {
      setSettings(true);
      setModels(true);
    };
    window.addEventListener('fdu-model-settings', openModels);
    return () => window.removeEventListener('fdu-model-settings', openModels);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        setSelected(null);
        setSettings(false);
        setNewSchedule(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('fdu-search')?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        document.getElementById('quick-task')?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  if (!snapshot)
    return (
      <div className="fdu-app loading">
        <h1>FDU Agent</h1>
        <p role="status">正在读取本机任务…</p>
        {error && (
          <p role="alert">
            {error}
            <button onClick={() => void refresh()}>重试</button>
          </p>
        )}
      </div>
    );
  const { tasks, catalog, courses } = snapshot;
  const today = dateKey(new Date());
  const officialDue = (t: Task) =>
    snapshot.learning.assignments.find((a) => a.task_id === t.id)?.original_due_at;
  const isToday = (t: Task) =>
    !!(
      (t.due_at && dateKey(t.due_at) <= today) ||
      (t.start_at && dateKey(t.start_at) <= today) ||
      (officialDue(t) && dateKey(officialDue(t)!) <= today)
    );
  const incomplete = tasks.filter((t) => t.status !== 'completed');
  const unscheduled = incomplete.filter((t) => !t.start_at && !t.due_at);
  const active = tasks.find((t) => t.id === selected);
  let filtered = tasks.filter((t) =>
    view === 'completed' ? t.status === 'completed' : t.status !== 'completed',
  );
  if (view === 'inbox') filtered = filtered.filter((t) => !t.start_at && !t.due_at);
  if (view === 'today') filtered = filtered.filter(isToday);
  if (view === 'upcoming')
    filtered = filtered.filter((t) => {
      const at = t.due_at ?? t.start_at;
      return (
        at &&
        ((planMode === 'week' || planMode === 'month') && day
          ? occursOn(t, day)
          : dateKey(at) >= today)
      );
    });
  const matches = (t: Task) =>
    (!course || t.course_id === course) &&
    (!source ||
      (source === 'canvas') === snapshot.learning.assignments.some((a) => a.task_id === t.id)) &&
    (!priority || t.priority === Number(priority)) &&
    (!status || t.status === status) &&
    (!tag || t.tags.includes(tag)) &&
    `${t.title} ${t.description} ${t.notes} ${t.tags.join(' ')} ${courses.find((c) => c.id === t.course_id)?.name ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase());
  filtered = filtered.filter(matches);
  filtered.sort((a, b) =>
    sort === 'priority'
      ? b.priority - a.priority
      : sort === 'title'
        ? a.title.localeCompare(b.title, 'zh')
        : sort === 'created'
          ? b.created_at.localeCompare(a.created_at)
          : sort === 'completed'
            ? (b.completed_at ?? '').localeCompare(a.completed_at ?? '')
            : (a.due_at ?? 'z').localeCompare(b.due_at ?? 'z') || b.priority - a.priority,
  );
  if (view === 'upcoming')
    filtered.sort((a, b) =>
      (a.due_at ?? a.start_at ?? '').localeCompare(b.due_at ?? b.start_at ?? ''),
    );
  if (view === 'today')
    filtered.sort(
      (a, b) =>
        Number(!!(a.due_at && dateKey(a.due_at) < today)) -
        Number(!!(b.due_at && dateKey(b.due_at) < today)),
    );
  const counts = {
    today: incomplete.filter(isToday).length,
    inbox: incomplete.filter((t) => !t.start_at && !t.due_at).length,
    upcoming: incomplete.filter((t) => (t.due_at ?? t.start_at ?? '') > today).length,
    courses: courses.length,
    completed: tasks.length - incomplete.length,
    ai: 0,
  };
  const save = (id: string, p: TaskPatch) => run(() => api.change(id, p)).then(() => {}),
    remove = (id: string) => run(() => api.remove(id)).then(() => {}),
    create = (t: string, p: TaskPatch) => run(() => api.create(t, p));
  const download = async () => {
    const blob = new Blob([await api.export()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `FDU-Agent-${today}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="fdu-app">
      <nav className="fdu-nav">
        <div className="brand">
          <img src={brandIcon} alt="" width={40} height={40} />
          <div>
            FDU Agent<small>个人学习空间</small>
          </div>
        </div>
        <div className="nav-links">
          <small className="nav-group">任务管理</small>
          {views.map(([id, label]) => (
            <div key={id} className={`nav-entry nav-${id}`}>
              {id === 'courses' && <small className="nav-group">学习管理</small>}
              {id === 'ai' && <small className="nav-group">AI 助手</small>}
              <button
                className={view === id ? 'active' : ''}
                aria-current={view === id ? 'page' : undefined}
                onClick={() => {
                  setView(id);
                  setDay('');
                  setCourse('');
                  setSelected(null);
                }}
              >
                <span className="nav-icon">
                  <NavIcon name={id} />
                </span>
                <span>{label}</span>
                {id !== 'ai' && <small>{counts[id]}</small>}
              </button>
            </div>
          ))}
        </div>
        <div className="nav-bottom">
          <button onClick={() => setSettings(true)}>⚙ 设置与同步</button>
          <small>日月光华，旦复旦兮</small>
        </div>
      </nav>
      <nav className="mobile-nav" aria-label="手机导航">
        {(
          [
            ['today', '今天', '◉'],
            ['inbox', '任务', '▣'],
            ['upcoming', '计划', '▦'],
            ['courses', '课程', '▤'],
            ['ai', 'AI', '✧'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={view === id || (id === 'inbox' && view === 'completed') ? 'active' : ''}
            onClick={() => {
              setView(id);
              setCourse('');
              setDay('');
              setSelected(null);
            }}
          >
            <span className="nav-icon">
              <NavIcon name={id} />
            </span>
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <main className="fdu-main">
        <header>
          <div className="eyebrow">
            {new Date().toLocaleDateString('zh-CN', {
              month: 'long',
              day: 'numeric',
              weekday: 'long',
            })}
          </div>
          <div className="page-title">
            <h1>{views.find((v) => v[0] === view)?.[1]}</h1>
            <button
              className="mobile-settings"
              onClick={() => setSettings(true)}
              aria-label="设置与同步"
            >
              ⚙
            </button>
          </div>
          <p className="subtitle">
            {view === 'today'
              ? '把重要的事，留给今天。'
              : view === 'inbox'
                ? '先记下来，再从容安排。'
                : view === 'courses'
                  ? '让课程与个人计划有条不紊。'
                  : view === 'completed'
                    ? '每一个完成，都算数。'
                    : view === 'ai'
                      ? '把问题说清楚，一起找到下一步。'
                      : '给未来留出清晰的位置。'}
          </p>
          <div className="sync-line">
            <span className={online ? 'connection' : 'connection offline'} />
            <span>
              {!online
                ? '离线 · 修改保存在本机'
                : snapshot.localOnly
                  ? '本机模式 · 尚未连接云端'
                  : snapshot.syncing
                    ? '正在同步'
                    : snapshot.pending
                      ? `${snapshot.pending} 项待同步`
                      : '云端已确认'}
            </span>
            <button onClick={() => void run(() => api.sync()).catch(() => {})}>同步</button>
          </div>
        </header>
        <Reminders snapshot={snapshot} />
        {update && (
          <div className="notice">
            新版本已准备好。请先保存正在编辑的内容。
            <button
              onClick={() => {
                void navigator.serviceWorker.getRegistration().then((reg) => {
                  if (reg?.waiting) {
                    navigator.serviceWorker.addEventListener(
                      'controllerchange',
                      () => location.reload(),
                      { once: true },
                    );
                    reg.waiting.postMessage('activate');
                  } else location.reload();
                });
              }}
            >
              更新应用
            </button>
          </div>
        )}
        {(error || snapshot.error) && (
          <div role="alert" className="notice error">
            {error || snapshot.error}
          </div>
        )}
        {snapshot.conflicts.map((c) => (
          <div className="notice" key={c.id}>
            <b>任务冲突：{c.local?.title ?? c.entity_id}</b>
            <p>
              本机：{c.local?.title} · {c.local?.notes}
              <br />
              云端：{c.server?.deleted_at ? '已删除' : (c.server?.title ?? '不存在')} ·{' '}
              {c.server?.notes}
            </p>
            <button onClick={() => void run(() => api.resolve(c.id, 'server')).catch(() => {})}>
              保留云端
            </button>
            <button onClick={() => void run(() => api.resolve(c.id, 'local')).catch(() => {})}>
              保留本机
            </button>
            <button onClick={() => void download()}>导出备份</button>
          </div>
        ))}
        {snapshot.catalogConflict && (
          <div className="notice">
            课程或偏好有冲突。
            <button onClick={() => void run(() => api.resolveCatalog('server')).catch(() => {})}>
              保留云端
            </button>
            <button onClick={() => void run(() => api.resolveCatalog('local')).catch(() => {})}>
              保留本机
            </button>
          </div>
        )}
        {(view === 'inbox' || view === 'completed') && (
          <div className="view-tabs mobile-task-tabs">
            <button className={view === 'inbox' ? 'selected' : ''} onClick={() => setView('inbox')}>
              收集箱
            </button>
            <button
              className={view === 'completed' ? 'selected' : ''}
              onClick={() => setView('completed')}
            >
              已完成
            </button>
          </div>
        )}
        {snapshot.localOnly && view === 'today' && (
          <button className="setup-entry" onClick={() => setSettings(true)}>
            首次使用？打开同步码与 eLearning 连接向导 →
          </button>
        )}
        {view === 'today' && (
          <ScheduleOverview
            tasks={tasks}
            open={setSelected}
            choose={(key) => {
              setView('upcoming');
              setPlanMode('week');
              setAnchor(key);
              setDay(key);
            }}
          />
        )}
        {view === 'courses' && (
          <Courses
            api={api}
            reload={refresh}
            snapshot={snapshot}
            selectTask={setSelected}
            library={library}
            refresh={() => void run(() => api.refreshElearning()).catch(() => {})}
            add={(name) =>
              run(() =>
                api.catalog({
                  ...catalog,
                  courses: [...catalog.courses, { id: crypto.randomUUID(), name }],
                }),
              )
            }
          />
        )}
        {view === 'ai' && (
          <section className="assistant-panel">
            <DraftReview
              snapshot={snapshot}
              decide={(id, confirm) => run(() => api.decideAi(id, confirm))}
            />
            {assistant ?? <AiAssistant api={api} refresh={refresh} initial={snapshot.aiMessages} />}
          </section>
        )}
        {view !== 'courses' && view !== 'ai' && (
          <>
            {view === 'today' && (
              <p className="today-progress">
                今天已完成{' '}
                {
                  tasks.filter(
                    (t) =>
                      t.status === 'completed' &&
                      t.completed_at &&
                      dateKey(t.completed_at) === today,
                  ).length
                }{' '}
                项 · 还有 {counts.today} 项待处理
              </p>
            )}
            {view === 'today' && unscheduled.length > 0 && (
              <button className="inbox-hint" onClick={() => setView('inbox')}>
                {unscheduled.length} 项尚未安排 <span>去收集箱整理 →</span>
              </button>
            )}
            <form
              className="quick-add"
              onSubmit={(e) => {
                e.preventDefault();
                void create(title, {
                  ...(course ? { course_id: course } : {}),
                  ...(view === 'today'
                    ? { start_at: new Date(`${today}T09:00:00`).toISOString() }
                    : {}),
                  ...(view === 'upcoming' && day
                    ? { due_at: new Date(`${day}T18:00:00`).toISOString() }
                    : {}),
                })
                  .then(() => setTitle(''))
                  .catch(() => {});
              }}
            >
              <span>＋</span>
              <input
                id="quick-task"
                aria-label="新任务标题"
                placeholder="添加任务，给想法一个落点…"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={200}
              />
              <button className="primary">添加</button>
              <button type="button" onClick={() => setNewSchedule(true)}>
                安排日程
              </button>
            </form>
            {view === 'upcoming' && (
              <>
                <div className="view-tabs" aria-label="计划视图">
                  {(
                    [
                      ['list', '列表'],
                      ['week', '周历'],
                      ['month', '月历'],
                      ['countdown', '倒计时'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      className={planMode === id ? 'selected' : ''}
                      onClick={() => {
                        setPlanMode(id);
                        setDay('');
                        localStorage.setItem('fdu-plan-view', id);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {(planMode === 'week' || planMode === 'month') && (
                  <PlanCalendar
                    mode={planMode}
                    anchor={anchor}
                    day={day}
                    tasks={incomplete.filter(matches)}
                    select={setDay}
                    move={setAnchor}
                    open={setSelected}
                    drop={(id, key) => {
                      if (tasks.some((t) => t.id === id))
                        void save(id, { due_at: new Date(`${key}T18:00:00`).toISOString() }).catch(
                          () => {},
                        );
                    }}
                  />
                )}
              </>
            )}
            <div className="filters">
              <input
                id="fdu-search"
                aria-label="搜索任务"
                placeholder="⌕ 搜索任务、备注、标签"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                aria-label="筛选课程"
                value={course}
                onChange={(e) => setCourse(e.target.value)}
              >
                <option value="">所有课程</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="筛选优先级"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="">所有优先级</option>
                {[0, 1, 2, 3].map((p) => (
                  <option key={p} value={p}>
                    {['无优先级', '低优先级', '中优先级', '高优先级'][p]}
                  </option>
                ))}
              </select>
              <select
                aria-label="筛选来源"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">全部来源</option>
                <option value="personal">个人与AI任务</option>
                <option value="canvas">eLearning作业</option>
              </select>
              <select
                aria-label="筛选状态"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">所有状态</option>
                <option value="todo">待办</option>
                <option value="in_progress">进行中</option>
                <option value="completed">完成</option>
              </select>
              <select aria-label="筛选标签" value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">所有标签</option>
                {[...new Set(tasks.flatMap((t) => t.tags))].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <select aria-label="排序" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="due">截止时间</option>
                <option value="priority">优先级</option>
                <option value="title">标题</option>
                <option value="created">创建时间</option>
                <option value="completed">完成时间</option>
              </select>
            </div>
            <div className="list-heading">
              <span>{day || '任务清单'}</span>
              <small>{filtered.length} 项</small>
            </div>
            {filtered.length > 0 && (
              <div className="bulk-actions">
                <button
                  onClick={() => {
                    if (confirm(`完成当前筛选的 ${filtered.length} 项任务？`))
                      void run(async () => {
                        for (const task of filtered)
                          await api.change(task.id, { status: 'completed' });
                      }).catch(() => {});
                  }}
                >
                  批量完成筛选结果
                </button>
                <button
                  onClick={() => {
                    if (confirm(`删除当前筛选的 ${filtered.length} 项任务？子任务会保留。`))
                      void run(async () => {
                        for (const task of filtered) await api.remove(task.id);
                      }).catch(() => {});
                  }}
                >
                  批量删除筛选结果
                </button>
              </div>
            )}
            <section className="task-list">
              {filtered.map((t, index) => (
                <div className="task-group" key={t.id}>
                  {view === 'upcoming' &&
                    planMode === 'list' &&
                    (index === 0 ||
                      dateKey(filtered[index - 1]!.due_at ?? filtered[index - 1]!.start_at!) !==
                        dateKey(t.due_at ?? t.start_at!)) && (
                      <h3 className="date-group">
                        {dateKey(t.due_at ?? t.start_at!) === today
                          ? '今天'
                          : dateKey(t.due_at ?? t.start_at!) ===
                              dateKey(new Date(Date.now() + 86400000))
                            ? '明天'
                            : new Date(t.due_at ?? t.start_at!).getTime() <
                                Date.now() + 7 * 86400000
                              ? '未来 7 天'
                              : '更远的未来'}{' '}
                        · {dateKey(t.due_at ?? t.start_at!)}
                      </h3>
                    )}
                  {view === 'today' &&
                    t.due_at &&
                    dateKey(t.due_at) < today &&
                    (index === 0 ||
                      !(
                        filtered[index - 1]!.due_at && dateKey(filtered[index - 1]!.due_at!) < today
                      )) && <h3 className="date-group overdue">逾期未完成</h3>}
                  <div
                    className={`task-row priority-${t.priority}`}
                    key={t.id}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData('text/fdu-task', t.id)}
                  >
                    <input
                      type="checkbox"
                      aria-label={`完成 ${t.title}`}
                      checked={t.status === 'completed'}
                      onChange={() =>
                        void save(t.id, {
                          status: t.status === 'completed' ? 'todo' : 'completed',
                        }).catch(() => {})
                      }
                    />
                    <button className="task-open" onClick={() => setSelected(t.id)}>
                      <span className={t.status === 'completed' ? 'done' : ''}>{t.title}</span>
                      <small>
                        {t.priority > 0 && `优先级：${['', '低', '中', '高'][t.priority]} · `}
                        {tasks.some((c) => c.parent_id === t.id) &&
                          `${tasks.filter((c) => c.parent_id === t.id).length} 个子任务 · `}
                        {t.parent_id && tasks.find((p) => p.id === t.parent_id)
                          ? '↳ 子任务 · '
                          : ''}
                        {courses.find((c) => c.id === t.course_id)?.name ?? '个人任务'}
                        {snapshot.learning.assignments.find((a) => a.task_id === t.id)
                          ? ` · eLearning · Canvas：${submissionLabel(snapshot.learning.assignments.find((a) => a.task_id === t.id)!.submission_state)}`
                          : ' · 个人'}
                        {officialDue(t) &&
                          ` · 官方截止 ${new Date(officialDue(t)!).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                        {t.status === 'in_progress' ? ' · 进行中' : ''}
                        {t.tags.map((tag) => ` · #${tag}`).join('')}
                        {view === 'upcoming' && planMode === 'countdown' && t.due_at && (
                          <b className="countdown">{countdown(t.due_at)}</b>
                        )}
                      </small>
                    </button>
                    <input
                      type="date"
                      className={`due ${t.due_at && dateKey(t.due_at) < today && t.status !== 'completed' ? 'overdue' : ''}`}
                      aria-label={`截止日期 ${t.title}`}
                      value={t.due_at ? dateKey(t.due_at) : ''}
                      onChange={(e) => {
                        const date = e.target.value;
                        const time = t.due_at ? localTime(t.due_at).slice(11) : '18:00';
                        void save(t.id, {
                          due_at: date ? new Date(`${date}T${time}`).toISOString() : null,
                        }).catch(() => {});
                      }}
                    />
                  </div>
                </div>
              ))}
              {!filtered.length && (
                <div className="empty-state">
                  <span>✓</span>
                  <h2>{view === 'today' ? '今天，留一点从容' : '这里还很安静'}</h2>
                  <p>
                    {query
                      ? '没有匹配的任务，试试其他关键词。'
                      : '添加任务，或调整筛选查看你的安排。'}
                  </p>
                </div>
              )}
            </section>
          </>
        )}
        <footer>本机优先保存 · 重要的事，稳稳记住</footer>
      </main>
      {newSchedule && (
        <NewSchedule
          title={title}
          day={day}
          courses={courses}
          save={(title, patch) =>
            create(title, patch).then((result) => {
              setTitle('');
              return result;
            })
          }
          close={() => setNewSchedule(false)}
        />
      )}
      {active && (
        <Detail
          key={active.id + active.updated_at}
          task={active}
          tasks={tasks}
          courses={courses}
          assignment={snapshot.learning.assignments.find((a) => a.task_id === active.id)}
          save={save}
          remove={remove}
          create={create}
          close={() => setSelected(null)}
        />
      )}
      {settings && (
        <div className="modal-backdrop">
          <section
            className={`settings-modal${models && modelSettings ? ' settings-modal-models' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label="设置与同步"
          >
            <div className="detail-heading">
              <h2>你的个人空间</h2>
              <button onClick={() => setSettings(false)} aria-label="关闭设置">
                ✕
              </button>
            </div>
            <SetupGuide snapshot={snapshot} />
            <p>
              当前项目：{snapshot.projectUrl || '尚未配置'} ·{' '}
              {snapshot.connected ? '同步空间已连接' : '尚未连接'}
            </p>

            <label>
              外观
              <select
                value={catalog.theme}
                onChange={(e) =>
                  void run(() =>
                    api.catalog({
                      ...catalog,
                      theme: e.target.value as 'system' | 'light' | 'dark',
                    }),
                  ).catch(() => {})
                }
              >
                <option value="system">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
            {!snapshot.connected && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(() =>
                    api.configure({ url: String(f.get('url')), key: String(f.get('key')) }),
                  ).catch(() => {});
                }}
              >
                <label>
                  Project URL
                  <input
                    name="url"
                    type="url"
                    placeholder="https://你的项目.supabase.co"
                    defaultValue={snapshot.projectUrl}
                    required
                  />
                </label>
                <label>
                  公开 publishable / anon key
                  <input name="key" required autoComplete="off" />
                </label>
                <small>不需要 service_role、模型密钥或校园密码。先按项目初始化说明应用 SQL。</small>
                <button className="primary">保存云端配置</button>
              </form>
            )}
            {snapshot.configured && !snapshot.connected && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const code = String(f.get('code'));
                  e.currentTarget.reset();
                  void run(() => api.connectCode(code, f.get('import') === 'on')).catch(() => {});
                }}
              >
                <label>
                  同步码
                  <input
                    name="code"
                    type="password"
                    autoComplete="off"
                    required
                    minLength={12}
                    maxLength={128}
                    placeholder="输入两端共用的同步码"
                  />
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" name="import" />
                  将本机离线任务导入同步空间
                </label>
                <button className="primary">连接并同步</button>
              </form>
            )}
            {snapshot.connected && (
              <p>
                同步空间已连接
                <button onClick={() => void run(() => api.logout()).catch(() => {})}>
                  断开同步
                </button>
              </p>
            )}
            <section className="elearning-settings">
              <h3>手机 AI 配置</h3>
              <p>
                在同一 Supabase 项目执行 004 配额迁移，设置服务端秘密 FDU_AI_KEY（DeepSeek 密钥）和
                FDU_AI_MODEL（你账户可用的模型名称），部署 ai
                函数。手机只需输入同步码连接，无需输入模型密钥，也不需要电脑开机。每次调用会计费，当前限制每天最多
                30 次、间隔 10 秒。桌面模型在“模型与工具配置”中独立设置。
              </p>
            </section>
            <section className="elearning-settings">
              <h3>eLearning 连接</h3>
              <p>只读连接复旦平台。Token 通过服务端秘密配置，不在此输入或保存。</p>
              <p>
                读取由 Supabase 云端执行。学校网页能在本机打开，不代表云端 API
                可达。两次刷新至少间隔一分钟。
              </p>
              <LearningConnection
                api={api}
                snapshot={snapshot}
                refresh={() => void run(() => api.refreshElearning()).catch(() => {})}
              />
            </section>
            {modelSettings && (
              <>
                <button onClick={() => setModels(!models)}>模型与工具配置</button>
                {models && <div className="native-settings">{modelSettings}</div>}
              </>
            )}
            <button onClick={() => void download()}>导出本机数据备份</button>
            <button
              onClick={() => {
                void api
                  .export()
                  .then(async (raw) => {
                    const { fullBackup } = await import('./Library.tsx');
                    const { blob, count } = await fullBackup(raw);
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'FDU-Agent-full-backup.zip';
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                    setError(
                      `完整备份已导出，包含${count}份本机文件；未下载的云端原文件不包含在包内。`,
                    );
                  })
                  .catch((e) => setError(String(e)));
              }}
            >
              导出完整备份 ZIP
            </button>
            <label>
              恢复完整备份
              <input
                aria-label="恢复完整备份"
                type="file"
                accept=".zip"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  void import('./Library.tsx')
                    .then(async ({ readFullBackup }) => {
                      const backup = await readFullBackup(file);
                      const tasks = readBackup(backup.data);
                      if (
                        confirm(`恢复 ${tasks.length} 项任务副本及资料索引？已有任务和文件将保留。`)
                      ) {
                        await backup.commit();
                        await run(() => api.restoreBackup(backup.data));
                      }
                    })
                    .catch((e) => setError(String(e)));
                }}
              />
            </label>
            <label>
              从任务 JSON 备份恢复副本
              <input
                aria-label="恢复任务备份"
                type="file"
                accept=".json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  void file
                    .text()
                    .then(async (text) => {
                      if (text.length > 10_000_000) throw new Error('备份过大');
                      const data: unknown = JSON.parse(text);
                      const tasks = readBackup(data);
                      if (
                        confirm(
                          `恢复 ${tasks.length} 项任务为新副本？现有任务会保留；课程不存在时转为个人任务。`,
                        )
                      )
                        await run(() => api.restoreBackup(data));
                    })
                    .catch((e) => setError(String(e)));
                }}
              />
            </label>
            <button
              onClick={() => {
                if ('Notification' in window)
                  void Notification.requestPermission().then((permission) => {
                    if (permission !== 'granted') setError('系统通知未授权，应用内提醒仍可用');
                  });
                else setError('当前环境不支持系统通知');
              }}
            >
              允许系统提醒
            </button>
            <small>
              提醒在应用打开时检查；关闭或锁屏后的 iPhone 推送尚未接入，不保证后台执行。
            </small>
            <p className="install-tip">
              iPhone：用 Safari 打开 HTTPS 地址 → 分享 →
              添加到主屏幕。应用关闭或锁屏后不保证后台同步。
            </p>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
