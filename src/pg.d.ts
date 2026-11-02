// The part of the `pg` 8.23.1 interface this command uses. A local declaration instead of
// the @types/pg package (no further dependency; priitkustala/ai-news#40, plan step 2).
declare module 'pg' {
  export interface QueryResult<R = Record<string, unknown>> {
    rows: R[];
    rowCount: number | null;
  }
  export interface ClientConfig {
    connectionString?: string;
    application_name?: string;
    connectionTimeoutMillis?: number;
  }
  export class Client {
    constructor(config?: ClientConfig);
    connect(): Promise<void>;
    query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
    end(): Promise<void>;
  }
  const pg: { Client: typeof Client };
  export default pg;
}
