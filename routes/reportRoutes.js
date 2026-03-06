const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const supabase = require('../services/supabaseClient');
const { authenticate, authorize } = require('../middleware/auth');

// Generate Excel report
const generateExcelReport = (data, sheetName) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

// Allocation Summary Report
router.get('/allocation-summary', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let query = supabase
      .from('job_allocations')
      .select('*')
      .order('allocation_date', { ascending: false });

    if (startDate) {
      query = query.gte('allocation_date', startDate);
    }
    if (endDate) {
      query = query.lte('allocation_date', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data || data.length === 0) {
      // Return empty file with headers
      const emptyData = [{
        'Job No': 'No data found',
        'Customer Name': '',
        'Contact No': '',
        'ASC Name': '',
        'Allocation Date': '',
        'Email Status': ''
      }];
      const buffer = generateExcelReport(emptyData, 'Allocation Summary');
      return res.send(buffer);
    }

    // Format data
    const formattedData = data.map(job => ({
      'Job No': job.job_no || '',
      'Customer Name': job.customer_name || '',
      'Contact No': job.contact_no || '',
      'Product': job.product || '',
      'Brand': job.brand || '',
      'Model': job.model || '',
      'ASC Name': job.allocated_asc_name || 'Not Allocated',
      'Allocation Date': job.allocation_date ? new Date(job.allocation_date).toLocaleDateString() : '',
      'Email Status': job.email_sent_status ? 'Sent' : 'Pending',
      'File Name': job.file_name || ''
    }));

    const buffer = generateExcelReport(formattedData, 'Allocation Summary');
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=allocation-summary.xlsx');
    res.send(buffer);
  } catch (error) {
    console.error('Allocation summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ASC Performance Report
router.get('/asc-performance', authenticate, authorize('Admin', 'KAM'), async (req, res) => {
  try {
    const { data: allocations, error } = await supabase
      .from('job_allocations')
      .select('allocated_asc_name, job_no, email_sent_status')
      .not('allocated_asc_name', 'is', null);

    if (error) throw error;

    if (!allocations || allocations.length === 0) {
      const emptyData = [{
        'ASC Name': 'No data found',
        'Total Jobs': 0,
        'Emails Sent': 0,
        'Email Success Rate': '0%'
      }];
      const buffer = generateExcelReport(emptyData, 'ASC Performance');
      return res.send(buffer);
    }

    // Aggregate by ASC
    const ascMap = {};
    allocations.forEach(item => {
      if (!ascMap[item.allocated_asc_name]) {
        ascMap[item.allocated_asc_name] = {
          total_jobs: 0,
          emails_sent: 0
        };
      }
      ascMap[item.allocated_asc_name].total_jobs++;
      if (item.email_sent_status) {
        ascMap[item.allocated_asc_name].emails_sent++;
      }
    });

    const reportData = Object.entries(ascMap).map(([ascName, stats]) => ({
      'ASC Name': ascName,
      'Total Jobs': stats.total_jobs,
      'Emails Sent': stats.emails_sent,
      'Email Success Rate': `${((stats.emails_sent / stats.total_jobs) * 100).toFixed(1)}%`
    }));

    const buffer = generateExcelReport(reportData, 'ASC Performance');
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=asc-performance.xlsx');
    res.send(buffer);
  } catch (error) {
    console.error('ASC Performance error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Unallocated Calls Report
router.get('/unallocated', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('job_allocations')
      .select('*')
      .is('allocated_asc_id', null)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      const emptyData = [{
        'Job No': 'No unallocated calls found',
        'Customer Name': '',
        'Contact No': '',
        'Pincode': '',
        'Created Date': ''
      }];
      const buffer = generateExcelReport(emptyData, 'Unallocated Calls');
      return res.send(buffer);
    }

    const formattedData = data.map(job => ({
      'Job No': job.job_no || '',
      'Customer Name': job.customer_name || '',
      'Contact No': job.contact_no || '',
      'Address': job.address || '',
      'Pincode': job.pincode || '',
      'Product': job.product || '',
      'Brand': job.brand || '',
      'Model': job.model || '',
      'Job For': job.job_for || '',
      'Created Date': job.created_at ? new Date(job.created_at).toLocaleDateString() : ''
    }));

    const buffer = generateExcelReport(formattedData, 'Unallocated Calls');
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=unallocated-calls.xlsx');
    res.send(buffer);
  } catch (error) {
    console.error('Unallocated error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Daily Trend Report
router.get('/daily-trend', authenticate, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await supabase
      .from('allocation_history')
      .select('allocated_at, allocation_step')
      .gte('allocated_at', startDate.toISOString());

    if (error) throw error;

    if (!data || data.length === 0) {
      const emptyData = [{
        'Date': 'No data found',
        'Total Allocations': 0,
        'Step 1': 0,
        'Step 2': 0,
        'Step 3': 0,
        'Step 4': 0
      }];
      const buffer = generateExcelReport(emptyData, 'Daily Trend');
      return res.send(buffer);
    }

    // Group by date
    const dailyMap = {};
    data.forEach(item => {
      const date = new Date(item.allocated_at).toLocaleDateString();
      if (!dailyMap[date]) {
        dailyMap[date] = {
          'Date': date,
          'Total Allocations': 0,
          'Step 1': 0,
          'Step 2': 0,
          'Step 3': 0,
          'Step 4': 0
        };
      }
      dailyMap[date]['Total Allocations']++;
      dailyMap[date][`Step ${item.allocation_step}`]++;
    });

    const reportData = Object.values(dailyMap);
    const buffer = generateExcelReport(reportData, 'Daily Trend');
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=daily-trend.xlsx');
    res.send(buffer);
  } catch (error) {
    console.error('Daily trend error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Email Status Report
router.get('/email-status', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('job_allocations')
      .select(`
        job_no,
        customer_name,
        allocated_asc_name,
        email_sent_status,
        allocation_date
      `)
      .not('allocated_asc_id', 'is', null)
      .order('allocation_date', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      const emptyData = [{
        'Job No': 'No data found',
        'Customer': '',
        'ASC': '',
        'Email Status': '',
        'Allocation Date': ''
      }];
      const buffer = generateExcelReport(emptyData, 'Email Status');
      return res.send(buffer);
    }

    const reportData = data.map(job => ({
      'Job No': job.job_no || '',
      'Customer': job.customer_name || '',
      'ASC': job.allocated_asc_name || '',
      'Email Status': job.email_sent_status ? 'Sent' : 'Pending',
      'Allocation Date': job.allocation_date ? new Date(job.allocation_date).toLocaleDateString() : ''
    }));

    const buffer = generateExcelReport(reportData, 'Email Status');
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=email-status.xlsx');
    res.send(buffer);
  } catch (error) {
    console.error('Email status error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;