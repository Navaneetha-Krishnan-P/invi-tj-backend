const db = require('../config/database');

// Get dashboard statistics for a user
const getDashboardStats = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get total trades count
    const totalTradesResult = await db.query(
      'SELECT COUNT(*) as count FROM tj.trade_orders WHERE user_id = $1',
      [userId]
    );

    // Get total profit/loss
    const profitLossResult = await db.query(
      'SELECT SUM(profit_loss) as total FROM tj.trade_orders WHERE user_id = $1',
      [userId]
    );

    // Get recent trades (last 10)
    const recentTradesResult = await db.query(
      `SELECT * FROM tj.trade_orders 
       WHERE user_id = $1 
       ORDER BY trade_date DESC, created_at DESC 
       LIMIT 10`,
      [userId]
    );

    // Calculate statistics
    const totalTrades = parseInt(totalTradesResult.rows[0].count) || 0;
    const totalProfitLoss = parseFloat(profitLossResult.rows[0].total) || 0;

    // Get winning and losing trades
    const winningTradesResult = await db.query(
      'SELECT COUNT(*) as count FROM tj.trade_orders WHERE user_id = $1 AND profit_loss > 0',
      [userId]
    );
    
    const losingTradesResult = await db.query(
      'SELECT COUNT(*) as count FROM tj.trade_orders WHERE user_id = $1 AND profit_loss < 0',
      [userId]
    );

    const winningTrades = parseInt(winningTradesResult.rows[0].count) || 0;
    const losingTrades = parseInt(losingTradesResult.rows[0].count) || 0;
    const winRate = totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(2) : 0;

    // Get trades by market
    const tradesByMarketResult = await db.query(
      `SELECT market_type, COUNT(*) as count, SUM(profit_loss) as total_profit 
       FROM tj.trade_orders 
       WHERE user_id = $1 
       GROUP BY market_type`,
      [userId]
    );

    res.json({
      success: true,
      stats: {
        totalTrades,
        profitLoss: totalProfitLoss,
        winningTrades,
        losingTrades,
        winRate: parseFloat(winRate),
        tradesByMarket: tradesByMarketResult.rows
      },
      recentTrades: recentTradesResult.rows
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch dashboard statistics',
      details: error.message 
    });
  }
};

// Get all trades for a user with optional filters
const getUserTrades = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { market, type, startDate, endDate, limit = 100, offset = 0, timeFilter } = req.query;

    let query = 'SELECT * FROM tj.trade_orders WHERE user_id = $1';
    const params = [userId];
    let paramCount = 1;

    // Add filters
    if (market) {
      paramCount++;
      query += ` AND UPPER(market_type) = UPPER($${paramCount})`;
      params.push(market);
    }

    if (type) {
      paramCount++;
      query += ` AND UPPER(trade_type) = UPPER($${paramCount})`;
      params.push(type);
    }


    // Support timeFilter (today, last_week, last_month, last_3months, last_6months)
    if (timeFilter && timeFilter !== 'all') {
      const now = new Date();
      let start = null;
      let end = now;
      switch (timeFilter) {
        case 'today':
          start = now.toISOString().split('T')[0];
          end = start;
          break;
        case 'last_week':
          const weekAgo = new Date(now);
          weekAgo.setDate(now.getDate() - 7);
          start = weekAgo.toISOString().split('T')[0];
          end = now.toISOString().split('T')[0];
          break;
        case 'last_month':
          const monthAgo = new Date(now);
          monthAgo.setMonth(now.getMonth() - 1);
          start = monthAgo.toISOString().split('T')[0];
          end = now.toISOString().split('T')[0];
          break;
        case 'last_3months':
          const threeMonthsAgo = new Date(now);
          threeMonthsAgo.setMonth(now.getMonth() - 3);
          start = threeMonthsAgo.toISOString().split('T')[0];
          end = now.toISOString().split('T')[0];
          break;
        case 'last_6months':
          const sixMonthsAgo = new Date(now);
          sixMonthsAgo.setMonth(now.getMonth() - 6);
          start = sixMonthsAgo.toISOString().split('T')[0];
          end = now.toISOString().split('T')[0];
          break;
        default:
          break;
      }
      if (start) {
        paramCount++;
        query += ` AND trade_date::date >= $${paramCount}::date`;
        params.push(start);
      }
      if (end) {
        paramCount++;
        query += ` AND trade_date::date <= $${paramCount}::date`;
        params.push(end);
      }
    } else {
      if (startDate) {
        paramCount++;
        query += ` AND trade_date::date >= $${paramCount}::date`;
        params.push(startDate);
      }
      if (endDate) {
        paramCount++;
        query += ` AND trade_date::date <= $${paramCount}::date`;
        params.push(endDate);
      }
    }

    // Add ordering and pagination
    query += ' ORDER BY trade_date DESC, created_at DESC';
    
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(parseInt(limit));

    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));

    const result = await db.query(query, params);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM tj.trade_orders WHERE user_id = $1';
    const countParams = [userId];
    let countParamCount = 1;

    if (market) {
      countParamCount++;
      countQuery += ` AND UPPER(market_type) = UPPER($${countParamCount})`;
      countParams.push(market);
    }

    if (type) {
      countParamCount++;
      countQuery += ` AND UPPER(trade_type) = UPPER($${countParamCount})`;
      countParams.push(type);
    }

    if (startDate) {
      countParamCount++;
      countQuery += ` AND trade_date::date >= $${countParamCount}::date`;
      countParams.push(startDate);
    }

    if (endDate) {
      countParamCount++;
      countQuery += ` AND trade_date::date <= $${countParamCount}::date`;
      countParams.push(endDate);
    }

    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      trades: result.rows,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: (parseInt(offset) + result.rows.length) < total
      }
    });

  } catch (error) {
    console.error('Get user trades error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch trades',
      details: error.message 
    });
  }
};

