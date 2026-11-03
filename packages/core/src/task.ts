import { z } from 'zod';

export const taskFields = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000),
  status: z.enum(['todo', 'in_progress', 'completed']),
  priority: z.number().int().min(0).max(3),
  start_at: z.iso.datetime({ offset: true }).nullable(),
  due_at: z.iso.datetime({ offset: true }).nullable(),
  parent_id: z.uuid().nullable(),
  course_id: z.uuid().nullable(),
  list_id: z.uuid().nullable(),
  tags: z.array(z.string().trim().min(1).max(60)).max(50),
  notes: z.string().max(20000),
  reminders: z
    .array(z.strictObject({ minutes_before: z.number().int().min(0).max(525600) }))
    .max(10),
});
export const taskCreatePatchSchema = taskFields.partial();
export const taskPatchSchema = taskCreatePatchSchema.refine(
  (value) => Object.keys(value).length > 0,
  '修改任务时至少需要一个字段',
);
export type TaskFields = z.infer<typeof taskFields>;
export type TaskPatch = z.infer<typeof taskPatchSchema>;

export const taskSchema = taskFields.extend({
  id: z.uuid(),
  user_id: z.uuid(),
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  completed_at: z.iso.datetime({ offset: true }).nullable(),
  deleted_at: z.iso.datetime({ offset: true }).nullable(),
});
export type Task = z.infer<typeof taskSchema>;

export function newTaskFields(title: string): TaskFields {
  return taskFields.parse({
    title,
    description: '',
    status: 'todo',
    priority: 0,
    start_at: null,
    due_at: null,
    parent_id: null,
    course_id: null,
    list_id: null,
    tags: [],
    notes: '',
    reminders: [],
  });
}

export function applyPatch(task: Task, patch: TaskPatch, now: string): Task {
  return {
    ...task,
    ...patch,
    updated_at: now,
    completed_at:
      patch.status === undefined
        ? task.completed_at
        : patch.status === 'completed'
          ? (task.completed_at ?? now)
          : null,
  };
}
