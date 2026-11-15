import { z } from 'zod';
import type { Task } from '../../core/src/task.ts';
import { dayKey } from '../../core/src/schedule.ts';

export const studyTaskSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100),
  mode: z.enum(['complete', 'timer']),
  focus_minutes: z.number().int().min(1).max(360),
});
export type StudyTask = z.infer<typeof studyTaskSchema>;
export const blockSchema = z
  .object({
    id: z.uuid(),
    task_id: z.uuid(),
    day: z.number().int().min(0).max(6),
    start: z.number().int().min(450).max(1290).multipleOf(30),
    end: z.number().int().min(480).max(1320).multipleOf(30),
  })
  .refine((b) => b.end > b.start, '结束时间必须晚于开始时间');
export type StudyBlock = z.infer<typeof blockSchema>;
const stamp = z.iso.datetime({ offset: true });
export const sessionSchema = z.object({
  id: z.uuid(),
  task: studyTaskSchema,
  method: z.enum(['stopwatch', 'pomodoro']),
  status: z.enum(['focus', 'paused', 'awaiting', 'rest', 'summary', 'saved']),
  started_at: stamp,
  ended_at: stamp.nullable(),
  focus_minutes: z.number().int().min(1).max(360),
  rest_minutes: z.number().int().min(1).max(120),
  round: z.number().int().min(1),
  rest_until: stamp.nullable(),
  intervals: z.array(
    z.object({ start: stamp, end: stamp.nullable(), round: z.number().int().min(1) }),
  ),
});
export type StudySession = z.infer<typeof sessionSchema>;
export const recordSchema = z
  .object({
    id: z.uuid(),
    task: studyTaskSchema,
    date: z.iso.date(),
    started_at: stamp,
    ended_at: stamp,
    seconds: z.number().int().min(0).max(604800),
    method: z.enum(['complete', 'stopwatch', 'pomodoro']),
    rounds: z.number().int().min(0),
    early: z.boolean(),
  })
  .refine(
    (r) =>
      Date.parse(r.ended_at) >= Date.parse(r.started_at) &&
      (r.method === 'complete'
        ? r.seconds === 0 && r.rounds === 0
        : r.seconds <= Math.ceil((Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000)),
    '请核对学习起止时间与有效时长',
  );
export type StudyRecord = z.infer<typeof recordSchema>;
export const dataSchema = z.object({
  tasks: z.record(z.string(), studyTaskSchema),
  blocks: z.record(z.string(), blockSchema),
  sessions: z.record(z.string(), sessionSchema),
  records: z.record(z.string(), recordSchema),
  meta: z.record(z.string(), z.object({ id: z.string(), imported: z.boolean() })),
});
export type StudyData = z.infer<typeof dataSchema>;
export type Collection = keyof StudyData;
export type Item = StudyTask | StudyBlock | StudySession | StudyRecord | StudyData['meta'][string];
export const changeSchema = z.object({
  collection: z.enum(['tasks', 'blocks', 'sessions', 'records', 'meta']),
  id: z.string().min(1).max(80),
  before: z.unknown(),
  after: z.unknown(),
});
export const studyOperationSchema = z.object({
  id: z.uuid(),
  at: stamp,
  changes: z.array(changeSchema).min(1).max(1000),
});
export type StudyOperation = z.infer<typeof studyOperationSchema>;
export interface StudyConflict {
  operation: StudyOperation;
  reason: string;
  resolved?: boolean;
}
export const studyStateSchema = z.object({
  shadow: dataSchema,
  version: z.number().int().min(0),
  pending: z.array(studyOperationSchema),
  conflicts: z.array(
    z.object({
      operation: studyOperationSchema,
      reason: z.string(),
      resolved: z.boolean().optional(),
    }),
  ),
  error: z.string().nullable(),
});
export interface StudyState {
  shadow: StudyData;
  version: number;
  pending: StudyOperation[];
  conflicts: StudyConflict[];
  error: string | null;
  inflight?: { operation: StudyOperation; ids: string[] };
}
export type StudyLocal = { study?: StudyState };
export const emptyData = (): StudyData => ({
  tasks: {},
  blocks: {},
  sessions: {},
  records: {},
  meta: {},
});
export const emptyStudy = (): StudyState => ({
  shadow: emptyData(),
  version: 0,
  pending: [],
  conflicts: [],
  error: null,
});
export function applyChanges(data: StudyData, operation: StudyOperation) {
  for (const c of operation.changes) {
    const items = data[c.collection] as Record<string, unknown>;
    if (c.after === null) delete items[c.id];
    else items[c.id] = structuredClone(c.after);
  }
  return data;
}
export function projectStudy(state: StudyState) {
  return state.pending.reduce(applyChanges, structuredClone(state.shadow));
}
export function validateStudy(input: StudyData): StudyData {
  const data = dataSchema.parse(input);
  for (const items of Object.values(data))
    for (const [id, item] of Object.entries(items))
      if (id !== item.id) throw new Error('学习数据标识不匹配');
  const blocks = Object.values(data.blocks);
  for (const b of blocks) {
    if (!data.tasks[b.task_id]) throw new Error('预设任务已删除');
    if (
      blocks.some(
        (other) =>
          other.id !== b.id && other.day === b.day && other.start < b.end && other.end > b.start,
      )
    )
      throw new Error('预设时间块不能重叠，请选择空白时间');
  }
  if (Object.values(data.sessions).filter((s) => s.status !== 'saved').length > 1)
    throw new Error('请先结束当前学习并确认保存总结');
  return data;
}
export function activeSession(data: StudyData) {
  return Object.values(data.sessions).find((s) => s.status !== 'saved');
}
export function effectiveSeconds(session: StudySession, now = Date.now(), round?: number) {
  return Math.floor(
    session.intervals
      .filter((i) => round === undefined || i.round === round)
      .reduce((sum, i) => {
        const elapsed = Math.max(0, (i.end ? Date.parse(i.end) : now) - Date.parse(i.start));
        if (session.method === 'stopwatch') return sum + elapsed;
        const prior = session.intervals
          .filter(
            (j) => j !== i && j.round === i.round && Date.parse(j.start) < Date.parse(i.start),
          )
          .reduce((n, j) => n + Math.max(0, Date.parse(j.end ?? j.start) - Date.parse(j.start)), 0);
        return sum + Math.min(elapsed, Math.max(0, session.focus_minutes * 60000 - prior));
      }, 0) / 1000,
  );
}
export function recoverSession(input: StudySession, now = Date.now()): StudySession {
  const s = structuredClone(input);
  const open = s.intervals.find((i) => !i.end);
  if (open && s.method === 'pomodoro') {
    const prior = s.intervals
      .filter((i) => i !== open && i.round === s.round)
      .reduce((n, i) => n + Math.max(0, Date.parse(i.end ?? i.start) - Date.parse(i.start)), 0);
    const deadline = Date.parse(open.start) + Math.max(0, s.focus_minutes * 60000 - prior);
    if (now >= deadline) {
      open.end = new Date(deadline).toISOString();
      s.status = 'awaiting';
    }
  }
  if (s.status === 'rest' && s.rest_until && now >= Date.parse(s.rest_until)) s.status = 'awaiting';
  return s;
}
export function transitionSession(
  input: StudySession,
  action: 'pause' | 'resume' | 'end' | 'rest' | 'next',
  now = Date.now(),
) {
  const s = recoverSession(input, now),
    at = new Date(now).toISOString();
  if (['saved', 'summary'].includes(s.status)) throw new Error('此会话已结束，请确认总结');
  if (action === 'pause' || action === 'end') {
    s.intervals
      .filter((i) => !i.end)
      .forEach((i) => {
        i.end = at;
      });
    if (action === 'end') {
      s.status = 'summary';
      s.ended_at = at;
    } else if (s.status === 'focus') s.status = 'paused';
  } else if (action === 'resume' && s.status === 'paused') {
    s.status = 'focus';
    s.intervals.push({ start: at, end: null, round: s.round });
  } else if (action === 'rest' && s.status === 'awaiting' && !s.rest_until) {
    s.status = 'rest';
    s.rest_until = new Date(now + s.rest_minutes * 60000).toISOString();
  } else if (action === 'next' && ['awaiting', 'rest'].includes(s.status)) {
    s.round++;
    s.status = 'focus';
    s.rest_until = null;
    s.intervals.push({ start: at, end: null, round: s.round });
  } else throw new Error('会话状态已改变，请刷新后重试');
  return s;
}
export function sessionRecord(s: StudySession): StudyRecord {
  if (!s.ended_at) throw new Error('请先结束学习');
  return recordSchema.parse({
    id: s.id,
    task: s.task,
    date: dayKey(s.started_at),
    started_at: s.started_at,
    ended_at: s.ended_at,
    seconds: effectiveSeconds(s, Date.parse(s.ended_at)),
    method: s.method,
    rounds: s.method === 'pomodoro' ? s.round : 0,
    early:
      s.method === 'pomodoro' &&
      effectiveSeconds(s, Date.parse(s.ended_at), s.round) < s.focus_minutes * 60,
  });
}
export function importPlan(tasks: Task[], data: StudyData) {
  const next = structuredClone(data),
    skipped: string[] = [];
  for (const task of tasks) {
    if (
      !task.start_at ||
      !task.due_at ||
      task.time_kind !== 'range' ||
      (task.repeat && task.repeat.frequency !== 'weekly')
    )
      continue;
    const start = new Date(task.start_at),
      end = new Date(task.due_at);
    const a = start.getHours() * 60 + start.getMinutes(),
      b = end.getHours() * 60 + end.getMinutes();
    if (dayKey(start) !== dayKey(end) || a % 30 || b % 30 || a < 450 || b > 1320 || b <= a) {
      skipped.push(task.title);
      continue;
    }
    let config = Object.values(next.tasks).find((t) => t.name.trim() === task.title.trim());
    if (!config) {
      config = {
        id: crypto.randomUUID(),
        name: task.title.trim(),
        category: '',
        mode: 'timer',
        focus_minutes: 25,
      };
      next.tasks[config.id] = config;
    }
    const block: StudyBlock = {
      id: crypto.randomUUID(),
      task_id: config.id,
      day: (start.getDay() + 6) % 7,
      start: a,
      end: b,
    };
    if (Object.values(next.blocks).some((o) => o.day === block.day && o.start < b && o.end > a)) {
      skipped.push(task.title);
      continue;
    }
    next.blocks[block.id] = block;
  }
  next.meta['plan-import'] = { id: 'plan-import', imported: true };
  return { data: validateStudy(next), skipped };
}
