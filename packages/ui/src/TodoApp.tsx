import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ClientApi, Snapshot } from '../../client/src/client.ts';
import type { Task, TaskPatch } from '../../core/src/task.ts';
import { dayKey, inPlan, isOverdue, moveTaskToDay, scheduledAt } from '../../core/src/schedule.ts';
import { NavIcon } from './NavIcon.tsx';
import brandIcon from '../../../apps/pwa/public/icon-192.png';
import { PlanCalendar, occursOn } from './PlanCalendar.tsx';
import { TaskEditor } from './TaskEditor.tsx';
import { Settings } from './Settings.tsx';
import { ConflictReview } from './ConflictReview.tsx';
import { Courses } from './Courses.tsx';
import { AiAssistant, DraftReview } from './AiAssistant.tsx';
import { Reminders } from './Reminders.tsx';
import type { DesktopLearningApi } from './LearningLogin.tsx';
const views = [
  ['today', '今天'],
  ['inbox', '收集箱'],
  ['upcoming', '计划'],
  ['completed', '已完成'],
  ['courses', '课程'],
  ['ai', 'AI 助手'],
] as const;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function TodoApp({
  api,
  assistant,
  library,
  modelSettings,
  desktopLearning,
}: {
  api: ClientApi;
  assistant?: ReactNode;
  library?: ReactNode;
  modelSettings?: ReactNode;
  desktopLearning?: DesktopLearningApi;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(''),
    [view, setView] = useState('today'),
    [title, setTitle] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [newTask, setNewTask] = useState(false),
    [settings, setSettings] = useState(false),
    [openModels, setOpenModels] = useState(false),
    [query, setQuery] = useState(''),
    [global, setGlobal] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false),
    [filters, setFilters] = useState({ course: '', priority: '', source: '', status: '', tag: '' }),
    [sort, setSort] = useState('due'),
    [day, setDay] = useState(''),
    [anchor, setAnchor] = useState(() => dayKey(new Date())),
    [planMode, setPlanMode] = useState(() =>
      ['week', 'month'].includes(localStorage.getItem('fdu-plan-view') ?? '')
        ? localStorage.getItem('fdu-plan-view')!
        : 'list',
    ),
    [online, setOnline] = useState(navigator.onLine),
    [clock, setClock] = useState(Date.now()),
    [update, setUpdate] = useState(false),
    [chosen, setChosen] = useState<string[]>([]),
    [bulk, setBulk] = useState(false),
    [folded, setFolded] = useState<string[]>([]),
    [trash, setTrash] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [noticeTick, setNoticeTick] = useState(0),
    [aiPrompt, setAiPrompt] = useState(''),
    [openDocument, setOpenDocument] = useState(''),
    [displayCount, setDisplayCount] = useState(100),
    [visited, setVisited] = useState<string[]>(['today']);
  const lastRevision = useRef('');
  useEffect(() => setDisplayCount(100), [view, query, filters, sort, day, planMode]);
  const undo = useRef<{ label: string; apply: () => Promise<void> }[]>([]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 10000);
    return () => clearTimeout(timer);
  }, [notice, noticeTick]);
  const refresh = useCallback(async () => {
    try {
      const next = await api.snapshot();
      const target = new URL(location.href).searchParams.get('task');
      if (target && next.tasks.some((t) => t.id === target)) {
        setSelected(target);
        history.replaceState(null, '', location.pathname);
      }
      setSnapshot((before) => (JSON.stringify(before) === JSON.stringify(next) ? before : next));
    } catch (e) {
      setError(errorText(e));
    }
  }, [api]);
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError('');
      try {
        await fn();
        await refresh();
        void api.sync().then(refresh).catch(refresh);
      } catch (e) {
        setError(errorText(e));
        await refresh();
        throw e;
      }
    },
    [api, refresh],
  );
  const navigate = (next: string) => {
    setView(next);
    setVisited((v) => (v.includes(next) ? v : [...v, next]));
    setSelected(null);
    setDay('');
    setChosen([]);
    setBulk(false);
    setTrash(false);
    setGlobal(false);
    setQuery('');
    setFilters({ course: '', priority: '', source: '', status: '', tag: '' });
  };
  const remember = (label: string, apply: () => Promise<void>) => {
    undo.current = [...undo.current.slice(-9), { label, apply }];
    setNotice(label);
    setNoticeTick((value) => value + 1);
  };
  const save = async (id: string, patch: TaskPatch, base?: Task) => {
    const before = snapshot?.tasks.find((t) => t.id === id);
    await run(() => api.change(id, patch, base));
    if (before)
      remember('任务已保存', async () => {
        const current = (await api.snapshot()).tasks.find((t) => t.id === id);
        if (!current) throw new Error('任务已不存在');
        for (const key of Object.keys(patch))
          if (
            JSON.stringify(current[key as keyof Task]) !==
            JSON.stringify(patch[key as keyof TaskPatch])
          )
            throw new Error('任务后来又有变更，请打开详情核对');
        await api.change(
          id,
          Object.fromEntries(Object.keys(patch).map((key) => [key, before[key as keyof Task]])),
          current,
        );
      });
  };
  const create = async (t: string, p: TaskPatch) => {
    let id = '';
    await run(async () => {
      id = await api.create(t, p);
    });
    remember('已添加任务', () => api.remove(id));
  };
  const remove = async (id: string) => {
    await run(() => api.remove(id));
    remember('任务已移到回收站', () => api.restore(id));
  };
  const ask = (text: string) => {
    navigate('ai');
    setAiPrompt(text);
  };
  useEffect(() => {
    void refresh();
    const tick = () => {
      setOnline(navigator.onLine);
      setClock(Date.now());
      if (document.visibilityState !== 'hidden')
        void api
          .sync()
          .catch(() => {})
          .finally(refresh);
    };
    const mirror = setInterval(() => {
      if (document.visibilityState !== 'hidden')
        void api
          .revision()
          .then((v) => {
            if (v !== lastRevision.current) {
              lastRevision.current = v;
              return refresh();
            }
          })
          .catch(() => {});
    }, 1000);
    const timer = setInterval(tick, 30000);
    const updated = () => setUpdate(true);
    const models = () => {
      setSettings(true);
      setOpenModels(true);
      setTimeout(() => window.dispatchEvent(new Event('fdu-model-settings-open')), 0);
    };
    window.addEventListener('online', tick);
    window.addEventListener('offline', tick);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('fdu-update', updated);
    window.addEventListener('fdu-model-settings', models);
    tick();
    return () => {
      clearInterval(mirror);
      clearInterval(timer);
      window.removeEventListener('online', tick);
      window.removeEventListener('offline', tick);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('fdu-update', updated);
      window.removeEventListener('fdu-model-settings', models);
    };
  }, [api, refresh]);
  useEffect(() => {
    const theme = snapshot?.catalog.theme ?? 'system';
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.dataset.fduTheme = theme;
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.classList.toggle('light', !dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [snapshot?.catalog.theme]);
  useEffect(() => {
    const context = (event: Event) => {
      const text = (event as CustomEvent<string>).detail;
      setView('ai');
      setVisited((v) => (v.includes('ai') ? v : [...v, 'ai']));
      setAiPrompt(text);
    };
    window.addEventListener('fdu-ai-context', context);
    return () => window.removeEventListener('fdu-ai-context', context);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(
          (el) => el.getClientRects().length,
        )
      )
        return;
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
  useEffect(() => {
    const open = (event: Event) => {
      const hash = (event as CustomEvent<string>).detail;
      setView('courses');
      setVisited((v) => (v.includes('courses') ? v : [...v, 'courses']));
      setSelected(null);
      setNewTask(false);
      setOpenDocument(hash + '#' + Date.now());
    };
    window.addEventListener('fdu-open-document', open);
    return () => window.removeEventListener('fdu-open-document', open);
  }, []);
  const indexes = useMemo(
    () => ({
      courses: new Map(snapshot?.courses.map((c) => [c.id, c]) ?? []),
      assignments: new Map(snapshot?.learning.assignments.map((a) => [a.task_id, a]) ?? []),
      tasks: new Map(snapshot?.tasks.map((t) => [t.id, t]) ?? []),
      children: (snapshot?.tasks ?? []).reduce((map, t) => {
        if (t.parent_id) {
          const group = map.get(t.parent_id) ?? [];
          group.push(t);
          map.set(t.parent_id, group);
        }
        return map;
      }, new Map<string, Task[]>()),
    }),
    [snapshot],
  );
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
  const { tasks, courses, catalog } = snapshot,
    today = dayKey(new Date());
  const isToday = (t: Task) =>
    !!(
      (t.start_at && dayKey(t.start_at) <= today) ||
      (t.due_at && dayKey(t.due_at) <= today) ||
      (indexes.assignments.get(t.id)?.original_due_at &&
        dayKey(indexes.assignments.get(t.id)!.original_due_at!) <= today)
    );
  const overdueTask = (t: Task) =>
    isOverdue(t) ||
    (t.status !== 'completed' &&
      indexes.assignments.get(t.id)?.submission_state === 'unsubmitted' &&
      !!indexes.assignments.get(t.id)?.original_due_at &&
      Date.parse(indexes.assignments.get(t.id)!.original_due_at!) < Date.now());
  const incomplete = tasks.filter((t) => t.status !== 'completed');
  const matches = (t: Task) =>
    (!filters.course || t.course_id === filters.course) &&
    (!filters.priority || t.priority === Number(filters.priority)) &&
    (!filters.source || (filters.source === 'canvas') === indexes.assignments.has(t.id)) &&
    (!filters.status || t.status === filters.status) &&
    (!filters.tag || t.tags.includes(filters.tag)) &&
    `${t.title} ${t.notes} ${t.description} ${t.tags.join(' ')} ${indexes.courses.get(t.course_id ?? '')?.name ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase());
  let list = (trash ? snapshot.deletedTasks : tasks).filter((t) =>
    global || trash
      ? true
      : view === 'completed'
        ? t.status === 'completed'
        : t.status !== 'completed',
  );
  if (!global && !trash) {
    if (view === 'today') list = list.filter(isToday);
    if (view === 'inbox')
      list = list.filter(
        (t) => !scheduledAt(t) && (!t.parent_id || !indexes.tasks.has(t.parent_id)),
      );
    if (view === 'upcoming')
      list = list.filter((t) =>
        day && (planMode === 'week' || planMode === 'month') ? occursOn(t, day) : inPlan(t),
      );
  }
  list = list
    .filter(matches)
    .filter((t) => global || !t.parent_id || !folded.includes(t.parent_id));
  list.sort((a, b) =>
    sort === 'priority'
      ? b.priority - a.priority
      : sort === 'title'
        ? a.title.localeCompare(b.title, 'zh')
        : sort === 'created'
          ? b.created_at.localeCompare(a.created_at)
          : sort === 'completed' || view === 'completed'
            ? (b.completed_at ?? '').localeCompare(a.completed_at ?? '')
            : (scheduledAt(a) ?? 'z').localeCompare(scheduledAt(b) ?? 'z'),
  );
  if (view === 'today' && !global)
    list.sort((a, b) => Number(overdueTask(a)) - Number(overdueTask(b)));
  const completedToday = tasks.filter(
    (t) =>
      t.status === 'completed' && t.completed_at && dayKey(t.completed_at) === today && matches(t),
  );
  const counts: Record<string, number> = {
    today: incomplete.filter(isToday).length,
    inbox: incomplete.filter((t) => !scheduledAt(t) && !t.parent_id).length,
    upcoming: incomplete.filter((t) => inPlan(t)).length,
    completed: tasks.length - incomplete.length,
    courses: courses.length,
  };
  const active = tasks.find((t) => t.id === selected),
    plannedDay = view === 'upcoming' && day ? day : today;
  const saveTemplate = async (title: string, template: TaskPatch) => {
    if (JSON.stringify(template).length > 15000) throw new Error('模板内容过长，请精简描述和备注');
    const existing = catalog.plans.find((p) => p.template && p.title === title);
    await run(() =>
      api.catalog({
        ...catalog,
        plans: [
          ...catalog.plans.filter((p) => p.id !== existing?.id),
          { id: existing?.id ?? crypto.randomUUID(), title, task_ids: [], template },
        ],
      }),
    );
  };
  const filterCount = Object.values(filters).filter(Boolean).length;
  const setFilter = (key: keyof typeof filters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const row = (t: Task) => {
    const children = indexes.children.get(t.id) ?? [],
      assignment = indexes.assignments.get(t.id);
    const date = scheduledAt(t),
      dateKey = date ? dayKey(date) : '';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateLabel = !date
      ? '安排日期'
      : dateKey === today
        ? '今天'
        : dateKey === dayKey(tomorrow)
          ? '明天'
          : new Date(date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    return (
      <div
        className={`task-row priority-${t.priority}${t.parent_id ? ' is-child' : ''}`}
        key={t.id}
        draggable={!bulk && matchMedia('(pointer: fine)').matches}
        onDragStart={(e) => e.dataTransfer.setData('text/fdu-task', t.id)}
      >
        <label className="task-check">
          {bulk ? (
            <input
              type="checkbox"
              aria-label={`选择 ${t.title}`}
              checked={chosen.includes(t.id)}
              onChange={() =>
                setChosen((ids) =>
                  ids.includes(t.id) ? ids.filter((id) => id !== t.id) : [...ids, t.id],
                )
              }
            />
          ) : (
            <input
              type="checkbox"
              aria-label={`${t.status === 'completed' ? '撤销完成' : '完成'} ${t.title}`}
              checked={t.status === 'completed'}
              onChange={() =>
                void save(t.id, { status: t.status === 'completed' ? 'todo' : 'completed' }).catch(
                  () => {},
                )
              }
            />
          )}
        </label>
        <button className="task-open" onClick={() => setSelected(t.id)}>
          <span className={t.status === 'completed' ? 'done' : ''}>{t.title}</span>
          <small>
            {indexes.courses.get(t.course_id ?? '')?.name ?? '个人任务'}
            {t.priority > 0 ? ` · ${['', '低', '中', '高'][t.priority]}优先级` : ''}
            {assignment
              ? ` · eLearning · ${assignment.submission_state === 'unsubmitted' ? '未提交' : assignment.submission_state === 'unknown' ? '提交未知' : '已提交'}`
              : ''}
            {!snapshot.localOnly && snapshot.pendingIds.includes(t.id) ? ' · 待同步' : ''}
            {t.status === 'in_progress' ? ' · 进行中' : ''}
            {t.time_kind === 'day'
              ? ' · 未定时'
              : t.time_kind === 'range' && t.start_at && t.due_at
                ? ` · ${new Date(t.start_at).toTimeString().slice(0, 5)}–${new Date(t.due_at).toTimeString().slice(0, 5)}${dayKey(t.start_at) !== dayKey(t.due_at) ? ' · 跨天' : ''}${Date.parse(t.start_at) <= Date.now() && Date.parse(t.due_at) > Date.now() ? ' · 正在进行' : Date.parse(t.due_at) < Date.now() ? ' · 时间已过' : ''}`
                : t.due_at
                  ? ` · ${new Date(t.due_at).toTimeString().slice(0, 5)} 截止${isOverdue(t) ? ' · 已逾期' : ''}`
                  : ''}
            {t.repeat ? ' · 重复任务' : ''}
          </small>
          {assignment?.original_due_at && (
            <small>官方截止 {new Date(assignment.original_due_at).toLocaleString('zh-CN')}</small>
          )}
        </button>
        {children.length > 0 && (
          <button
            aria-label={`折叠子任务 ${t.title}`}
            onClick={() =>
              setFolded((ids) =>
                ids.includes(t.id) ? ids.filter((id) => id !== t.id) : [...ids, t.id],
              )
            }
          >
            {children.filter((c) => c.status === 'completed').length}/{children.length}{' '}
            {folded.includes(t.id) ? '▸' : '▾'}
          </button>
        )}
        <label className={`task-date${isOverdue(t) ? ' overdue' : ''}`} title="点击调整安排日期">
          <NavIcon name="upcoming" />
          <span>{dateLabel}</span>
          <input
            type="date"
            className={`due ${isOverdue(t) ? 'overdue' : ''}`}
            aria-label={`安排日期 ${t.title}`}
            value={scheduledAt(t) ? dayKey(scheduledAt(t)!) : ''}
            onClick={(e) => {
              try {
                e.currentTarget.showPicker?.();
              } catch {}
            }}
            onChange={(e) =>
              void save(
                t.id,
                e.target.value
                  ? moveTaskToDay(t, e.target.value)
                  : { start_at: null, due_at: null, time_kind: null, repeat: null },
              ).catch(() => {})
            }
          />
        </label>
      </div>
    );
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
                onClick={() => navigate(id)}
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
          <button onClick={() => setSettings(true)}>
            <NavIcon name="settings" />
            设置与同步
          </button>
          <small>日月光华，旦复旦兮</small>
        </div>
      </nav>
      <nav className="mobile-nav" aria-label="手机导航">
        {[
          ['today', '今天'],
          ['inbox', '任务'],
          ['upcoming', '计划'],
          ['courses', '课程'],
          ['ai', 'AI'],
        ].map(([id, label]) => (
          <button
            key={id}
            className={view === id || (id === 'inbox' && view === 'completed') ? 'active' : ''}
            onClick={() => navigate(id!)}
          >
            <NavIcon name={id!} />
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
            <h1>
              {global ? '搜索结果' : trash ? '回收站' : views.find(([id]) => id === view)?.[1]}
            </h1>
            <button
              className="mobile-settings"
              aria-label="设置与同步"
              onClick={() => setSettings(true)}
            >
              <NavIcon name="settings" />
            </button>
          </div>
          <div className="sync-line">
            <span className={online && !snapshot.error ? 'connection' : 'connection offline'} />
            <span>
              {!online
                ? '离线 · 已存本机'
                : snapshot.localOnly
                  ? '本机模式 · 已存本机'
                  : snapshot.conflicts.length
                    ? '存在任务冲突'
                    : snapshot.error
                      ? '同步异常 · 已存本机'
                      : snapshot.syncing
                        ? '正在同步'
                        : snapshot.pending
                          ? `${snapshot.pending} 项改动待同步`
                          : snapshot.lastSyncAt
                            ? `已同步 ${new Date(snapshot.lastSyncAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
                            : '等待云端确认'}
            </span>
            <button onClick={() => void run(() => api.sync(true)).catch(() => {})}>同步</button>
          </div>
        </header>
        {(error || snapshot.error) && (
          <div className="notice error" role="alert">
            {error || snapshot.error}
            <button onClick={() => void run(() => api.sync(true)).catch(() => {})}>重试</button>
          </div>
        )}
        <ConflictReview snapshot={snapshot} api={api} run={run} />
        <Reminders snapshot={snapshot} open={setSelected} clock={clock} />
        {notice && (
          <div className="action-toast" role="status">
            <NavIcon name="completed" />
            <span>{notice}</span>
            {undo.current.length > 0 && undo.current.at(-1)?.label === notice && (
              <button
                onClick={() => {
                  const item = undo.current.pop();
                  if (item)
                    void run(item.apply)
                      .then(() => setNotice('已撤销'))
                      .catch(() => {});
                }}
              >
                撤销
              </button>
            )}
            <button aria-label="关闭提示" onClick={() => setNotice('')}>
              ×
            </button>
          </div>
        )}
        {update && (
          <div className="notice">
            新版本已准备好，表单草稿会保留。
            <button
              onClick={() =>
                void navigator.serviceWorker.getRegistration().then((reg) => {
                  if (reg?.waiting) {
                    navigator.serviceWorker.addEventListener(
                      'controllerchange',
                      () => location.reload(),
                      { once: true },
                    );
                    reg.waiting.postMessage('activate');
                  } else location.reload();
                })
              }
            >
              更新应用
            </button>
          </div>
        )}
        <div hidden={view !== 'courses'}>
          {visited.includes('courses') && (
            <Courses
              api={api}
              snapshot={snapshot}
              reload={refresh}
              selectTask={setSelected}
              library={library}
              refresh={() =>
                void run(() =>
                  desktopLearning ? desktopLearning.refresh() : api.refreshElearning(),
                ).catch(() => {})
              }
              desktopLearning={desktopLearning}
              add={(name) =>
                run(() =>
                  api.catalog({
                    ...catalog,
                    courses: [...catalog.courses, { id: crypto.randomUUID(), name }],
                  }),
                )
              }
              ask={ask}
              create={(course) => {
                setFilters((f) => ({ ...f, course }));
                setNewTask(true);
              }}
            />
          )}
        </div>
        <div hidden={view !== 'ai'}>
          {visited.includes('ai') && (
            <section className="assistant-panel">
              <DraftReview
                snapshot={snapshot}
                undo={(id) => run(() => api.undoAi(id))}
                decide={(id, yes, proposal) => run(() => api.decideAi(id, yes, proposal))}
              />
              {aiPrompt && (
                <div className="notice">
                  <p>{aiPrompt}</p>
                  {assistant && (
                    <button
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(aiPrompt)
                          .then(() => setNotice('已复制，请粘贴到桌面助手'))
                      }
                    >
                      复制给桌面助手
                    </button>
                  )}
                </div>
              )}
              {assistant ?? (
                <AiAssistant
                  api={api}
                  refresh={refresh}
                  initial={snapshot.aiMessages}
                  prompt={aiPrompt}
                />
              )}
            </section>
          )}
        </div>
        {view !== 'courses' && view !== 'ai' && (
          <>
            {(view === 'inbox' || view === 'completed') && (
              <div className="view-tabs mobile-task-tabs">
                <button onClick={() => navigate('inbox')}>收集箱</button>
                <button onClick={() => navigate('completed')}>已完成</button>
                <button onClick={() => setTrash(!trash)}>回收站</button>
              </div>
            )}
            {!trash && view !== 'completed' && (
              <form
                className="quick-add"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
                }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (busy) return;
                  setBusy(true);
                  void create(title, {
                    ...(filters.course ? { course_id: filters.course } : {}),
                    ...(view === 'today' || view === 'upcoming'
                      ? {
                          start_at: new Date(`${plannedDay}T00:00`).toISOString(),
                          time_kind: 'day' as const,
                        }
                      : {}),
                  })
                    .then(() => {
                      setTitle('');
                      document.getElementById('quick-task')?.focus();
                    })
                    .catch(() => {})
                    .finally(() => setBusy(false));
                }}
              >
                <input
                  id="quick-task"
                  aria-label="新任务标题"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    view === 'inbox'
                      ? '先记下来，稍后安排…'
                      : view === 'upcoming'
                        ? `添加到 ${plannedDay}…`
                        : '今天要做什么？'
                  }
                  required
                  maxLength={200}
                />
                <button className="primary" disabled={busy} aria-label="添加">
                  <NavIcon name="plus" />
                  <span>添加</span>
                </button>
                <button
                  type="button"
                  className="quick-detail"
                  aria-label="详细添加"
                  title="详细添加"
                  onClick={() => setNewTask(true)}
                >
                  <NavIcon name="more" />
                  <span>详细添加</span>
                </button>
              </form>
            )}
            {view === 'today' && !global && (
              <div className="today-progress">
                今天已完成 {completedToday.length} 项 · {counts.today} 项待处理
                {counts.inbox! > 0 && (
                  <button onClick={() => navigate('inbox')}>整理 {counts.inbox} 项未安排</button>
                )}
              </div>
            )}
            {view === 'upcoming' && !global && (
              <>
                <div className="view-tabs" aria-label="计划视图">
                  {[
                    ['list', '列表'],
                    ['week', '周历'],
                    ['month', '月历'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={planMode === id ? 'selected' : ''}
                      onClick={() => {
                        setPlanMode(id!);
                        setDay('');
                        localStorage.setItem('fdu-plan-view', id!);
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
                    move={(at) => {
                      setAnchor(at);
                      setDay('');
                    }}
                    open={setSelected}
                    drop={(id, at) => {
                      const t = indexes.tasks.get(id);
                      if (t) void save(id, moveTaskToDay(t, at)).catch(() => {});
                    }}
                  />
                )}
              </>
            )}
            <div className="task-toolbar">
              <label className="task-search">
                <NavIcon name="search" />
                <input
                  id="fdu-search"
                  aria-label="搜索任务"
                  placeholder="搜索任务、备注、课程"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setGlobal(!trash && !!e.target.value);
                  }}
                />
                <kbd aria-hidden="true">Ctrl K</kbd>
              </label>
              <button aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
                <NavIcon name="filter" />
                筛选{filterCount ? ` · ${filterCount}` : ''}
              </button>
              <button
                aria-pressed={bulk}
                onClick={() => {
                  setBulk(!bulk);
                  setChosen([]);
                }}
              >
                <NavIcon name="select" />
                多选
              </button>
              {(query || filterCount > 0) && (
                <button
                  onClick={() => {
                    setQuery('');
                    setGlobal(false);
                    setFilters({ course: '', priority: '', source: '', status: '', tag: '' });
                  }}
                >
                  清除筛选
                </button>
              )}
            </div>
            {filtersOpen && (
              <div className="filters">
                <select
                  aria-label="筛选课程"
                  value={filters.course}
                  onChange={(e) => setFilter('course', e.target.value)}
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
                  value={filters.priority}
                  onChange={(e) => setFilter('priority', e.target.value)}
                >
                  <option value="">所有优先级</option>
                  {['无', '低', '中', '高'].map((label, i) => (
                    <option key={i} value={i}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="筛选来源"
                  value={filters.source}
                  onChange={(e) => setFilter('source', e.target.value)}
                >
                  <option value="">全部来源</option>
                  <option value="personal">个人与 AI</option>
                  <option value="canvas">eLearning</option>
                </select>
                <select
                  aria-label="筛选状态"
                  value={filters.status}
                  onChange={(e) => setFilter('status', e.target.value)}
                >
                  <option value="">所有状态</option>
                  <option value="todo">待办</option>
                  <option value="in_progress">进行中</option>
                  {(global || view === 'completed') && <option value="completed">已完成</option>}
                </select>
                <select
                  aria-label="筛选标签"
                  value={filters.tag}
                  onChange={(e) => setFilter('tag', e.target.value)}
                >
                  <option value="">所有标签</option>
                  {[...new Set(tasks.flatMap((t) => t.tags))].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="list-heading">
              <span>
                {global ? '全部任务（含已完成）' : day || '任务清单'} · {list.length} 项
              </span>
              <select aria-label="排序" value={sort} onChange={(e) => setSort(e.target.value)}>
                {[
                  ['due', '安排时间'],
                  ['priority', '优先级'],
                  ['title', '标题'],
                  ['created', '创建时间'],
                  ['completed', '完成时间'],
                ].map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {bulk && (
              <section className="bulk-actions">
                <b>已选 {chosen.length} 项</b>
                <button onClick={() => setChosen(list.map((t) => t.id))}>全选当前结果</button>
                <button
                  disabled={!chosen.length}
                  onClick={() =>
                    void run(async () => {
                      for (const id of chosen) await api.change(id, { status: 'completed' });
                      setChosen([]);
                    }).catch(() => {})
                  }
                >
                  完成所选
                </button>
                <label>
                  安排日期
                  <input
                    type="date"
                    aria-label="批量安排日期"
                    disabled={!chosen.length}
                    onChange={(e) => {
                      const at = e.target.value;
                      if (at)
                        void run(async () => {
                          for (const id of chosen) {
                            const t = indexes.tasks.get(id);
                            if (t) await api.change(id, moveTaskToDay(t, at));
                          }
                          setChosen([]);
                        }).catch(() => {});
                    }}
                  />
                </label>
                <label>
                  优先级
                  <select
                    aria-label="批量优先级"
                    disabled={!chosen.length}
                    defaultValue=""
                    onChange={(e) => {
                      const priority = Number(e.target.value);
                      void run(async () => {
                        for (const id of chosen) await api.change(id, { priority });
                      }).catch(() => {});
                    }}
                  >
                    <option value="" disabled>
                      选择优先级
                    </option>
                    {['无', '低', '中', '高'].map((v, i) => (
                      <option value={i} key={i}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  课程
                  <select
                    aria-label="批量课程"
                    disabled={!chosen.length}
                    defaultValue=""
                    onChange={(e) => {
                      const value = e.target.value;
                      void run(async () => {
                        for (const id of chosen) await api.change(id, { course_id: value || null });
                      }).catch(() => {});
                    }}
                  >
                    <option value="">个人任务</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <details>
                  <summary>更多操作</summary>
                  <button
                    className="danger"
                    disabled={!chosen.length}
                    onClick={() => {
                      if (confirm(`将选中的 ${chosen.length} 项移到回收站？`))
                        void run(async () => {
                          for (const id of chosen) await api.remove(id);
                          setChosen([]);
                        }).catch(() => {});
                    }}
                  >
                    删除所选
                  </button>
                </details>
              </section>
            )}
            <section className="task-list">
              {list.slice(0, displayCount).map((t, index) => (
                <div className="task-group" key={t.id}>
                  {!global &&
                    view === 'upcoming' &&
                    planMode === 'list' &&
                    sort === 'due' &&
                    (index === 0 ||
                      dayKey(scheduledAt(t)!) !== dayKey(scheduledAt(list[index - 1]!)!)) && (
                      <h3 className="date-group">
                        {dayKey(scheduledAt(t)!) < today
                          ? '正在进行/此前安排'
                          : dayKey(scheduledAt(t)!) === today
                            ? '今天'
                            : dayKey(scheduledAt(t)!)}{' '}
                      </h3>
                    )}
                  {!global &&
                    view === 'today' &&
                    overdueTask(t) &&
                    (index === 0 || !overdueTask(list[index - 1]!)) && (
                      <h3 className="date-group overdue">逾期未完成</h3>
                    )}
                  {trash ? (
                    <div className="task-row">
                      <span>{t.title}</span>
                      <button onClick={() => void run(() => api.restore(t.id)).catch(() => {})}>
                        恢复任务
                      </button>
                    </div>
                  ) : (
                    row(t)
                  )}
                </div>
              ))}
              {!list.length && (
                <div className="empty-state">
                  <h2>
                    {query || filterCount
                      ? '没有匹配结果'
                      : trash
                        ? '回收站为空'
                        : view === 'today'
                          ? '今天的待办已处理'
                          : '暂时没有任务'}
                  </h2>
                  <p>
                    {query || filterCount ? '可以清除筛选，查看其他任务。' : '想到什么就记下来。'}
                  </p>
                </div>
              )}
            </section>
            {list.length > displayCount && (
              <button onClick={() => setDisplayCount((n) => n + 100)}>
                显示更多（还有 {list.length - displayCount} 项）
              </button>
            )}
            {view === 'today' && !global && completedToday.length > 0 && (
              <details className="today-completed">
                <summary>今天已完成 · {completedToday.length} 项</summary>
                {completedToday.map(row)}
              </details>
            )}
            {view === 'today' &&
              snapshot.learning.assignments.some(
                (a) =>
                  a.submission_state === 'unsubmitted' &&
                  indexes.tasks.get(a.task_id)?.status === 'completed',
              ) && (
                <details className="notice">
                  <summary>已完成但尚未提交的作业</summary>
                  {snapshot.learning.assignments
                    .filter(
                      (a) =>
                        a.submission_state === 'unsubmitted' &&
                        indexes.tasks.get(a.task_id)?.status === 'completed',
                    )
                    .map((a) => (
                      <p key={a.id}>
                        <a href={a.official_url} target="_blank" rel="noreferrer">
                          {a.original_title} · 去 eLearning 提交 ↗
                        </a>
                      </p>
                    ))}
                </details>
              )}
          </>
        )}
      </main>
      {newTask && (
        <TaskEditor
          tasks={tasks}
          courses={courses}
          files={snapshot.files}
          templates={catalog.plans}
          saveTemplate={saveTemplate}
          title={title}
          day={view === 'today' || view === 'upcoming' ? plannedDay : ''}
          course={filters.course}
          save={save}
          create={create}
          remove={remove}
          close={() => {
            setNewTask(false);
            setTitle('');
          }}
        />
      )}
      {active && (
        <TaskEditor
          key={active.id}
          task={active}
          tasks={tasks}
          courses={courses}
          files={snapshot.files}
          templates={catalog.plans}
          saveTemplate={saveTemplate}
          assignment={indexes.assignments.get(active.id)}
          save={save}
          create={create}
          remove={remove}
          close={() => setSelected(null)}
          ask={ask}
        />
      )}{' '}
      {settings && (
        <Settings
          api={api}
          snapshot={snapshot}
          run={run}
          close={() => {
            setSettings(false);
            setOpenModels(false);
          }}
          openModels={openModels}
          modelSettings={modelSettings}
          desktopLearning={desktopLearning}
        />
      )}
    </div>
  );
}
