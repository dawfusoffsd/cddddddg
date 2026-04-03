const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');

/**
 * Database Setup Script
 * Creates the initial database schema
 */

async function setupDatabase() {
  const schemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');
  
  try {
    console.log('🔧 Setting up database...\n');
    
    // Test connection first
    console.log('📡 Testing database connection...');
    const testResult = await pool.query('SELECT NOW() as current_time');
    console.log('✅ Database connected successfully:', testResult.rows[0].current_time);
    console.log('');
    
    // Read and execute schema
    console.log('📄 Reading schema file...');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    console.log('✅ Schema file loaded\n');
    
    console.log('🚀 Executing schema...');
    await pool.query(schema);
    console.log('✅ Schema created successfully\n');
    
    // Verify tables were created
    console.log('📊 Verifying tables...');
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('\n✅ Tables created:');
    tables.rows.forEach(table => {
      console.log(`   - ${table.table_name}`);
    });
    
    console.log('\n✨ Database setup completed successfully!\n');
    console.log('📝 Running migrations...\n');
    
    // Run migrations automatically
    const { runMigrations } = require('./migrate');
    await runMigrations();
    
    console.log('\n✨ Database setup and migrations completed successfully!\n');
    console.log('📝 Next steps:');
    console.log('   1. Seed data (optional): npm run seed');
    console.log('   2. Start server: npm start\n');
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Database setup failed:', error.message);
    console.error('Stack:', error.stack);
    await pool.end();
    process.exit(1);
  }
}

setupDatabase();
