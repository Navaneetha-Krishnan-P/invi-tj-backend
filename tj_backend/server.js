const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const crypto = require("node:crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

// Import routes
const dashboardRoutes = require("./routes/dashboard");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(bodyParser.json());

// Routes
app.use("/api/dashboard", dashboardRoutes);

// PostgreSQL connection pool
const db = new Pool({
  host: process.env.DB_HOST || "62.84.183.182",
  port: parseInt(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || "admin",
  password: process.env.DB_PASSWORD || "Wing$@2025",
  database: process.env.DB_NAME || "core_db",
  connectionTimeoutMillis: 60000,
  idleTimeoutMillis: 30000,
  max: 20,
});

// Set search_path to tj schema for all connections
db.on("connect", (client) => {
  client.query("SET search_path TO tj, public", (err) => {
    if (err) {
      console.error("Error setting search_path:", err);
    }
  });
});

// JWT Secret
const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";

// Email transporter configuration
const emailTransporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Test database connection
db.connect()
  .then((client) => {
    console.log(
      "✅ PostgreSQL Connected to remote server (194.163.152.233:3010)"
    );
    console.log("📊 Database: core_db");
    client.release();
  })
  .catch((err) => {
    console.error("❌ Database connection error:", err);
    console.error(
      "Make sure the database server is accessible and credentials are correct"
    );
  });

// Helper function to send email
async function sendEmail(to, subject, html) {
  try {
    if (!process.env.EMAIL_USER) {
      console.log("Email not configured. OTP would be:", html);
      return { success: true, message: "Email service not configured" };
    }

    await emailTransporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      html,
    });
    return { success: true };
  } catch (error) {
    console.error("Email error:", error);
    return { success: false, error: error.message };
  }
}

// ==================== AUTHENTICATION ROUTES ====================

// Check if user_id is available
app.get("/api/users/check/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    // Validate user_id format
    const userIdRegex = /^[a-zA-Z0-9._]{3,30}$/;
    if (!userIdRegex.test(user_id)) {
      console.log(`❌ Invalid user_id format attempted: ${user_id}`);
      return res.status(400).json({
        available: false,
        error:
          "User ID must be 3-30 characters and contain only letters, numbers, dots, or underscores",
      });
    }

    const result = await db.query(
      "SELECT user_id FROM tj.users WHERE user_id = $1",
      [user_id]
    );

    res.json({
      available: result.rows.length === 0,
      user_id: user_id,
    });
  } catch (error) {
    console.error("Check user_id error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// 1. Sign Up (Register)
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { user_id, name, email, phone, password } = req.body;

    // Validation
    if (!user_id || !name || !email || !phone || !password) {
      console.log(`❌ Signup attempt with missing fields - email: ${email}`);
      return res.status(400).json({ error: "All fields are required" });
    }

    // Validate user_id format (alphanumeric, underscore, dot - like Instagram)
    const userIdRegex = /^[a-zA-Z0-9._]{3,30}$/;
    if (!userIdRegex.test(user_id)) {
      console.log(`❌ Invalid user_id format in signup: ${user_id}`);
      return res.status(400).json({
        error:
          "User ID must be 3-30 characters and contain only letters, numbers, dots, or underscores",
      });
    }

    // Check if user_id already exists
    const existingUserId = await db.query(
      "SELECT * FROM tj.users WHERE user_id = $1",
      [user_id]
    );

    if (existingUserId.rows.length > 0) {
      console.log(`❌ Duplicate user_id attempt: ${user_id}`);
      return res
        .status(400)
        .json({ error: "User ID already taken. Please choose another one." });
    }

    // Check if email or phone already exists
    const existingUser = await db.query(
      "SELECT * FROM tj.users WHERE email = $1 OR phone = $2",
      [email, phone]
    );

    if (existingUser.rows.length > 0) {
      console.log(
        `❌ Duplicate email/phone in signup - email: ${email}, phone: ${phone}`
      );
      return res
        .status(400)
        .json({ error: "Email or phone already registered" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user (auto-verified, no OTP needed, but inactive by default)
    const result = await db.query(
      `INSERT INTO tj.users (user_id, name, email, phone, password, role_type, is_active, is_verified) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING user_id, name, email, phone, role_type, is_active, is_verified`,
      [user_id, name, email, phone, hashedPassword, "TRADER", false, true]
    );

    const user = result.rows[0];

    // Send welcome email
    const emailHtml = `
      <h2>Welcome to Our Trading Platform!</h2>
      <p>Hi ${name},</p>
      <p>Your account has been created successfully!</p>
      <p>You can now login and start tracking your trades.</p>
      <div style="margin: 2rem 0;">
        <a href="${
          process.env.FRONTEND_URL || "http://localhost:5173"
        }/login" style="background: #00d4aa; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600;">
          Login Now
        </a>
      </div>
      <p>Happy Trading!</p>
    `;

    await sendEmail(email, "Welcome to Trading Platform", emailHtml);

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.user_id, email: user.email },
      JWT_SECRET,
      {
        expiresIn: "2h",
      }
    );

    res.status(201).json({
      success: true,
      message: "Account created successfully!",
      token,
      user: {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role_type: user.role_type,
        is_active: user.is_active,
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: "Server error during signup" });
  }
});

// 4. Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      console.log(`❌ Login attempt with missing credentials`);
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Find user
    const result = await db.query("SELECT * FROM tj.users WHERE email = $1", [
      email,
    ]);

    if (result.rows.length === 0) {
      console.log(`❌ Login attempt with non-existent email: ${email}`);
      return res
        .status(404)
        .json({ error: "Email not found. Please sign up first." });
    }

    const user = result.rows[0];

    // Check if account is active
    if (!user.is_active) {
      console.log(
        `❌ Login attempt on inactive account - user_id: ${user.user_id}, email: ${email}`
      );
      return res.status(403).json({
        error: "Your account is inactive. Please contact the administrator.",
      });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      console.log(
        `❌ Invalid password attempt - user_id: ${user.user_id}, email: ${email}`
      );
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Generate JWT token (2 hours expiration)
    const token = jwt.sign(
      { userId: user.user_id, email: user.email },
      JWT_SECRET,
      {
        expiresIn: "2h",
      }
    );

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role_type: user.role_type,
        is_active: user.is_active,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Server error during login" });
  }
});

