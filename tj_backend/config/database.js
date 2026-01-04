const { Pool } = require("pg");
require("dotenv").config();

// PostgreSQL connection pool (Remote Server)
const db = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // No SSL for direct PostgreSQL connection
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

// Handle pool errors
db.on("error", (err) => {
  console.error("Unexpected database pool error:", err);
});

// Graceful shutdown - close all connections on exit
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, closing database connections...");
  await db.end();
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, closing database connections...");
  await db.end();
  process.exit(0);
});

module.exports = db;
