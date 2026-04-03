const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');

/**
 * Migration Runner
 * Executes database migrations in order
 */

const migrationsDir = path.join(__dirname, '..', '..', 'database', 'migrations');

// Track which migrations have been run
async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
}

// Get list of executed migrations
async function getExecutedMigrations() {
  const result = await pool.query(
    'SELECT version FROM schema_migrations ORDER BY version'
  );
  return result.rows.map(row => row.version);
}

// Mark a migration as executed
async function markMigrationExecuted(version) {
  await pool.query(
    'INSERT INTO schema_migrations (version) VALUES ($1)',
    [version]
  );
}

// Run a single migration file
async function runMigration(migrationFile) {
  const version = path.basename(migrationFile, '.sql');
  const sql = fs.readFileSync(migrationFile, 'utf-8');
  
  console.log(`Running migration: ${version}...`);
  
  try {
    await pool.query('BEGIN');
    await pool.query(sql);
    await markMigrationExecuted(version);
    await pool.query('COMMIT');
    console.log(`✅ Migration ${version} completed successfully`);
    return true;
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error(`❌ Migration ${version} failed:`, error.message);
    throw error;
  }
}

// Run all pending migrations
async function runMigrations() {
  try {
    console.log('🔧 Starting database migrations...\n');
    
    await ensureMigrationsTable();
    const executedMigrations = await getExecutedMigrations();
    
    // Get all migration files
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();
    
    // Find pending migrations
    const pendingMigrations = files.filter(
      file => !executedMigrations.includes(path.basename(file, '.sql'))
    );
    
    if (pendingMigrations.length === 0) {
      console.log('✅ Database is up to date. No migrations to run.\n');
      return;
    }
    
    console.log(`Found ${pendingMigrations.length} pending migration(s)\n`);
    
    // Run each pending migration
    for (const migrationFile of pendingMigrations) {
      await runMigration(path.join(migrationsDir, migrationFile));
    }
    
    console.log('\n✅ All migrations completed successfully!\n');
  } catch (error) {
    console.error('\n❌ Migration process failed:', error.message);
    throw error;
  }
}

// Check migration status
async function checkStatus() {
  await ensureMigrationsTable();
  const executedMigrations = await getExecutedMigrations();
  
  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();
  
  console.log('\n📊 Migration Status:\n');
  console.log('Version'.padEnd(40), 'Status');
  console.log('-'.repeat(60));
  
  for (const file of files) {
    const version = path.basename(file, '.sql');
    const executed = executedMigrations.includes(version);
    const status = executed ? '✅ Executed' : '⏳ Pending';
    console.log(version.padEnd(40), status);
  }
  
  console.log('');
}

// Main execution
async function main() {
  const command = process.argv[2];
  
  try {
    if (command === 'status') {
      await checkStatus();
    } else {
      await runMigrations();
    }
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error(error);
    await pool.end();
    process.exit(1);
  }
}

// Export for use in other scripts
module.exports = { runMigrations };

main();
