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
    this.db.version(2).stores({ states: 'user_id', revisions: 'user_id' });
    this.state = this.db.table('states');
  }
  async read(): Promise<ReplicaState> {
    return (await this.state.get(this.userId)) ?? emptyState(this.userId);
  }
  async revision(): Promise<number> {
    return (await this.db.table('revisions').get(this.userId))?.revision ?? 0;
  }
  async update<T>(fn: (state: ReplicaState) => T): Promise<T> {
    return this.db.transaction('rw', this.state, this.db.table('revisions'), async () => {
      const state = await this.read();
      const result = fn(state);
      await this.state.put(state);
      await this.db
        .table('revisions')
        .put({ user_id: this.userId, revision: (await this.revision()) + 1 });
      return result;
    });
  }
  close(): void {
    this.db.close();
  }
}
