import { z } from 'zod';
import { taskSchema, taskFields, taskCreatePatchSchema, type Task } from './task.ts';
import { projectTask } from '../../sync/src/replica.ts';
import type { ReplicaState } from '../../sync/src/types.ts';
export function readBackup(input: unknown) {
  const source = z
    .object({
      format: z.literal('fdu-personal-backup-v1'),
      state: z.object({
        user_id: z.uuid(),
        shadow: z.record(z.uuid(), taskSchema),
        pending: z
          .array(
            z.object({
              entity_id: z.uuid(),
              action: z.enum(['create', 'patch', 'delete', 'restore']),
              patch: taskCreatePatchSchema.optional(),
              created_at: z.iso.datetime({ offset: true }),
            }),
          )
          .max(20000),
      }),
    })
    .parse(input);
  const state = { ...source.state, conflicts: [] } as unknown as ReplicaState;
  const tasks: Task[] = [];
  for (const id of new Set([
    ...Object.keys(state.shadow),
    ...state.pending.map((p) => p.entity_id),
  ])) {
    const task = projectTask(state, id);
    if (task && !task.deleted_at) {
      taskFields.parse(
        Object.fromEntries(Object.keys(taskFields.shape).map((k) => [k, task[k as keyof Task]])),
      );
      tasks.push(task);
    }
  }
  if (tasks.length > 5000) throw new Error('单次最多恢复5000项任务');
  const ordered: Task[] = [];
  const remaining = [...tasks];
  while (remaining.length) {
    const index = remaining.findIndex(
      (t) => !t.parent_id || !remaining.some((parent) => parent.id === t.parent_id),
    );
    if (index < 0) throw new Error('备份存在父子循环');
    ordered.push(remaining.splice(index, 1)[0]!);
  }
  return ordered;
}