// Fix sequence helper endpoint (temporary - for debugging)
app.get("/api/fix-sequence", async (req, res) => {
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
      sequenceFix = "Sequence fixed successfully";
    } catch (seqError) {
      sequenceFix = `Sequence error: ${seqError.message}`;
    }

    res.json({
      success: true,
      message: "Debug info retrieved",
      tableStructure: tableInfo.rows,
      sequenceFix,
    });
  } catch (error) {
    console.error("Fix sequence error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 7. Get User Profile (Protected Route)
app.get("/api/auth/profile", authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      "SELECT user_id, name, email, phone, role_type, is_active, is_verified, created_at FROM tj.users WHERE user_id = $1",
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      console.log(
        `❌ Profile fetch failed - user not found: ${req.user.userId}`
      );
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    console.log(`❌ Unauthorized access attempt - no token provided`);
    return res.status(401).json({ error: "Access token required" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log(`❌ Invalid/expired token attempt - error: ${err.message}`);
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
}

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running" });
});

// 2. Save trades to database
app.post("/api/trades/save", authenticateToken, async (req, res) => {
  try {
    const { trades } = req.body;

    if (!trades || !Array.isArray(trades) || trades.length === 0) {
      console.log(`❌ No trades data provided by user: ${req.user.userId}`);
      return res.status(400).json({ error: "No trades data provided" });
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
          trade.trade_type || "BUY",
          trade.lot_size || 1,
          trade.entry_price || 0,
          trade.exit_price || null,
          trade.profit_loss || 0,
          trade.market_type || "FOREX",
        ]
      );

      savedTrades.push(result.rows[0]);
    }

    res.json({
      success: true,
      savedCount: savedTrades.length,
      message: `Successfully saved ${savedTrades.length} trade(s)`,
      trades: savedTrades,
    });
  } catch (error) {
    console.error("Save trades error:", error);
    res.status(500).json({
      error: "Failed to save trades",
      details: error.message,
    });
  }
});

// 3. Get user's trades
app.get("/api/trades", authenticateToken, async (req, res) => {
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
      count: result.rows.length,
    });
  } catch (error) {
    console.error("Get trades error:", error);
    res.status(500).json({
      error: "Failed to fetch trades",
      details: error.message,
    });
  }
});

// 4. Delete a trade
app.delete("/api/trades/:id", authenticateToken, async (req, res) => {
  try {
    const tradeId = req.params.id;
    const userId = req.user.userId;

    const result = await db.query(
      "DELETE FROM tj.trade_orders WHERE id = $1 AND user_id = $2 RETURNING *",
      [tradeId, userId]
    );

    if (result.rows.length === 0) {
      console.log(
        `❌ Trade deletion failed - trade_id: ${tradeId}, user_id: ${userId}`
      );
      return res.status(404).json({ error: "Trade not found" });
    }

    res.json({
      success: true,
      message: "Trade deleted successfully",
      trade: result.rows[0],
    });
  } catch (error) {
    console.error("Delete trade error:", error);
    res.status(500).json({
      error: "Failed to delete trade",
      details: error.message,
    });
  }
});

