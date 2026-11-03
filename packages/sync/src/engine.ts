import {
  operationSchema,
  resultSchema,
  changePageSchema,
  type Store,
  type Transport,
} from './types.ts';
import { projectTask } from './replica.ts';
import { ZodError } from 'zod';

export class SyncError extends Error {
  readonly kind: 'retry' | 'auth' | 'invalid';
  readonly retryAfterMs: number;
  constructor(message: string, kind: SyncError['kind'] = 'retry', retryAfterMs = 0) {
    super(message);
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

export class SyncEngine {
  readonly store: Store;
  readonly transport: Transport;
  private active: Promise<void> | null = null;
  constructor(store: Store, transport: Transport) {
    this.store = store;
    this.transport = transport;
  }

  run(force = false): Promise<void> {
    if (this.active) return this.active;
    this.active = this.execute(force).finally(() => {
      this.active = null;
    });
    return this.active;
  }

  private async execute(force: boolean): Promise<void> {
    const initial = await this.store.read();
    if (
      !force &&
      (initial.sync.next_retry_at > Date.now() ||
        initial.sync.needs_auth ||
        initial.sync.needs_attention)
    )
      return;
    try {
      for (let count = 0; count < 1000; count++) {
        const prepared = await this.store.update((state) => {
          const op = state.pending.find((item) => !item.blocked);
          if (!op) return null;
          op.request ??= operationSchema.parse({
            operation_id: op.local_id,
            entity_id: op.entity_id,
            base_version: op.base?.version ?? 0,
            action: op.action,
            ...(op.patch ? { patch: op.patch } : {}),
          });
          return structuredClone({ local_id: op.local_id, request: op.request });
        });
        if (!prepared) break;
        const result = resultSchema.parse(await this.transport.push(prepared.request));
        await this.store.update((state) => {
          const op = state.pending.find((item) => item.local_id === prepared.local_id);
          if (!op) return;
          if (
            result.task &&
            (result.task.user_id !== state.user_id || result.task.id !== op.entity_id)
          )
            throw new SyncError('服务器返回了不属于此操作的数据', 'invalid');
          if (result.status === 'conflict') {
            const local = projectTask(state, op.entity_id);
            state.conflicts.push({
              id: op.local_id,
              entity_id: op.entity_id,
              base: op.base,
              local,
              server: result.task,
            });
            for (const item of state.pending)
              if (item.entity_id === op.entity_id) item.blocked = true;
          } else {
            if ((state.shadow[result.task.id]?.version ?? 0) <= result.task.version)
              state.shadow[result.task.id] = result.task;
            state.pending = state.pending.filter((item) => item.local_id !== op.local_id);
            for (const next of state.pending)
              if (next.entity_id === op.entity_id && !next.request) next.base = result.task;
          }
        });
      }
      let more = true;
      while (more) {
        const { cursor } = await this.store.read();
        const page = changePageSchema.parse(await this.transport.pull(cursor));
        if (
          BigInt(page.next_cursor) < BigInt(cursor) ||
          (page.has_more && page.next_cursor === cursor)
        )
          throw new SyncError('服务器同步游标无效', 'invalid');
        await this.store.update((state) => {
          for (const change of page.changes) {
            if (
              change.task.user_id !== state.user_id ||
              BigInt(change.sequence) <= BigInt(cursor) ||
              BigInt(change.sequence) > BigInt(page.next_cursor)
            )
              throw new SyncError('服务器变化页无效', 'invalid');
            if ((state.shadow[change.task.id]?.version ?? 0) < change.task.version)
              state.shadow[change.task.id] = change.task;
            for (const conflict of state.conflicts)
              if (
                conflict.entity_id === change.task.id &&
                (conflict.server?.version ?? 0) < change.task.version
              )
                conflict.server = change.task;
          }
          if (BigInt(page.next_cursor) > BigInt(state.cursor)) state.cursor = page.next_cursor;
        });
        more = page.has_more;
      }
      await this.store.update((state) => {
        state.sync = {
          attempts: 0,
          next_retry_at: 0,
          error: null,
          needs_auth: false,
          needs_attention: false,
        };
      });
    } catch (error) {
      const failure =
        error instanceof SyncError
          ? error
          : new SyncError(
              error instanceof Error ? error.message : '同步失败',
              error instanceof ZodError ? 'invalid' : 'retry',
            );
      await this.store.update((state) => {
        const attempts = state.sync.attempts + 1;
        const delay =
          failure.kind === 'invalid'
            ? 24 * 60 * 60 * 1000
            : Math.max(
                failure.retryAfterMs,
                Math.min(300000, 1000 * 2 ** Math.min(attempts, 8)) * (0.75 + Math.random() * 0.5),
              );
        state.sync = {
          attempts,
          error: failure.message,
          needs_auth: failure.kind === 'auth',
          needs_attention: failure.kind === 'invalid',
          next_retry_at: Date.now() + delay,
        };
      });
      throw failure;
    }
  }
}
