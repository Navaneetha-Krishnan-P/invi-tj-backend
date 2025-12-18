const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const {
  getDashboardStats,
  getUserTrades,
  getMonthlyPerformance,
  getProfitOverTime,
  getComparisonData
} = require('../controllers/dashboardController');

// Get dashboard statistics
router.get('/stats', authenticateToken, getDashboardStats);

// Get all user trades with filters
router.get('/trades', authenticateToken, getUserTrades);

// Get monthly performance
router.get('/performance', authenticateToken, getMonthlyPerformance);

// Get profit over time (daily, weekly, monthly)
router.get('/profit-over-time', authenticateToken, getProfitOverTime);

// Get comparison data
router.get('/comparison', authenticateToken, getComparisonData);

module.exports = router;