// 5. Get all users (for autocomplete/admin)
app.get("/api/users/list", authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT user_id, name, email, phone, role_type, is_active, created_at 
       FROM tj.users 
       ORDER BY name ASC`
    );

    res.json({
      success: true,
      users: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({
      error: "Failed to fetch users",
      details: error.message,
    });
  }
});

// 6. Get all trades with user details (for admin analysis)
app.get("/api/trades/all", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.query;

    let query = `
      SELECT 
        t.*,
        u.name as user_name,
        u.email as user_email,
        u.phone as user_phone
      FROM tj.trade_orders t
      INNER JOIN tj.users u ON t.user_id = u.user_id
    `;
    const params = [];
    if (userId) {
      // Support multiple user IDs (comma-separated)
      const ids = userId
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
      query += ` WHERE t.user_id IN (${placeholders})`;
      params.push(...ids);
    }
    query += " ORDER BY t.trade_date DESC, t.created_at DESC";

    const result = await db.query(query, params);

    res.json({
      success: true,
      trades: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error("Get all trades error:", error);
    res.status(500).json({
      error: "Failed to fetch trades",
      details: error.message,
    });
  }
});

// ==================== USER MANAGEMENT ROUTES ====================

// 7. Get specific user by ID
app.get("/api/users/:id", authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;

    const result = await db.query(
      `SELECT user_id, name, email, phone, role_type, is_active, is_verified, created_at, updated_at 
       FROM tj.users 
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      console.log(`❌ Get user failed - user not found: ${userId}`);
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      success: true,
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({
      error: "Failed to fetch user",
      details: error.message,
    });
  }
});

// 8. Update user profile (admin)
app.put("/api/users/:id", authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, email, phone, role_type, is_active, is_verified } = req.body;

    // Check if user exists
    const checkUser = await db.query(
      "SELECT * FROM tj.users WHERE user_id = $1",
      [userId]
    );
    if (checkUser.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if email/phone already exists for other users
    if (email || phone) {
      const duplicateCheck = await db.query(
        "SELECT * FROM tj.users WHERE (email = $1 OR phone = $2) AND user_id != $3",
        [
          email || checkUser.rows[0].email,
          phone || checkUser.rows[0].phone,
          userId,
        ]
      );
      if (duplicateCheck.rows.length > 0) {
        console.log(
          `❌ Duplicate email/phone in update - user_id: ${userId}, email: ${email}, phone: ${phone}`
        );
        return res
          .status(400)
          .json({ error: "Email or phone already exists for another user" });
      }
    }

    // Update user
    const result = await db.query(
      `UPDATE tj.users 
       SET name = $1, email = $2, phone = $3, role_type = $4, is_active = $5, is_verified = $6, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $7
       RETURNING user_id, name, email, phone, role_type, is_active, is_verified, created_at, updated_at`,
      [
        name || checkUser.rows[0].name,
        email || checkUser.rows[0].email,
        phone || checkUser.rows[0].phone,
        role_type !== undefined ? role_type : checkUser.rows[0].role_type,
        is_active !== undefined ? is_active : checkUser.rows[0].is_active,
        is_verified !== undefined ? is_verified : checkUser.rows[0].is_verified,
        userId,
      ]
    );

    res.json({
      success: true,
      message: "User updated successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({
      error: "Failed to update user",
      details: error.message,
    });
  }
});

// 9. Update user password (admin)
app.put("/api/users/:id/password", authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      console.log(`❌ Weak password attempt for user: ${userId}`);
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }

    // Check if user exists
    const checkUser = await db.query(
      "SELECT * FROM tj.users WHERE user_id = $1",
      [userId]
    );
    if (checkUser.rows.length === 0) {
      console.log(`❌ Password update attempt on non-existent user: ${userId}`);
      return res.status(404).json({ error: "User not found" });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await db.query(
      "UPDATE tj.users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2",
      [hashedPassword, userId]
    );

    res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Update password error:", error);
    res.status(500).json({
      error: "Failed to update password",
      details: error.message,
    });
  }
});

