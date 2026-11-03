import { z } from 'zod';
import { taskSchema, taskPatchSchema, type Task, type TaskPatch } from '../../core/src/task.ts';

export const operationSchema = z.strictObject({
  operation_id: z.uuid(),
  entity_id: z.uuid(),
  base_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  action: z.enum(['create', 'patch', 'delete', 'restore']),
  patch: taskPatchSchema.optional(),
});
export type Operation = z.infer<typeof operationSchema>;
export const resultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), task: taskSchema }),
  z.object({ status: z.literal('conflict'), task: taskSchema.nullable() }),
]);
export type PushResult = z.infer<typeof resultSchema>;

export interface Pending {
  local_id: string;
  entity_id: string;
  action: Operation['action'];
  patch?: TaskPatch;
  base: Task | null;
  created_at: string;
  request: Operation | null;
  blocked: boolean;
}
export interface Conflict {
  id: string;
  entity_id: string;
  base: Task | null;
  local: Task | null;
  server: Task | null;
}
export interface ReplicaState {
  user_id: string;
  cursor: string;
  shadow: Record<string, Task>;
  pending: Pending[];
  conflicts: Conflict[];
  sync: {
    attempts: number;
    next_retry_at: number;
    error: string | null;
    needs_auth: boolean;
    needs_attention: boolean;
  };
}
export const changePageSchema = z.object({
  changes: z.array(z.object({ sequence: z.string().regex(/^\d+$/), task: taskSchema })),
  next_cursor: z.string().regex(/^\d+$/),
  has_more: z.boolean(),
});
export type ChangePage = z.infer<typeof changePageSchema>;
export interface Transport {
  push(operation: Operation): Promise<PushResult>;
  pull(cursor: string): Promise<ChangePage>;
}
export interface Store {
  read(): Promise<ReplicaState>;
  update<T>(fn: (state: ReplicaState) => T): Promise<T>;
  close(): void;
}
export function emptyState(userId: string): ReplicaState {
  z.uuid().parse(userId);
  return {
    user_id: userId,
    cursor: '0',
    shadow: {},
    pending: [],
    conflicts: [],
    sync: { attempts: 0, next_retry_at: 0, error: null, needs_auth: false, needs_attention: false },
  };
}