// Get monthly performance summary
const getMonthlyPerformance = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { year, month } = req.query;

    let query = `
      SELECT 
        DATE_TRUNC('day', trade_date) as trade_date,
        COUNT(*) as trade_count,
        SUM(profit_loss) as daily_profit,
        SUM(CASE WHEN profit_loss > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN profit_loss < 0 THEN 1 ELSE 0 END) as losses
      FROM tj.trade_orders 
      WHERE user_id = $1
    `;

    const params = [userId];
    let paramCount = 1;

    if (year && month) {
      paramCount++;
      query += ` AND EXTRACT(YEAR FROM trade_date) = $${paramCount}`;
      params.push(parseInt(year));
      
      paramCount++;
      query += ` AND EXTRACT(MONTH FROM trade_date) = $${paramCount}`;
      params.push(parseInt(month));
    }

    query += ` GROUP BY trade_date ORDER BY trade_date DESC`;

    const result = await db.query(query, params);

    res.json({
      success: true,
      performance: result.rows
    });

  } catch (error) {
    console.error('Get monthly performance error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch monthly performance',
      details: error.message 
    });
  }
};

// Get profit/loss over time (daily, weekly, monthly)
const getProfitOverTime = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { period = 'daily', market, timeFilter } = req.query; // period: daily, weekly, monthly

    let dateFormat, dateTrunc, daysBack;
    
    // If timeFilter is provided, adjust daysBack accordingly
    if (timeFilter && timeFilter !== 'all') {
      switch(timeFilter) {
        case 'last_week':
          dateFormat = 'YYYY-MM-DD';
          dateTrunc = 'day';
          daysBack = 7;
          break;
        case 'last_month':
          dateFormat = 'YYYY-MM-DD';
          dateTrunc = 'day';
          daysBack = 30;
          break;
        case 'last_3months':
          dateFormat = 'YYYY-"W"IW';
          dateTrunc = 'week';
          daysBack = 90;
          break;
        case 'last_6months':
          dateFormat = 'YYYY-MM';
          dateTrunc = 'month';
          daysBack = 180;
          break;
        default:
          dateFormat = 'YYYY-MM';
          dateTrunc = 'month';
          daysBack = 365;
      }
    } else {
      switch(period) {
        case 'weekly':
          dateFormat = 'YYYY-"W"IW'; // Week format
          dateTrunc = 'week';
          daysBack = 90; // Last 3 months
          break;
        case 'monthly':
          dateFormat = 'YYYY-MM'; // Month format
          dateTrunc = 'month';
          daysBack = 365; // Last year
          break;
        case 'daily':
        default:
          dateFormat = 'YYYY-MM-DD';
          dateTrunc = 'day';
          daysBack = 30; // Last 30 days
      }
    }

    let query = `
      SELECT 
        TO_CHAR(DATE_TRUNC($2, trade_date), $3) as period,
        DATE_TRUNC($2, trade_date) as period_date,
        COUNT(*) as trade_count,
        SUM(profit_loss) as total_profit,
        SUM(profit_loss) as gross_profit,
        SUM(CASE WHEN profit_loss > 0 THEN 1 ELSE 0 END) as winning_trades,
        SUM(CASE WHEN profit_loss < 0 THEN 1 ELSE 0 END) as losing_trades,
        AVG(profit_loss) as avg_profit
      FROM tj.trade_orders 
      WHERE user_id = $1
        AND trade_date >= CURRENT_DATE - INTERVAL '${daysBack} days'
    `;

    const params = [userId, dateTrunc, dateFormat];
    let paramCount = 3;

    if (market) {
      paramCount++;
      query += ` AND UPPER(market_type) = UPPER($${paramCount})`;
      params.push(market);
    }

    query += ` GROUP BY period, period_date ORDER BY period_date ASC`;

    const result = await db.query(query, params);

    // Calculate cumulative profit
    let cumulativeProfit = 0;
    const enrichedData = result.rows.map(row => {
      cumulativeProfit += parseFloat(row.total_profit || 0);
      return {
        period: row.period,
        date: row.period_date,
        tradeCount: parseInt(row.trade_count),
        totalProfit: parseFloat(row.total_profit || 0).toFixed(2),
        grossProfit: parseFloat(row.gross_profit || 0).toFixed(2),
        winningTrades: parseInt(row.winning_trades),
        losingTrades: parseInt(row.losing_trades),
        avgProfit: parseFloat(row.avg_profit || 0).toFixed(2),
        cumulativeProfit: cumulativeProfit.toFixed(2),
        winRate: row.trade_count > 0 
          ? ((parseInt(row.winning_trades) / parseInt(row.trade_count)) * 100).toFixed(2) 
          : 0
      };
    });

    res.json({
      success: true,
      period,
      data: enrichedData
    });

  } catch (error) {
    console.error('Get profit over time error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch profit over time',
      details: error.message 
    });
  }
};

