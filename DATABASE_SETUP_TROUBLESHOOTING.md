# 🛠️ Database Connection Troubleshooting

## ❌ Error: ECONNREFUSED

This error means Node.js cannot connect to PostgreSQL. Here's how to fix it:

---

## ✅ Solution Steps

### Step 1: Check if PostgreSQL is Running

#### On Windows:

1. **Check Services:**
   - Press `Win + R`
   - Type `services.msc`
   - Look for "postgresql" or "PostgreSQL" service
   - If it's not running, right-click → Start

2. **Or use Command Prompt:**
   ```cmd
   net start | findstr postgresql
   ```
   
   If not running, start it:
   ```cmd
   net start postgresql-x64-15
   ```
   (Replace `15` with your PostgreSQL version)

#### On Linux/Mac:

```bash
# Check status
sudo systemctl status postgresql

# Start service
sudo systemctl start postgresql

# Enable on boot
sudo systemctl enable postgresql
```

---

### Step 2: Verify PostgreSQL Installation

Check if PostgreSQL is installed:

```bash
psql --version
```

If not installed:
- **Windows:** Download from https://www.postgresql.org/download/windows/
- **Mac:** `brew install postgresql@15`
- **Linux:** `sudo apt-get install postgresql postgresql-contrib`

---

### Step 3: Check Database Credentials

Open your `.env` file and verify:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=postgres          # Use 'postgres' for default database
DB_USER=postgres          # Default PostgreSQL user
DB_PASSWORD=your_password # Your actual password
```

**Common Issues:**
- ❌ Wrong password
- ❌ Database doesn't exist
- ❌ Wrong port (default is 5432)

---

### Step 4: Create the Database

Once PostgreSQL is running, create the database:

#### Using pgAdmin:
1. Open pgAdmin
2. Right-click "Databases"
3. Click "Create" → "Database"
4. Name: `inventory_db`
5. Click "Save"

#### Using psql command line:

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE inventory_db;

# Exit
\q
```

Then update `.env`:
```env
DB_NAME=inventory_db
```

---

### Step 5: Check Firewall

Make sure port 5432 is not blocked:

#### Windows Firewall:
1. Control Panel → Windows Defender Firewall
2. Advanced Settings → Inbound Rules
3. New Rule → Port → TCP → 5432
4. Allow the connection

---

### Step 6: Test Connection

Create a test file `test-db.js`:

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Connection failed:', err.message);
  } else {
    console.log('✅ Connection successful!', res.rows[0]);
  }
  pool.end();
});
```

Run it:
```bash
node test-db.js
```

---

## 🐳 Alternative: Use Docker

If you don't want to install PostgreSQL locally, use Docker:

### docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    container_name: inventory_postgres
    environment:
      POSTGRES_DB: inventory_db
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

Then run:
```bash
docker-compose up -d
```

Wait 10 seconds for PostgreSQL to start, then:
```bash
npm run setup-db
npm run migrate
```

---

## 🔑 Reset PostgreSQL Password (If Needed)

### Windows:

1. Navigate to PostgreSQL data directory
2. Edit `pg_hba.conf`:
   ```conf
   # Change this line:
   host all all 127.0.0.1/32 scram-sha-256
   # To:
   host all all 127.0.0.1/32 trust
   ```
3. Restart PostgreSQL service
4. Connect without password: `psql -U postgres`
5. Change password:
   ```sql
   ALTER USER postgres WITH PASSWORD 'new_password';
   ```
6. Revert `pg_hba.conf` changes
7. Restart PostgreSQL again

---

## 📋 Quick Checklist

- [ ] PostgreSQL service is running
- [ ] Port 5432 is accessible
- [ ] Database exists (`inventory_db` or `postgres`)
- [ ] `.env` credentials are correct
- [ ] Firewall allows connections
- [ ] No typos in username/password

---

## 🆘 Still Having Issues?

### Check PostgreSQL Logs:

**Windows:** 
`C:\Program Files\PostgreSQL\15\data\log`

**Linux:** 
`/var/log/postgresql/`

### Common Error Messages:

| Error | Meaning | Solution |
|-------|---------|----------|
| `ECONNREFUSED` | PostgreSQL not running | Start the service |
| `password authentication failed` | Wrong password | Reset password or check `.env` |
| `database does not exist` | DB not created | Create the database |
| `no pg_hba.conf entry` | Access denied | Check `pg_hba.conf` settings |

---

## ✅ Success Indicators

When everything works, you should see:

```
🔧 Setting up database...

📡 Testing database connection...
✅ Database connected successfully: 2026-04-03 10:30:00+00

📄 Reading schema file...
✅ Schema file loaded

🚀 Executing schema...
✅ Schema created successfully

📊 Verifying tables...
✅ Tables created:
   - assignments
   - audit_logs
   - branches
   - categories
   - employees
   - inventory_items
   ...

✨ Database setup completed successfully!
```

---

## 🎯 After Database is Set Up

Once the database is working:

1. Run setup:
   ```bash
   npm run setup-db
   ```

2. Run migrations:
   ```bash
   npm run migrate
   ```

3. Start server:
   ```bash
   npm run dev
   ```

4. Verify at:
   - http://localhost:5000/health
   - http://localhost:5000/api-docs

---

**Good luck!** 🚀
