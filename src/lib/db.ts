import sql from 'mssql';

const config: sql.config = {
  server: process.env.DB_SERVER || '106.201.231.27',
  port: parseInt(process.env.DB_PORT || '58815'),
  database: process.env.DB_DATABASE || 'BPMStagging',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'ash@2011',
  options: {
    encrypt: false,           // IP-based host — TLS SNI rejects IP as servername
    trustServerCertificate: true,
    enableArithAbort: true,
    connectTimeout: 30000,
    requestTimeout: 60000,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool: sql.ConnectionPool | null = null;

export async function getDb(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) return pool;
  pool = await new sql.ConnectionPool(config).connect();
  return pool;
}

export { sql };
