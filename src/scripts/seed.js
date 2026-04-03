require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// ========================================
// Seed Data
// ========================================
const seedData = async () => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('🌱 Starting database seeding...\n');

    // ----------------------------------------
    // 1. Users
    // ----------------------------------------
    console.log('👤 Seeding users...');

    const adminPassword = await bcrypt.hash('Admin@123456', 12);
    const managerPassword = await bcrypt.hash('Manager@123456', 12);
    const userPassword = await bcrypt.hash('User@123456', 12);

    // Admin
    const adminResult = await client.query(`
      INSERT INTO users (name, email, password, is_active)
      VALUES ('مدير النظام', 'admin@inventory.com', $1, true)
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [adminPassword]);

    const adminId = adminResult.rows[0].id;

    await client.query(`
      INSERT INTO user_roles (user_id, role)
      VALUES ($1, 'admin')
      ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role
    `, [adminId]);

    // Manager
    const managerResult = await client.query(`
      INSERT INTO users (name, email, password, is_active)
      VALUES ('مدير المخزون', 'manager@inventory.com', $1, true)
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [managerPassword]);

    const managerId = managerResult.rows[0].id;

    await client.query(`
      INSERT INTO user_roles (user_id, role)
      VALUES ($1, 'manager')
      ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role
    `, [managerId]);

    // Regular User
    const userResult = await client.query(`
      INSERT INTO users (name, email, password, is_active)
      VALUES ('مستخدم عادي', 'user@inventory.com', $1, true)
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [userPassword]);

    const userId = userResult.rows[0].id;

    await client.query(`
      INSERT INTO user_roles (user_id, role)
      VALUES ($1, 'user')
      ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role
    `, [userId]);

    console.log('  ✅ Users seeded');

    // ----------------------------------------
    // 2. Categories
    // ----------------------------------------
    console.log('🏷️  Seeding categories...');

    const categories = [
      { name: 'أجهزة كمبيوتر', icon: '💻', color: '#3B82F6' },
      { name: 'طابعات', icon: '🖨️', color: '#10B981' },
      { name: 'شاشات', icon: '🖥️', color: '#8B5CF6' },
      { name: 'هواتف', icon: '📱', color: '#F59E0B' },
      { name: 'أجهزة شبكة', icon: '🌐', color: '#EF4444' },
      { name: 'ملحقات', icon: '🖱️', color: '#6B7280' },
      { name: 'أثاث مكتبي', icon: '🪑', color: '#92400E' },
      { name: 'معدات أخرى', icon: '📦', color: '#374151' },
    ];

    const categoryIds = [];
    for (const cat of categories) {
      const result = await client.query(`
        INSERT INTO categories (name, icon, color)
        VALUES ($1, $2, $3)
        ON CONFLICT (name) DO UPDATE SET icon = EXCLUDED.icon, color = EXCLUDED.color
        RETURNING id
      `, [cat.name, cat.icon, cat.color]);
      categoryIds.push(result.rows[0].id);
    }

    console.log('  ✅ Categories seeded');

    // ----------------------------------------
    // 3. Branches
    // ----------------------------------------
    console.log('🏢 Seeding branches...');

    const branches = [
      { name: 'الفرع الرئيسي', location: 'القاهرة', phone: '01000000001', manager: 'أحمد محمد' },
      { name: 'فرع الإسكندرية', location: 'الإسكندرية', phone: '01000000002', manager: 'محمد علي' },
      { name: 'فرع الجيزة', location: 'الجيزة', phone: '01000000003', manager: 'علي حسن' },
    ];

    const branchIds = [];
    for (const branch of branches) {
      const result = await client.query(`
        INSERT INTO branches (name, location, phone, manager)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (name) DO UPDATE SET location = EXCLUDED.location
        RETURNING id
      `, [branch.name, branch.location, branch.phone, branch.manager]);
      branchIds.push(result.rows[0].id);
    }

    console.log('  ✅ Branches seeded');

    // ----------------------------------------
    // 4. Teams
    // ----------------------------------------
    console.log('👥 Seeding teams...');

    const teams = [
      { name: 'فريق تقنية المعلومات', manager: 'أحمد محمد', team_leader: 'سامي عبدالله' },
      { name: 'فريق المبيعات', manager: 'محمد علي', team_leader: 'كريم حسين' },
      { name: 'فريق الدعم الفني', manager: 'علي حسن', team_leader: 'هشام نبيل' },
    ];

    const teamIds = [];
    for (const team of teams) {
      const result = await client.query(`
        INSERT INTO teams (name, manager, team_leader)
        VALUES ($1, $2, $3)
        ON CONFLICT (name) DO UPDATE SET manager = EXCLUDED.manager
        RETURNING id
      `, [team.name, team.manager, team.team_leader]);
      teamIds.push(result.rows[0].id);
    }

    console.log('  ✅ Teams seeded');

    // ----------------------------------------
    // 5. Employees
    // ----------------------------------------
    console.log('👨‍💼 Seeding employees...');

    const employees = [
      { name: 'أحمد محمد السيد', national_id: '29901010100001', department: 'تقنية المعلومات', branch_id: branchIds[0], team_id: teamIds[0], phone: '01111111111', email: 'ahmed@company.com' },
      { name: 'محمد علي حسن', national_id: '29901010100002', department: 'المبيعات', branch_id: branchIds[0], team_id: teamIds[1], phone: '01111111112', email: 'mohamed@company.com' },
      { name: 'سارة أحمد إبراهيم', national_id: '29901010100003', department: 'الدعم الفني', branch_id: branchIds[1], team_id: teamIds[2], phone: '01111111113', email: 'sara@company.com' },
      { name: 'علي حسين محمود', national_id: '29901010100004', department: 'تقنية المعلومات', branch_id: branchIds[1], team_id: teamIds[0], phone: '01111111114', email: 'ali@company.com' },
      { name: 'فاطمة عبدالله نور', national_id: '29901010100005', department: 'المبيعات', branch_id: branchIds[2], team_id: teamIds[1], phone: '01111111115', email: 'fatma@company.com' },
    ];

    const employeeIds = [];
    for (const emp of employees) {
      const result = await client.query(`
        INSERT INTO employees (name, national_id, department, branch_id, team_id, phone, email, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
        ON CONFLICT (national_id) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `, [emp.name, emp.national_id, emp.department, emp.branch_id, emp.team_id, emp.phone, emp.email]);
      employeeIds.push(result.rows[0].id);
    }

    console.log('  ✅ Employees seeded');

    // ----------------------------------------
    // 6. Inventory Items
    // ----------------------------------------
    console.log('📦 Seeding inventory items...');

    const inventoryItems = [
      { name: 'لابتوب Dell Latitude', brand: 'Dell', model: 'Latitude 5520', category_id: categoryIds[0], quantity: 10, available_quantity: 8, serial_number: 'DELL-001', condition: 'new' },
      { name: 'لابتوب HP EliteBook', brand: 'HP', model: 'EliteBook 840', category_id: categoryIds[0], quantity: 5, available_quantity: 3, serial_number: 'HP-001', condition: 'good' },
      { name: 'طابعة Canon', brand: 'Canon', model: 'LBP6030', category_id: categoryIds[1], quantity: 3, available_quantity: 2, serial_number: 'CAN-001', condition: 'good' },
      { name: 'شاشة Samsung 24"', brand: 'Samsung', model: 'S24F350', category_id: categoryIds[2], quantity: 15, available_quantity: 12, serial_number: 'SAM-001', condition: 'new' },
      { name: 'هاتف iPhone 13', brand: 'Apple', model: 'iPhone 13', category_id: categoryIds[3], quantity: 8, available_quantity: 6, serial_number: 'APL-001', condition: 'new' },
      { name: 'راوتر Cisco', brand: 'Cisco', model: 'RV340', category_id: categoryIds[4], quantity: 4, available_quantity: 4, serial_number: 'CIS-001', condition: 'new' },
      { name: 'ماوس لاسلكي Logitech', brand: 'Logitech', model: 'MX Master 3', category_id: categoryIds[5], quantity: 20, available_quantity: 18, serial_number: 'LOG-001', condition: 'new' },
      { name: 'كيبورد Logitech', brand: 'Logitech', model: 'K380', category_id: categoryIds[5], quantity: 20, available_quantity: 17, serial_number: 'LOG-002', condition: 'new' },
    ];

    const itemIds = [];
    for (const item of inventoryItems) {
      const result = await client.query(`
        INSERT INTO inventory_items (name, brand, model, category_id, quantity, available_quantity, serial_number, condition)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (serial_number) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `, [item.name, item.brand, item.model, item.category_id, item.quantity, item.available_quantity, item.serial_number, item.condition]);
      itemIds.push(result.rows[0].id);
    }

    console.log('  ✅ Inventory items seeded');

    // ----------------------------------------
    // 7. SIM Cards
    // ----------------------------------------
    console.log('📱 Seeding SIM cards...');

    const simCards = [
      { sim_number: '01000000001', operator: 'Vodafone', status: 'available', plan: 'بيانات 20GB' },
      { sim_number: '01100000001', operator: 'Orange', status: 'available', plan: 'بيانات 15GB' },
      { sim_number: '01200000001', operator: 'Etisalat', status: 'assigned', plan: 'بيانات 10GB' },
      { sim_number: '01500000001', operator: 'WE', status: 'available', plan: 'بيانات 25GB' },
      { sim_number: '01000000002', operator: 'Vodafone', status: 'available', plan: 'مكالمات + بيانات' },
    ];

    for (const sim of simCards) {
      await client.query(`
        INSERT INTO sim_cards (sim_number, operator, status, plan)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (sim_number) DO UPDATE SET operator = EXCLUDED.operator
      `, [sim.sim_number, sim.operator, sim.status, sim.plan]);
    }

    console.log('  ✅ SIM cards seeded');

    // ----------------------------------------
    // 8. Notifications
    // ----------------------------------------
    console.log('🔔 Seeding notifications...');

    await client.query(`
      INSERT INTO notifications (title, message, user_id, type, is_read)
      VALUES 
        ('مرحباً بك', 'مرحباً بك في نظام إدارة المخزون', $1, 'info', false),
        ('تم إنشاء الحساب', 'تم إنشاء حسابك بنجاح', $1, 'success', false)
    `, [adminId]);

    console.log('  ✅ Notifications seeded');

    await client.query('COMMIT');

    console.log('\n🎉 Database seeding completed successfully!\n');
    console.log('👤 Test Accounts:');
    console.log('  Admin:   admin@inventory.com   / Admin@123456');
    console.log('  Manager: manager@inventory.com / Manager@123456');
    console.log('  User:    user@inventory.com    / User@123456');
    console.log('');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Seeding failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

// ========================================
// Run
// ========================================
seedData().catch(err => {
  console.error(err);
  process.exit(1);
});
