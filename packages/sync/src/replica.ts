import { z } from 'zod';
import {
  applyPatch,
  newTaskFields,
  taskPatchSchema,
  type Task,
  type TaskPatch,
} from '../../core/src/task.ts';
import type { Pending, ReplicaState, Store } from './types.ts';

export function projectTask(state: ReplicaState, id: string): Task | null {
  const conflict = state.conflicts.find((item) => item.entity_id === id);
  if (conflict) return conflict.local;
  let task = state.shadow[id] ?? null;
  for (const op of state.pending.filter((item) => item.entity_id === id)) {
    if (op.action === 'create') {
      task = {
        ...newTaskFields(op.patch?.title ?? ''),
        ...op.patch,
        id,
        user_id: state.user_id,
        version: 0,
        created_at: op.created_at,
        updated_at: op.created_at,
        completed_at: op.patch?.status === 'completed' ? op.created_at : null,
        deleted_at: null,
      };
    } else if (task) {
      if (op.action === 'patch') task = applyPatch(task, op.patch ?? {}, op.created_at);
      else task = { ...task, deleted_at: op.action === 'delete' ? op.created_at : null };
    }
  }
  return task;
}

export class Replica {
  readonly store: Store;
  constructor(store: Store) {
    this.store = store;
  }

  async list(includeDeleted = false): Promise<Task[]> {
    const state = await this.store.read();
    const ids = new Set([...Object.keys(state.shadow), ...state.pending.map((op) => op.entity_id)]);
    return [...ids]
      .map((id) => projectTask(state, id))
      .filter((task): task is Task => !!task && (includeDeleted || !task.deleted_at));
  }

  async create(title: string, patch: TaskPatch = {}): Promise<string> {
    const fields = { ...newTaskFields(title), ...taskPatchSchema.parse({ title, ...patch }) };
    const id = crypto.randomUUID();
    await this.store.update((state) => {
      state.pending.push({
        local_id: crypto.randomUUID(),
        entity_id: id,
        action: 'create',
        patch: fields,
        base: null,
        created_at: new Date().toISOString(),
        request: null,
        blocked: false,
      });
    });
    return id;
  }

  async change(id: string, patch: TaskPatch): Promise<void> {
    await this.enqueue(id, 'patch', taskPatchSchema.parse(patch));
  }
  async remove(id: string): Promise<void> {
    await this.enqueue(id, 'delete');
  }
  async restore(id: string): Promise<void> {
    await this.enqueue(id, 'restore');
  }

  private async enqueue(id: string, action: Pending['action'], patch?: TaskPatch): Promise<void> {
    z.uuid().parse(id);
    await this.store.update((state) => {
      const task = projectTask(state, id);
      if (!task) throw new Error('任务不存在');
      if (action !== 'restore' && task.deleted_at) throw new Error('任务已删除，请先恢复');
      if (action === 'restore' && !task.deleted_at) throw new Error('任务未删除');
      if (state.conflicts.some((conflict) => conflict.entity_id === id))
        throw new Error('请先处理任务冲突');
      if (patch?.parent_id) {
        let parent: string | null = patch.parent_id;
        const visited = new Set([id]);
        while (parent) {
          if (visited.has(parent)) throw new Error('子任务不能形成循环');
          visited.add(parent);
          const record = projectTask(state, parent);
          if (!record || record.deleted_at) throw new Error('父任务不可用');
          parent = record.parent_id;
        }
      }
      state.pending.push({
        local_id: crypto.randomUUID(),
        entity_id: id,
        action,
        patch,
        base: state.shadow[id] ?? null,
        created_at: new Date().toISOString(),
        request: null,
        blocked: false,
      });
    });
  }

  async resolve(id: string, choice: 'server' | 'local'): Promise<void> {
    await this.store.update((state) => {
      const conflict = state.conflicts.find((item) => item.id === id);
      if (!conflict) throw new Error('冲突不存在');
      if (choice === 'local' && conflict.server?.deleted_at)
        throw new Error('远端任务已删除，请先选择远端再显式恢复');
      if (choice === 'local' && !conflict.server) throw new Error('远端任务不存在，请导出本地草稿');
      state.pending = state.pending.filter((op) => op.entity_id !== conflict.entity_id);
      if (conflict.server) state.shadow[conflict.entity_id] = conflict.server;
      else delete state.shadow[conflict.entity_id];
      if (choice === 'local' && conflict.local) {
        const {
          title,
          description,
          status,
          priority,
          start_at,
          due_at,
          parent_id,
          course_id,
          list_id,
          tags,
          notes,
          reminders,
        } = conflict.local;
        state.pending.push({
          local_id: crypto.randomUUID(),
          entity_id: conflict.entity_id,
          action: conflict.local.deleted_at ? 'delete' : 'patch',
          ...(conflict.local.deleted_at
            ? {}
            : {
                patch: {
                  title,
                  description,
                  status,
                  priority,
                  start_at,
                  due_at,
                  parent_id,
                  course_id,
                  list_id,
                  tags,
                  notes,
                  reminders,
                },
              }),
          base: conflict.server,
          created_at: new Date().toISOString(),
          request: null,
          blocked: false,
        });
      }
      state.conflicts = state.conflicts.filter((item) => item.id !== id);
    });
  }
}
