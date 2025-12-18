const express = require('express')
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
// const multer = require('multer');
// const { createWorker } = require('tesseract.js');
// const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Import routes
const dashboardRoutes = require('./routes/dashboard');
 
const app = express();
const port = process.env.PORT || 5000;

// Create uploads directory if it doesn't exist
// const uploadsDir = path.join(__dirname, 'uploads');
// if (!fs.existsSync(uploadsDir)) {
//   fs.mkdirSync(uploadsDir, { recursive: true });
// }

// Configure multer for file uploads (COMMENTED OUT)
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     cb(null, uploadsDir);
//   },
//   filename: (req, file, cb) => {
//     const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
//     cb(null, 'trade-' + uniqueSuffix + path.extname(file.originalname));
//   }
// });

// const upload = multer({
//   storage: storage,
//   limits: {
//     fileSize: 5 * 1024 * 1024 // 5MB limit
//   },
//   fileFilter: (req, file, cb) => {
//     const allowedTypes = /jpeg|jpg|png|gif|bmp/;
//     const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
//     const mimetype = allowedTypes.test(file.mimetype);
//     
//     if (mimetype && extname) {
//       return cb(null, true);
//     } else {
//       cb(new Error('Only image files are allowed!'));
//     }
//   }
// });
 
app.use(cors());
app.use(bodyParser.json());

// Routes
app.use('/api/dashboard', dashboardRoutes);
 
// PostgreSQL connection pool (Remote Server)
const db = new Pool({
  host: process.env.DB_HOST || '62.84.183.182',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'Wing$@2025',
  database: process.env.DB_NAME || 'core_db',
  // Remove SSL for local/direct connection
  // ssl: {
  //   rejectUnauthorized: false
  // },
  connectionTimeoutMillis: 60000,
  idleTimeoutMillis: 30000,
  max: 20
});

