// Database connections of the command: the job's scoped role for `ingest`, the migration
// role for `migrate` and `seed`. Every statement is parameterised.
import pg from 'pg';
import { requireEnv } from './env.js';

export type Client = InstanceType<typeof pg.Client>;

export async function connect(variable: 'DATABASE_URL' | 'MIGRATION_DATABASE_URL'): Promise<Client> {
  const client = new pg.Client({
    connectionString: requireEnv(variable),
    application_name: 'ai-news-backend',
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  return client;
}

export async function withClient<T>(
  variable: 'DATABASE_URL' | 'MIGRATION_DATABASE_URL',
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await connect(variable);
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function inTransaction<T>(client: Client, work: () => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    const result = await work();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}
