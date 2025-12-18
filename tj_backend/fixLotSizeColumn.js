const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function fixLotSizeColumn() {
  try {
    console.log('🔧 Fixing lot_size column to support decimal values...');
    console.log(`Connecting to ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}...`);
    
    // Alter the column type from INTEGER to NUMERIC
    await pool.query(`
      ALTER TABLE tj.trade_orders 
      ALTER COLUMN lot_size TYPE NUMERIC(10, 2)
      USING lot_size::NUMERIC(10, 2)
    `);
    
    console.log('✅ Successfully changed lot_size column to NUMERIC(10, 2)');
    console.log('   This now supports fractional lots like 0.03, 0.15, etc.');
    
  } catch (error) {
    console.error('❌ Error fixing lot_size column:', error.message);
    console.error('Full error:', error);
  } finally {
    await pool.end();
  }
}

fixLotSizeColumn();