// 10. Delete user (admin)
app.delete("/api/users/:id", authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;

    // Check if user exists
    const checkUser = await db.query(
      "SELECT * FROM tj.users WHERE user_id = $1",
      [userId]
    );
    if (checkUser.rows.length === 0) {
      console.log(`❌ Delete attempt on non-existent user: ${userId}`);
      return res.status(404).json({ error: "User not found" });
    }

    // Prevent deleting yourself (optional safety check)
    if (req.user.userId === userId) {
      console.log(`❌ Self-deletion attempt blocked - user_id: ${userId}`);
      return res
        .status(400)
        .json({ error: "You cannot delete your own account" });
    }

    // Delete user
    await db.query("DELETE FROM tj.users WHERE user_id = $1", [userId]);

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({
      error: "Failed to delete user",
      details: error.message,
    });
  }
});

// ==================== MAINTENANCE ROUTES ====================

// 1. Get all maintenance records (public - no auth required)
app.get("/api/maintenance", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM tj.maintenance 
       ORDER BY maintenance_date DESC, from_time DESC`
    );

    res.json({
      success: true,
      maintenance: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error("Get maintenance error:", error);
    res.status(500).json({
      error: "Failed to fetch maintenance records",
      details: error.message,
    });
  }
});

// 2. Get upcoming maintenance (next 2 days)
app.get("/api/maintenance/upcoming", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM tj.maintenance 
       WHERE maintenance_date >= CURRENT_DATE 
       AND maintenance_date <= CURRENT_DATE + INTERVAL '1 day'
       ORDER BY maintenance_date ASC, from_time ASC`
    );

    res.json({
      success: true,
      maintenance: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error("Get upcoming maintenance error:", error);
    res.status(500).json({
      error: "Failed to fetch upcoming maintenance",
      details: error.message,
    });
  }
});

// 3. Create maintenance record
app.post("/api/maintenance", async (req, res) => {
  try {
    const {
      maintenance_date,
      from_time,
      to_time,
      frontend_version,
      backend_version,
      description,
    } = req.body;

    if (!maintenance_date || !from_time || !to_time) {
      console.log(
        `❌ Maintenance creation with missing fields - date: ${maintenance_date}`
      );
      return res
        .status(400)
        .json({ error: "Date and time fields are required" });
    }

    const result = await db.query(
      `INSERT INTO tj.maintenance 
       (maintenance_date, from_time, to_time, frontend_version, backend_version, description) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [
        maintenance_date,
        from_time,
        to_time,
        frontend_version,
        backend_version,
        description,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Maintenance record created successfully",
      maintenance: result.rows[0],
    });
  } catch (error) {
    console.error("Create maintenance error:", error);
    res.status(500).json({
      error: "Failed to create maintenance record",
      details: error.message,
    });
  }
});

// 4. Update maintenance record
app.put("/api/maintenance/:id", async (req, res) => {
  try {
    const maintenanceId = req.params.id;
    const {
      maintenance_date,
      from_time,
      to_time,
      frontend_version,
      backend_version,
      description,
    } = req.body;

    const result = await db.query(
      `UPDATE tj.maintenance 
       SET maintenance_date = $1, from_time = $2, to_time = $3, 
           frontend_version = $4, backend_version = $5, description = $6, 
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING *`,
      [
        maintenance_date,
        from_time,
        to_time,
        frontend_version,
        backend_version,
        description,
        maintenanceId,
      ]
    );

    if (result.rows.length === 0) {
      console.log(
        `❌ Maintenance update failed - id not found: ${maintenanceId}`
      );
      return res.status(404).json({ error: "Maintenance record not found" });
    }

    res.json({
      success: true,
      message: "Maintenance record updated successfully",
      maintenance: result.rows[0],
    });
  } catch (error) {
    console.error("Update maintenance error:", error);
    res.status(500).json({
      error: "Failed to update maintenance record",
      details: error.message,
    });
  }
});

// 5. Delete maintenance record
app.delete("/api/maintenance/:id", async (req, res) => {
  try {
    const maintenanceId = req.params.id;

    const result = await db.query(
      "DELETE FROM tj.maintenance WHERE id = $1 RETURNING *",
      [maintenanceId]
    );

    if (result.rows.length === 0) {
      console.log(
        `❌ Maintenance deletion failed - id not found: ${maintenanceId}`
      );
      return res.status(404).json({ error: "Maintenance record not found" });
    }

    res.json({
      success: true,
      message: "Maintenance record deleted successfully",
      maintenance: result.rows[0],
    });
  } catch (error) {
    console.error("Delete maintenance error:", error);
    res.status(500).json({
      error: "Failed to delete maintenance record",
      details: error.message,
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
