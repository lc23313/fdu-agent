import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { changePageSchema, resultSchema, type Operation, type Transport } from './types.ts';
import { SyncError } from './engine.ts';

export class SupabaseTransport implements Transport {
  readonly client: SupabaseClient;
  readonly userId: string;
  constructor(client: SupabaseClient, userId: string) {
    this.client = client;
    this.userId = z.uuid().parse(userId);
  }

  private async rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data: auth, error: authError } = await this.client.auth.getSession();
    if (authError || auth.session?.user.id !== this.userId)
      throw new SyncError('请重新登录此账号后同步', 'auth');
    const { data, error } = await this.client
      .rpc(name, args)
      .abortSignal(AbortSignal.timeout(30000));
    if (error) {
      if (['PGRST301', 'PGRST302', '42501'].includes(error.code))
        throw new SyncError('身份或权限已失效', 'auth');
      if (['22023', '23503', '23514', '23502', '22P02', '22007', '22008'].includes(error.code))
        throw new SyncError(error.message, 'invalid');
      throw new SyncError(error.message);
    }
    return data;
  }
  async push(operation: Operation) {
    return resultSchema.parse(await this.rpc('fdu_push_task', { p_operation: operation }));
  }
  async pull(cursor: string) {
    return changePageSchema.parse(
      await this.rpc('fdu_pull_tasks', { p_cursor: cursor, p_limit: 100 }),
    );
  }

  listen(onChange: () => void): () => void {
    const channel = this.client
      .channel(`fdu-sync-${this.userId}-${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'fdu_sync_heads',
          filter: `user_id=eq.${this.userId}`,
        },
        onChange,
      )
      .subscribe();
    return () => {
      void this.client.removeChannel(channel);
    };
  }
}
