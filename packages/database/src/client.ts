import { Pool } from 'pg';

/**
 * Crea el pool de conexiones. Un error en un cliente inactivo (por ejemplo, si
 * PostgreSQL se reinicia) no debe tumbar el proceso, así que se captura aquí.
 */
export function createPool(connectionString: string, onError?: (error: Error) => void): Pool {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (error) => {
    if (onError) onError(error);
    else console.error('[database] error en un cliente inactivo:', error.message);
  });
  return pool;
}
