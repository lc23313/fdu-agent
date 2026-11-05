import type { Task, TaskPatch } from './task.ts';

export const scheduledAt = (task: Task) => task.start_at ?? task.due_at;
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
