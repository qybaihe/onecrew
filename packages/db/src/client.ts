import * as schema from './schema.js';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export interface OneCrewDatabaseClient {
  db: NodePgDatabase<typeof schema>;
  pool: Pool;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string): OneCrewDatabaseClient {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 10_000,
  });
  const db = drizzle({ client: pool, schema });

  return {
    db,
    pool,
    async close() {
      await pool.end();
    },
  };
}

export type OneCrewDatabase = OneCrewDatabaseClient['db'];
