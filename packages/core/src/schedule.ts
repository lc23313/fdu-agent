import type { Task, TaskPatch } from './task.ts';

export const scheduledAt = (task: Task) => task.start_at ?? task.due_at;
export const dayKey = (value: string | Date) => {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const isOverdue = (task: Task, now = Date.now()) =>
  task.status !== 'completed' &&
  task.time_kind !== 'range' &&
  task.time_kind !== 'day' &&
  !!task.due_at &&
  Date.parse(task.due_at) < now;
export const reminderAt = (task: Task) =>
  task.time_kind === 'range' || !task.due_at ? task.start_at : task.due_at;
export const inPlan = (task: Task, now = new Date()) =>
  !!scheduledAt(task) && dayKey(task.due_at ?? task.start_at!) >= dayKey(now);
export function nextOccurrence(task: Task): Pick<Task, 'start_at' | 'due_at'> | null {
  const at = scheduledAt(task);
  if (!task.repeat || !at) return null;
  const before = new Date(at),
    after = new Date(before);
  if (task.repeat.frequency === 'monthly') {
    const day = after.getDate();
    after.setDate(1);
    after.setMonth(after.getMonth() + task.repeat.interval);
    const last = new Date(after.getFullYear(), after.getMonth() + 1, 0).getDate();
    after.setDate(Math.min(day, last));
  } else
    after.setDate(
      after.getDate() + task.repeat.interval * (task.repeat.frequency === 'weekly' ? 7 : 1),
    );
  if (task.repeat.until && dayKey(after) > task.repeat.until) return null;
  const delta = after.getTime() - before.getTime();
  return {
    start_at: task.start_at ? new Date(Date.parse(task.start_at) + delta).toISOString() : null,
    due_at: task.due_at ? new Date(Date.parse(task.due_at) + delta).toISOString() : null,
  };
}
export function moveTaskToDay(task: Task, day: string): TaskPatch {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('请选择有效日期');
  const original = scheduledAt(task);
  if (!original) return { due_at: new Date(`${day}T23:59:00`).toISOString() };
  const before = new Date(original);
  const after = new Date(
    `${day}T${String(before.getHours()).padStart(2, '0')}:${String(before.getMinutes()).padStart(2, '0')}:${String(before.getSeconds()).padStart(2, '0')}`,
  );
  const shift = after.getTime() - before.getTime();
  return {
    ...(task.start_at
      ? { start_at: new Date(new Date(task.start_at).getTime() + shift).toISOString() }
      : {}),
    ...(task.due_at
      ? { due_at: new Date(new Date(task.due_at).getTime() + shift).toISOString() }
      : {}),
  };
}
