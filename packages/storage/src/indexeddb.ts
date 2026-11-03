import { Dexie, type Table } from 'dexie';
import { emptyState, type ReplicaState, type Store } from '../../sync/src/types.ts';

export class IndexedDbStore implements Store {
  readonly db: Dexie;
  readonly state: Table<ReplicaState, string>;
  readonly userId: string;
  constructor(name: string, userId: string) {
    emptyState(userId);
    this.userId = userId;
    this.db = new Dexie(name);
    this.db.version(1).stores({ states: 'user_id' });
    this.state = this.db.table('states');
  }
  async read(): Promise<ReplicaState> {
    return (await this.state.get(this.userId)) ?? emptyState(this.userId);
  }
  async update<T>(fn: (state: ReplicaState) => T): Promise<T> {
    return this.db.transaction('rw', this.state, async () => {
      const state = await this.read();
      const result = fn(state);
      await this.state.put(state);
      return result;
    });
  }
  close(): void {
    this.db.close();
  }
}
