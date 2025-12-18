const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // Use tj schema instead of public
  options: '-c search_path=tj'
});

async function setupDatabase() {
  try {
    console.log('Connecting to database...');
    
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(20) NOT NULL,
        password VARCHAR(255) NOT NULL,
        otp VARCHAR(6),
        otp_expiry TIMESTAMP,
        is_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Users table created');

    // Create index on email
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
    `);
    console.log('✓ Email index created');

    // Create user_roles table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      )
    `);
    console.log('✓ User roles table created');

    // Create trades table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(10) CHECK (type IN ('buy', 'sell')),
        symbol VARCHAR(20) NOT NULL,
        quantity DECIMAL(18, 8) NOT NULL,
        entry_price DECIMAL(18, 8) NOT NULL,
        current_price DECIMAL(18, 8),
        profit_loss DECIMAL(18, 8),
        date DATE DEFAULT CURRENT_DATE,
        status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Trades table created');

    // Create index on user_id
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id)
    `);
    console.log('✓ Trades index created');

    // Insert default admin user (password: admin123)
    const adminPassword = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9'; // SHA-256 of 'admin123'
    await pool.query(`
      INSERT INTO users (name, email, phone, password, is_verified)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `, ['Admin User', 'admin@trading.com', '1234567890', adminPassword, true]);
    console.log('✓ Default admin user created (email: admin@trading.com, password: admin123)');

    // Assign admin role
    await pool.query(`
      INSERT INTO user_roles (user_id, role)
      SELECT id, 'admin' FROM users WHERE email = 'admin@trading.com'
      ON CONFLICT (user_id) DO NOTHING
    `);
    console.log('✓ Admin role assigned');

    console.log('\n✅ Database setup completed successfully!');
    console.log('\n📝 Default admin credentials:');
    console.log('   Email: admin@trading.com');
    console.log('   Password: admin123');
    
  } catch (error) {
    console.error('❌ Error setting up database:', error);
  } finally {
    await pool.end();
  }
}

setupDatabase();
