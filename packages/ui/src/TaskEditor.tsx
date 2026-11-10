import { useState, useEffect, useRef } from 'react';
import { newTaskFields, type Task, type TaskFields, type TaskPatch } from '../../core/src/task.ts';
import { dayKey, moveTaskToDay } from '../../core/src/schedule.ts';
import { Modal } from './Modal.tsx';
import { TimeEditor } from './TimeEditor.tsx';
import type { Snapshot } from '../../client/src/client.ts';
import { submissionLabel } from '../../elearning/src/schema.ts';
export function TaskEditor({
  task,
  tasks,
  courses,
  title = '',
  day = '',
  course = '',
  assignment,
  save,
  create,
  remove,
  close,
  ask,
  templates = [],
  saveTemplate,
  files = [],
}: {
  task?: Task;
  tasks: Task[];
  courses: Snapshot['courses'];
  title?: string;
  day?: string;
  course?: string;
  assignment?: Snapshot['learning']['assignments'][number];
  save: (id: string, p: TaskPatch, base?: Task) => Promise<void>;
  create: (t: string, p: TaskPatch) => Promise<unknown>;
  remove: (id: string) => Promise<void>;
  close: () => void;
  ask?: (text: string) => void;
  templates?: Snapshot['catalog']['plans'];
  saveTemplate?: (title: string, patch: TaskPatch) => Promise<void>;
  files?: Snapshot['files'];
}) {
  const key = `fdu-task-draft:${localStorage.getItem('fdu-owner') ?? localStorage.getItem('fdu-local-id') ?? 'desktop'}:${task?.id ?? 'new'}`;
  const [initial] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as { base?: Task; fields: TaskFields };
    } catch {}
    const last = localStorage.getItem('fdu-last-time-kind');
    const next = new Date(Math.ceil((Date.now() + 60000) / 1800000) * 1800000);
    const d = day || dayKey(next);
    const begin = new Date(`${d}T${next.toTimeString().slice(0, 5)}`),
      end = new Date(begin.getTime() + 3600000);
    const preference: TaskPatch =
      !task && last === 'range'
        ? { time_kind: 'range', start_at: begin.toISOString(), due_at: end.toISOString() }
        : !task && last === 'deadline'
          ? { time_kind: 'deadline', start_at: null, due_at: new Date(`${d}T23:59`).toISOString() }
          : {};
    return {
      base: task,
      fields: {
        ...newTaskFields(task?.title || title || '新任务'),
        title,
        ...(task ?? {}),
        course_id: task?.course_id ?? (course || null),
        ...(!task && day
          ? { start_at: new Date(`${day}T00:00`).toISOString(), time_kind: 'day' as const }
          : {}),
        ...preference,
      },
    };
  });
  const [fields, setFields] = useState<TaskFields>(initial.fields),
    [base, setBase] = useState(initial.base),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [child, setChild] = useState('');
  const [tagsText, setTagsText] = useState(initial.fields.tags.join('，')),
    [message, setMessage] = useState(''),
    [notesOpen, setNotesOpen] = useState(!!task || !!initial.fields.notes);
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!task && matchMedia('(pointer: fine)').matches) titleInput.current?.focus();
  }, [task?.id]);
  const resetFields = (value: TaskFields) => {
    setFields(value);
    setTagsText(value.tags.join('，'));
  };
  const change = (patch: TaskPatch) => setFields((f) => ({ ...f, ...patch }));
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify({ base, fields }));
  }, [key, fields, base]);
  const changedElsewhere =
    !!task &&
    !!base &&
    Object.keys(newTaskFields('x'))
      .concat(['time_kind', 'repeat'])
      .some(
        (key) =>
          JSON.stringify(task[key as keyof Task] ?? null) !==
          JSON.stringify(base[key as keyof Task] ?? null),
      );
  const patch: TaskPatch = Object.fromEntries(
    Object.keys(newTaskFields('x'))
      .concat(['time_kind', 'repeat'])
      .filter((key) => key in fields)
      .map((key) => [key, fields[key as keyof TaskFields]]),
  );
  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      if (!fields.title.trim()) throw new Error('请填写任务标题');
      if (fields.time_kind === 'range' && fields.start_at === fields.due_at)
        throw new Error('开始与结束不能相同');
      if (task) await save(task.id, patch, base);
      else await create(fields.title, patch);
      localStorage.removeItem(key);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={task ? '任务详情' : '新建任务'} close={close} className="task-editor">
      <p className="editor-hint">草稿自动保留，关掉后也能继续填写。</p>
      {!task && templates.some((t) => t.template) && (
        <label>
          使用常用模板
          <select
            aria-label="任务模板"
            defaultValue=""
            onChange={(e) => {
              const template = templates.find((t) => t.id === e.target.value)?.template;
              if (template) {
                const next = {
                  ...newTaskFields(template.title || '新任务'),
                  ...template,
                  status: 'todo' as const,
                };
                resetFields({
                  ...next,
                  ...(next.start_at || next.due_at
                    ? moveTaskToDay(next as Task, day || dayKey(new Date()))
                    : {}),
                });
              }
            }}
          >
            <option value="">不使用模板</option>
            {templates
              .filter((t) => t.template)
              .map((t) => (
                <option value={t.id} key={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </label>
      )}
      {changedElsewhere && (
        <div className="notice" role="status">
          此任务已更新，你的输入仍保留。
          <button
            onClick={() => {
              if (confirm('载入最新任务？当前输入仍可先复制保存。')) {
                resetFields(task);
                setBase(task);
              }
            }}
          >
            载入最新内容
          </button>
          <button
            onClick={() => {
              const edits = Object.fromEntries(
                Object.entries(fields).filter(
                  ([key, value]) =>
                    JSON.stringify(value) !== JSON.stringify(base?.[key as keyof Task]),
                ),
              );
              resetFields({ ...task, ...edits });
              setBase(task);
            }}
          >
            基于新版本保留我的修改
          </button>
        </div>
      )}
      {assignment && (
        <details className="assignment-row">
          <summary>eLearning 原始信息 · {submissionLabel(assignment.submission_state)}</summary>
          <p>
            官方截止：
            {assignment.original_due_at
              ? new Date(assignment.original_due_at).toLocaleString('zh-CN')
              : '未设置'}
          </p>
          <p>{assignment.original_description}</p>
          <small>个人安排与完成状态独立于学校提交状态。</small>
          <a href={assignment.official_url} target="_blank" rel="noreferrer">
            打开官方作业 ↗
          </a>
        </details>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void finish();
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.requestSubmit();
          }
        }}
      >
        <label>
          任务标题
          <input
            aria-label="任务标题"
            ref={titleInput}
            name="title"
            value={fields.title}
            required
            maxLength={200}
            placeholder="给这件事起个名字"
            onChange={(e) => change({ title: e.target.value })}
          />
        </label>
        <TimeEditor value={fields} change={change} />
        {files.length > 0 && (
          <label>
            关联资料
            <select
              aria-label="关联资料"
              value=""
              onChange={(e) => {
                const file = files.find((f) => f.hash === e.target.value);
                if (file && !fields.notes.includes(file.hash))
                  change({ notes: fields.notes + `\n资料：${file.name} [sha256:${file.hash}]` });
              }}
            >
              <option value="">选择资料，保留在任务备注中</option>
              {files
                .filter((f) => !f.deleted_at)
                .map((f) => (
                  <option key={f.hash} value={f.hash}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {files
          .filter((f) => fields.notes.includes(f.hash))
          .map((f) => (
            <button
              type="button"
              key={f.hash}
              onClick={() =>
                window.dispatchEvent(new CustomEvent('fdu-open-document', { detail: f.hash }))
              }
            >
              打开资料：{f.name}
            </button>
          ))}
        <label>
          课程
          <select
            aria-label="课程"
            value={fields.course_id ?? ''}
            onChange={(e) => change({ course_id: e.target.value || null })}
          >
            <option value="">个人任务</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {notesOpen || fields.notes ? (
          <label>
            备注
            <textarea
              name="notes"
              aria-label="备注"
              value={fields.notes}
              placeholder="补充要点、参考链接，或者想法…"
              maxLength={20000}
              rows={3}
              onChange={(e) => change({ notes: e.target.value })}
            />
          </label>
        ) : (
          <button type="button" className="editor-add-note" onClick={() => setNotesOpen(true)}>
            ＋ 添加备注
          </button>
        )}
        <details className="editor-more">
          <summary>
            <span>更多选项</span>
            <small>
              {[
                fields.priority > 0,
                !!fields.tags.length,
                !!fields.reminders.length,
                !!fields.repeat,
                !!fields.parent_id,
                !!fields.description,
              ].filter(Boolean).length > 0
                ? ' · 已有设置'
                : ' · 优先级、提醒、重复'}
            </small>
          </summary>
          <div className="form-grid">
            <label>
              个人状态
              <select
                aria-label="个人状态"
                value={fields.status}
                onChange={(e) => change({ status: e.target.value as Task['status'] })}
              >
                {[
                  ['todo', '待办'],
                  ['in_progress', '进行中'],
                  ['completed', '已完成'],
                ].map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              优先级
              <select
                aria-label="优先级"
                value={fields.priority}
                onChange={(e) => change({ priority: Number(e.target.value) })}
              >
                {['无', '低', '中', '高'].map((v, i) => (
                  <option key={i} value={i}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            父任务
            <select
              aria-label="父任务"
              value={fields.parent_id ?? ''}
              onChange={(e) => change({ parent_id: e.target.value || null })}
            >
              <option value="">独立任务</option>
              {tasks
                .filter((t) => t.id !== task?.id && !t.deleted_at)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
          </label>
          <label>
            标签
            <input
              name="tags"
              value={tagsText}
              onChange={(e) => {
                setTagsText(e.target.value);
                change({
                  tags: e.target.value
                    .split(/[,，]/)
                    .map((t) => t.trim())
                    .filter(Boolean),
                });
              }}
            />
          </label>
          <label>
            任务描述
            <textarea
              name="description"
              value={fields.description}
              maxLength={20000}
              onChange={(e) => change({ description: e.target.value })}
            />
          </label>
          <label>
            {fields.time_kind === 'range' || !fields.due_at ? '开始前提醒' : '截止前提醒'}
            <select
              aria-label="提前提醒"
              value={fields.reminders[0]?.minutes_before ?? -1}
              onChange={(e) =>
                change({
                  reminders:
                    Number(e.target.value) < 0 ? [] : [{ minutes_before: Number(e.target.value) }],
                })
              }
            >
              {[
                [-1, '不提醒'],
                [0, '准点'],
                [15, '15 分钟'],
                [30, '30 分钟'],
                [60, '一小时'],
                [1440, '一天'],
              ].map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            重复
            <select
              aria-label="重复"
              value={fields.repeat?.frequency ?? ''}
              disabled={!fields.start_at && !fields.due_at}
              onChange={(e) =>
                change({
                  repeat: e.target.value
                    ? { frequency: e.target.value as 'daily', interval: 1 }
                    : null,
                })
              }
            >
              {[
                ['', '不重复'],
                ['daily', '每天'],
                ['weekly', '每周'],
                ['monthly', '每月'],
              ].map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {fields.repeat && (
            <>
              <label>
                间隔
                <input
                  aria-label="重复间隔"
                  type="number"
                  min={1}
                  max={52}
                  value={fields.repeat.interval}
                  onChange={(e) =>
                    change({ repeat: { ...fields.repeat!, interval: Number(e.target.value) } })
                  }
                />
              </label>
              <label>
                重复至
                <input
                  aria-label="重复截止日"
                  type="date"
                  min={dayKey(new Date())}
                  value={fields.repeat.until ?? ''}
                  onChange={(e) =>
                    change({ repeat: { ...fields.repeat!, until: e.target.value || undefined } })
                  }
                />
              </label>
              <small>
                完成本次后生成下一次。修改只影响本次和之后由它生成的任务，已有记录保留。
              </small>
            </>
          )}
          {saveTemplate && (
            <button
              type="button"
              onClick={() => {
                if (!fields.title.trim()) return;
                void saveTemplate(fields.title, { ...patch, status: 'todo', parent_id: null })
                  .then(() => setMessage('模板已保存，可在新建任务时选用'))
                  .catch((e) => setError(String(e)));
              }}
            >
              保存为常用模板
            </button>
          )}
          {task && (
            <button
              type="button"
              className="danger"
              onClick={() => {
                if (confirm('移到回收站？子任务保留。'))
                  void remove(task.id)
                    .then(() => {
                      localStorage.removeItem(key);
                      close();
                    })
                    .catch((e) => setError(String(e)));
              }}
            >
              删除任务
            </button>
          )}
        </details>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <div className="editor-actions">
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(key);
              close();
            }}
          >
            放弃草稿
          </button>
          <small className="editor-key" aria-hidden="true">
            Ctrl ↵ 保存
          </small>
          <button className="primary" disabled={busy || changedElsewhere}>
            {busy ? '保存中…' : task ? '保存任务' : '创建任务'}
          </button>
        </div>
      </form>
      {task && (
        <section className="subtasks">
          <h3>子任务</h3>
          {tasks
            .filter((t) => t.parent_id === task.id)
            .map((t) => (
              <label className="checkbox-label" key={t.id}>
                <input
                  type="checkbox"
                  aria-label={`完成 ${t.title}`}
                  checked={t.status === 'completed'}
                  onChange={() =>
                    void save(t.id, {
                      status: t.status === 'completed' ? 'todo' : 'completed',
                    }).catch((e) => setError(String(e)))
                  }
                />
                {t.title}
              </label>
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
              required
              maxLength={200}
              value={child}
              onChange={(e) => setChild(e.target.value)}
            />
            <button>添加</button>
          </form>
          {ask && (
            <div className="view-tabs">
              <button
                onClick={() =>
                  ask(`将任务“${task.title}”（ID:${task.id}）拆成可执行的子任务，先给我草稿。`)
                }
              >
                AI 拆解任务
              </button>
              <button
                onClick={() =>
                  ask(
                    `为任务“${task.title}”（ID:${task.id}）安排学习时间。先询问我的空闲时间，保留正式截止。`,
                  )
                }
              >
                AI 安排时间
              </button>
            </div>
          )}
        </section>
      )}
    </Modal>
  );
}
