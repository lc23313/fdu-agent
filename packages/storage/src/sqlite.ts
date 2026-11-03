import { emptyState, type ReplicaState, type Store } from '../../sync/src/types.ts';

export interface SqliteConnection {
  exec(sql: string): unknown;
  prepare(sql: string): {
    get(...bindings: string[]): unknown;
    run(...bindings: string[]): unknown;
  };
}

export class SqliteStore implements Store {
  readonly db: SqliteConnection;
  readonly userId: string;
  constructor(db: SqliteConnection, userId: string) {
    emptyState(userId);
    this.db = db;
    this.userId = userId;
    db.exec('CREATE TABLE IF NOT EXISTS fdu_schema_migrations (version INTEGER PRIMARY KEY)');
    db.exec(
      'CREATE TABLE IF NOT EXISTS fdu_replica_state (user_id TEXT PRIMARY KEY, data TEXT NOT NULL)',
    );
    db.prepare('INSERT OR IGNORE INTO fdu_replica_state(user_id,data) VALUES (?,?)').run(
      userId,
      JSON.stringify(emptyState(userId)),
    );
    db.exec('INSERT OR IGNORE INTO fdu_schema_migrations(version) VALUES (1)');
  }
  async read(): Promise<ReplicaState> {
    return this.load();
  }
  private load(): ReplicaState {
    const row = this.db
      .prepare('SELECT data FROM fdu_replica_state WHERE user_id=?')
      .get(this.userId) as { data: string };
    return JSON.parse(row.data);
  }
  async update<T>(fn: (state: ReplicaState) => T): Promise<T> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.load();
      const result = fn(state);
      this.db
        .prepare('UPDATE fdu_replica_state SET data=? WHERE user_id=?')
        .run(JSON.stringify(state), this.userId);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close(): void {}
}