// Set search_path to tj schema for all connections
db.on('connect', (client) => {
  client.query('SET search_path TO tj, public', (err) => {
    if (err) {
      console.error('Error setting search_path:', err);
    }
  });
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Email transporter configuration
const emailTransporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Test database connection
db.connect()
  .then(client => {
    console.log('✅ PostgreSQL Connected to remote server (62.84.183.182:5432)');
    console.log('📊 Database: core_db');
    client.release();
    initializeDatabase();
  })
  .catch(err => {
    console.error('❌ Database connection error:', err);
    console.error('Make sure the database server is accessible and credentials are correct');
  });

// Initialize database table
async function initializeDatabase() {
  try {
    // Users table (tj.users schema)
    await db.query(`
      CREATE TABLE IF NOT EXISTS tj.users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(20) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role_type VARCHAR(20) NOT NULL DEFAULT 'TRADER',
        is_active BOOLEAN DEFAULT FALSE,
        is_verified BOOLEAN DEFAULT TRUE,
        reset_token VARCHAR(255),
        reset_token_expiry TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Users table ready');
    
    // Add is_active column if it doesn't exist (for existing tables)
    try {
      await db.query(`
        ALTER TABLE tj.users 
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT FALSE
      `);
    } catch (err) {
      // Column might already exist, ignore error
    }
    
    // Update the default value for existing is_active column
    try {
      await db.query(`
        ALTER TABLE tj.users ALTER COLUMN is_active SET DEFAULT FALSE
      `);
    } catch (err) {
      // Ignore if already set
    }
    
    // Add role_type column if it doesn't exist (for existing tables)
    try {
      await db.query(`
        ALTER TABLE tj.users 
        ADD COLUMN IF NOT EXISTS role_type VARCHAR(20) DEFAULT 'TRADER'
      `);
      // Set existing users to TRADER
      await db.query(`
        UPDATE tj.users SET role_type = 'TRADER' WHERE role_type IS NULL
      `);
    } catch (err) {
      // Column might already exist, ignore error
    }

    // Trade Orders table (tj.trade_orders schema)
    await db.query(`
      CREATE TABLE IF NOT EXISTS tj.trade_orders (
        id BIGSERIAL,
        user_id BIGINT NOT NULL,
        trade_date TIMESTAMP NOT NULL,
        symbol VARCHAR(50) NOT NULL,
        trade_type VARCHAR(4) NOT NULL,
        lot_size NUMERIC(10, 2) NOT NULL,
        entry_price NUMERIC(12, 4) NOT NULL,
        exit_price NUMERIC(12, 4),
        profit_loss NUMERIC(14, 4),
        market_type VARCHAR(20) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id, trade_date)
      )
    `);
    
    console.log('Trade Orders table ready');
    
    // Fix sequences if they exist
    try {
      await db.query(`
        SELECT setval('tj.users_id_seq', COALESCE((SELECT MAX(id) FROM tj.users), 0) + 1, false);
      `);
      console.log('Users sequence fixed');
    } catch (err) {
      // Sequence might not exist yet, ignore
    }
    
  } catch (err) {
    console.error('Error initializing database:', err);
  }
}

// Helper function to send email
async function sendEmail(to, subject, html) {
  try {
    if (!process.env.EMAIL_USER) {
      console.log('Email not configured. OTP would be:', html);
      return { success: true, message: 'Email service not configured' };
    }
    
    await emailTransporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      html
    });
    return { success: true };
  } catch (error) {
    console.error('Email error:', error);
    return { success: false, error: error.message };
  }
}

// ==================== AUTHENTICATION ROUTES ====================

// 1. Sign Up (Register)
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    // Validation
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if user already exists
    const existingUser = await db.query(
      'SELECT * FROM tj.users WHERE email = $1 OR phone = $2',
      [email, phone]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email or phone already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user (auto-verified, no OTP needed, but inactive by default)
    const result = await db.query(
      `INSERT INTO tj.users (name, email, phone, password, role_type, is_active, is_verified) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, name, email, phone, role_type, is_active, is_verified`,
      [name, email, phone, hashedPassword, 'TRADER', false, true]
    );

    const user = result.rows[0];

    // Send welcome email
    const emailHtml = `
      <h2>Welcome to Our Trading Platform!</h2>
      <p>Hi ${name},</p>
      <p>Your account has been created successfully!</p>
      <p>You can now login and start tracking your trades.</p>
      <div style="margin: 2rem 0;">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" style="background: #00d4aa; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600;">
          Login Now
        </a>
      </div>
      <p>Happy Trading!</p>
    `;

    await sendEmail(email, 'Welcome to Trading Platform', emailHtml);

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role_type: user.role_type,
        is_active: user.is_active
      }
    });

  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Server error during signup' });
  }
});

// 4. Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const result = await db.query(
      'SELECT * FROM tj.users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Email not found. Please sign up first.' });
    }

    const user = result.rows[0];

    // Check if account is active
    if (!user.is_active) {
      return res.status(403).json({ 
        error: 'Your account is inactive. Please contact the administrator.',
      });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT token (2 hours expiration)
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role_type: user.role_type,
        is_active: user.is_active
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// 5. Forgot Password (Send Reset Link/OTP)
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const result = await db.query(
      'SELECT * FROM tj.users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 60 minutes

    await db.query(
      'UPDATE tj.users SET reset_token = $1, reset_token_expiry = $2 WHERE email = $3',
      [resetToken, tokenExpiry, email]
    );

    // Create reset link
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;

    // Send reset email with link
    const emailHtml = `
      <h2>Password Reset Request</h2>
      <p>Hi ${user.name},</p>
      <p>You requested to reset your password. Click the link below to reset your password:</p>
      <div style="margin: 2rem 0;">
        <a href="${resetLink}" style="background: #00d4aa; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600;">
          Reset Password
        </a>
      </div>
      <p>Or copy and paste this link in your browser:</p>
      <p style="color: #666; word-break: break-all;">${resetLink}</p>
      <p>This link will expire in 60 minutes.</p>
      <p>If you didn't request this, please ignore this email.</p>
    `;

    await sendEmail(email, 'Password Reset Request', emailHtml);

    res.json({
      success: true,
      message: 'Password reset link sent to your email'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server error during password reset request' });
  }
});

// 6. Reset Password (via token from email link)
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    const result = await db.query(
      'SELECT * FROM tj.users WHERE reset_token = $1',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid reset token' });
    }

    const user = result.rows[0];

    // Check token expiry
    if (new Date() > new Date(user.reset_token_expiry)) {
      return res.status(400).json({ error: 'Reset link expired. Please request a new one.' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear reset token
    await db.query(
      `UPDATE tj.users 
       SET password = $1, reset_token = NULL, reset_token_expiry = NULL 
       WHERE id = $2`,
      [hashedPassword, user.id]
    );

    res.json({
      success: true,
      message: 'Password reset successfully. Please login with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error during password reset' });
  }
});

// Fix sequence helper endpoint (temporary - for debugging)
app.get('/api/fix-sequence', async (req, res) => {
  try {
    // Check table structure first
    const tableInfo = await db.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_schema = 'tj' AND table_name = 'users' 
      ORDER BY ordinal_position;
    `);
    
    // Try to fix the users id sequence
    let sequenceFix = null;
    try {
      await db.query(`
        SELECT setval('tj.users_id_seq', COALESCE((SELECT MAX(id) FROM tj.users), 0) + 1, false);
      `);
      sequenceFix = 'Sequence fixed successfully';
    } catch (seqError) {
      sequenceFix = `Sequence error: ${seqError.message}`;
    }
    
    res.json({ 
      success: true, 
      message: 'Debug info retrieved',
      tableStructure: tableInfo.rows,
      sequenceFix
    });
  } catch (error) {
    console.error('Fix sequence error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. Get User Profile (Protected Route)
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, email, phone, role_type, is_active, is_verified, created_at FROM tj.users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, user: result.rows[0] });

  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// 2. Save trades to database
app.post('/api/trades/save', authenticateToken, async (req, res) => {
  try {
    const { trades } = req.body;

    if (!trades || !Array.isArray(trades) || trades.length === 0) {
      return res.status(400).json({ error: 'No trades data provided' });
    }

    const userId = req.user.userId;
    const savedTrades = [];

    // Save each trade
    for (const trade of trades) {
      const result = await db.query(
        `INSERT INTO tj.trade_orders 
         (user_id, trade_date, symbol, trade_type, lot_size, entry_price, exit_price, profit_loss, market_type) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
         RETURNING *`,
        [
          userId,
          trade.trade_date || new Date().toISOString(),
          trade.symbol,
          trade.trade_type || 'BUY',
          trade.lot_size || 1,
          trade.entry_price || 0,
          trade.exit_price || null,
          trade.profit_loss || 0,
          trade.market_type || 'FOREX'
        ]
      );

      savedTrades.push(result.rows[0]);
    }

    res.json({
      success: true,
      savedCount: savedTrades.length,
      message: `Successfully saved ${savedTrades.length} trade(s)`,
      trades: savedTrades
    });

  } catch (error) {
    console.error('Save trades error:', error);
    res.status(500).json({ 
      error: 'Failed to save trades',
      details: error.message 
    });
  }
});

// 3. Get user's trades
app.get('/api/trades', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await db.query(
      `SELECT * FROM tj.trade_orders 
       WHERE user_id = $1 
       ORDER BY trade_date DESC, created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      trades: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error('Get trades error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch trades',
      details: error.message 
    });
  }
});

// 4. Delete a trade
app.delete('/api/trades/:id', authenticateToken, async (req, res) => {
  try {
    const tradeId = req.params.id;
    const userId = req.user.userId;

    const result = await db.query(
      'DELETE FROM tj.trade_orders WHERE id = $1 AND user_id = $2 RETURNING *',
      [tradeId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Trade not found' });
    }

    res.json({
      success: true,
      message: 'Trade deleted successfully',
      trade: result.rows[0]
    });

  } catch (error) {
    console.error('Delete trade error:', error);
    res.status(500).json({ 
      error: 'Failed to delete trade',
      details: error.message 
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
