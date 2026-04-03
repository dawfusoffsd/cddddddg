const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

// ─── Connection Pool ──────────────────────────────────────────────────────────
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'inventory_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Increased to 10 seconds for production
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// ─── Pool Events ──────────────────────────────────────────────────────────────
pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('✅ New database connection established');
  }
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err.message);
});

// ─── Query Helper ─────────────────────────────────────────────────────────────
const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log(`📝 Query executed in ${duration}ms | rows: ${result.rowCount}`);
    }
    return result;
  } catch (error) {
    console.error('❌ Database query error:', error.message);
    throw error;
  }
};

// ─── Get Client (for Transactions) ───────────────────────────────────────────
const getClient = async () => {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);

  client.query = (...args) => {
    client.lastQuery = args;
    return originalQuery(...args);
  };

  client.release = () => {
    client.query = originalQuery;
    client.release = release;
    return release();
  };

  return client;
};

// ─── Transaction Helper ───────────────────────────────────────────────────────
const transaction = async (callback) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// ─── Test Connection ──────────────────────────────────────────────────────────
const testConnection = async () => {
  try {
    const result = await pool.query('SELECT NOW() AS current_time, version() AS pg_version');
    console.log('✅ Database connected successfully');
    console.log(`📅 Server time: ${result.rows[0].current_time}`);
    console.log(`🐘 PostgreSQL: ${result.rows[0].pg_version.split(' ')[0]} ${result.rows[0].pg_version.split(' ')[1]}`);
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw error;
  }
};

// ─── Has Role Helper ──────────────────────────────────────────────────────────
const hasRole = async (userId, role) => {
  const result = await pool.query(
    'SELECT has_role($1, $2) AS result',
    [userId, role]
  );
  return result.rows[0]?.result || false;
};

// ─── Get User Role ────────────────────────────────────────────────────────────
const getUserRole = async (userId) => {
  const result = await pool.query(
    'SELECT get_user_role($1) AS role',
    [userId]
  );
  return result.rows[0]?.role || 'user';
};

module.exports = {
  pool,
  query,
  getClient,
  transaction,
  testConnection,
  hasRole,
  getUserRole,
};