// Get comparison data (compare different time periods)
const getComparisonData = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Last 7 days
    const last7DaysQuery = `
      SELECT 
        COUNT(*) as trade_count,
        SUM(profit_loss) as total_profit,
        SUM(CASE WHEN profit_loss > 0 THEN 1 ELSE 0 END) as winning_trades
      FROM tj.trade_orders 
      WHERE user_id = $1
        AND trade_date >= CURRENT_DATE - INTERVAL '7 days'
    `;

    // Last 30 days
    const last30DaysQuery = `
      SELECT 
        COUNT(*) as trade_count,
        SUM(profit_loss) as total_profit,
        SUM(CASE WHEN profit_loss > 0 THEN 1 ELSE 0 END) as winning_trades
      FROM tj.trade_orders 
      WHERE user_id = $1
        AND trade_date >= CURRENT_DATE - INTERVAL '30 days'
    `;

    // This month
    const thisMonthQuery = `
      SELECT 
        COUNT(*) as trade_count,
        SUM(profit_loss) as total_profit,
        SUM(CASE WHEN profit_loss > 0 THEN 1 ELSE 0 END) as winning_trades
      FROM tj.trade_orders 
      WHERE user_id = $1
        AND EXTRACT(YEAR FROM trade_date) = EXTRACT(YEAR FROM CURRENT_DATE)
        AND EXTRACT(MONTH FROM trade_date) = EXTRACT(MONTH FROM CURRENT_DATE)
    `;

    // All time
    const allTimeQuery = `
      SELECT 
        COUNT(*) as trade_count,
        SUM(profit_loss) as total_profit,
        SUM(CASE WHEN profit_loss > 0 THEN 1 ELSE 0 END) as winning_trades
      FROM tj.trade_orders 
      WHERE user_id = $1
    `;

    const [last7Days, last30Days, thisMonth, allTime] = await Promise.all([
      db.query(last7DaysQuery, [userId]),
      db.query(last30DaysQuery, [userId]),
      db.query(thisMonthQuery, [userId]),
      db.query(allTimeQuery, [userId])
    ]);

    const formatStats = (row) => {
      const tradeCount = parseInt(row.trade_count || 0);
      const winningTrades = parseInt(row.winning_trades || 0);
      return {
        tradeCount,
        totalProfit: parseFloat(row.total_profit || 0).toFixed(2),
        winningTrades,
        winRate: tradeCount > 0 ? ((winningTrades / tradeCount) * 100).toFixed(2) : 0
      };
    };

    res.json({
      success: true,
      comparison: {
        last7Days: formatStats(last7Days.rows[0]),
        last30Days: formatStats(last30Days.rows[0]),
        thisMonth: formatStats(thisMonth.rows[0]),
        allTime: formatStats(allTime.rows[0])
      }
    });

  } catch (error) {
    console.error('Get comparison data error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch comparison data',
      details: error.message 
    });
  }
};

module.exports = {
  getDashboardStats,
  getUserTrades,
  getMonthlyPerformance,
  getProfitOverTime,
  getComparisonData
};
