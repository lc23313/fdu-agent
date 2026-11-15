import type { Store } from '../../sync/src/types.ts';
import { z } from 'zod';
import {
  activeSession,
  applyChanges,
  emptyStudy,
  projectStudy,
  validateStudy,
  dataSchema,
  studyOperationSchema,
  type StudyData,
  type StudyLocal,
  type StudyOperation,
  type Collection,
  type Item,
} from './model.ts';

export const studyResponseSchema = z.object({
  status: z.enum(['ok', 'conflict']),
  data: dataSchema,
  version: z.number().int().min(0),
  reason: z.string().optional(),
});
export type StudyResponse = z.infer<typeof studyResponseSchema>;
export class StudyReplica {
  readonly store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  async snapshot() {
    const state = ((await this.store.read()) as StudyLocal).study ?? emptyStudy();
    return {
      data: projectStudy(state),
      pending: state.pending.length,
      conflicts: state.conflicts,
      error: state.error,
    };
  }
  async commit(
    changes: { collection: Collection; id: string; after: Item | null; before?: unknown }[],
  ) {
    return this.store.update((raw) => {
      const state = ((raw as StudyLocal).study ??= emptyStudy());
      const data = projectStudy(state);
      const operation = studyOperationSchema.parse({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        changes: changes.map((c) => ({
          ...c,
          before: c.before === undefined ? (data[c.collection][c.id] ?? null) : c.before,
        })),
      });
      for (const c of operation.changes)
        if (JSON.stringify(data[c.collection][c.id] ?? null) !== JSON.stringify(c.before))
          throw new Error('数据已被另一设备修改，请重新打开');
      validateStudy(applyChanges(data, operation));
      state.pending.push(operation);
      return operation.id;
    });
  }
  async deleteTask(id: string) {
    const { data } = await this.snapshot();
    const task = data.tasks[id];
    if (!task) throw new Error('任务不存在');
    return this.commit([
      { collection: 'tasks', id, after: null, before: task },
      ...Object.values(data.blocks)
        .filter((b) => b.task_id === id)
        .map((b) => ({ collection: 'blocks' as const, id: b.id, before: b, after: null })),
    ]);
  }
  async start(session: StudyData['sessions'][string]) {
    const { data } = await this.snapshot();
    if (activeSession(data)) throw new Error('请先结束当前学习并确认保存总结');
    return this.commit([{ collection: 'sessions', id: session.id, after: session }]);
  }
  private active: Promise<void> | null = null;
  sync(push: (operation: StudyOperation | null) => Promise<StudyResponse>) {
    if (this.active) return this.active;
    this.active = this.performSync(push).finally(() => {
      this.active = null;
    });
    return this.active;
  }
  private async performSync(push: (operation: StudyOperation | null) => Promise<StudyResponse>) {
    try {
      for (let count = 0; count < 1000; count++) {
        const request = await this.store.update((raw) => {
          const state = ((raw as StudyLocal).study ??= emptyStudy());
          if (state.inflight) return state.inflight;
          if (!state.pending.length) return null;
          const changes = new Map<string, StudyOperation['changes'][number]>();
          const batch: StudyOperation[] = [];
          for (const op of state.pending.slice(0, 100)) {
            const keys = new Set([
              ...changes.keys(),
              ...op.changes.map((c) => `${c.collection}/${c.id}`),
            ]);
            if (keys.size > 1000) break;
            batch.push(op);
            for (const c of op.changes) {
              const key = `${c.collection}/${c.id}`,
                prior = changes.get(key);
              changes.set(key, { ...c, before: prior ? prior.before : c.before });
            }
          }
          return (state.inflight = {
            operation: {
              id: crypto.randomUUID(),
              at: batch.at(-1)!.at,
              changes: [...changes.values()],
            },
            ids: batch.map((o) => o.id),
          });
        });
        const operation = request?.operation ?? null;
        const response = studyResponseSchema.parse(await push(operation));
        await this.store.update((raw) => {
          const latest = ((raw as StudyLocal).study ??= emptyStudy());
          if (response.version >= latest.version) {
            latest.shadow = response.data;
            latest.version = response.version;
          }
          latest.error = null;
          if (!operation) return;
          if (latest.inflight?.operation.id === operation.id) delete latest.inflight;
          if (!latest.pending.some((o) => request!.ids.includes(o.id))) return;
          if (response.status === 'ok')
            latest.pending = latest.pending.filter((o) => !request!.ids.includes(o.id));
          else {
            const affected = new Set(operation.changes.map((c) => `${c.collection}/${c.id}`));
            latest.pending = latest.pending.filter((o) => {
              if (!o.changes.some((c) => affected.has(`${c.collection}/${c.id}`))) return true;
              o.changes.forEach((c) => affected.add(`${c.collection}/${c.id}`));
              latest.conflicts.push({
                operation: o,
                reason: response.reason ?? '另一设备已修改数据，原始操作已保留',
              });
              return false;
            });
          }
        });
        if (!operation && !(await this.snapshot()).pending) return;
      }
    } catch (e) {
      await this.store.update((raw) => {
        ((raw as StudyLocal).study ??= emptyStudy()).error =
          e instanceof Error ? e.message : String(e);
      });
    }
  }
}
