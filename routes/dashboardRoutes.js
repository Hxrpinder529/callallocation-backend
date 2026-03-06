const express = require('express');
const router = express.Router();
const supabase = require('../services/supabaseClient');

// Get dashboard statistics
router.get('/stats', async (req, res) => {
  try {
    // Get total calls
    const { count: totalCalls, error: totalError } = await supabase
      .from('job_allocations')
      .select('*', { count: 'exact', head: true });

    // Get allocated calls
    const { count: allocatedCalls, error: allocatedError } = await supabase
      .from('job_allocations')
      .select('*', { count: 'exact', head: true })
      .eq('allocation_status', 'allocated');

    // Get total ASCs
    const { count: totalASCs, error: ascsError } = await supabase
      .from('asc_network')
      .select('*', { count: 'exact', head: true });

    // Get unallocated from recent upload
    const { data: recentUpload, error: recentError } = await supabase
      .from('allocation_history')
      .select('file_name')
      .order('allocated_at', { ascending: false })
      .limit(1);

    let unallocatedCalls = 0;
    if (recentUpload && recentUpload.length > 0) {
      const { count, error: unallocatedError } = await supabase
        .from('job_allocations')
        .select('*', { count: 'exact', head: true })
        .eq('file_name', recentUpload[0].file_name)
        .is('allocated_asc_id', null);
      
      if (!unallocatedError) {
        unallocatedCalls = count || 0;
      }
    }

    res.json({
      totalCalls: totalCalls || 0,
      allocatedCalls: allocatedCalls || 0,
      unallocatedCalls: unallocatedCalls,
      pendingCalls: (totalCalls || 0) - (allocatedCalls || 0),
      totalASCs: totalASCs || 0
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get recent allocation activity
router.get('/recent', async (req, res) => {
  try {
    // First get recent allocations
    const { data: historyData, error: historyError } = await supabase
      .from('allocation_history')
      .select(`
        id,
        job_no,
        asc_id,
        asc_name,
        allocation_step,
        allocated_at,
        file_name
      `)
      .order('allocated_at', { ascending: false })
      .limit(10);

    if (historyError) throw historyError;

    // Then get email status for each job
    const enhancedData = await Promise.all((historyData || []).map(async (item) => {
      const { data: jobData, error: jobError } = await supabase
        .from('job_allocations')
        .select('email_sent_status')
        .eq('job_no', item.job_no)
        .maybeSingle();
      
      return {
        ...item,
        email_sent: jobData?.email_sent_status || false
      };
    }));

    res.json(enhancedData);
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get allocation trend by step
router.get('/trend', async (req, res) => {
  try {
    // Get all allocation history and count by step manually
    const { data, error } = await supabase
      .from('allocation_history')
      .select('allocation_step');

    if (error) throw error;

    // Manually count by step
    const stepCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    (data || []).forEach(item => {
      if (item.allocation_step >= 1 && item.allocation_step <= 4) {
        stepCounts[item.allocation_step]++;
      }
    });

    const steps = [
      { name: 'Step 1 - Same PIN', value: stepCounts[1] },
      { name: 'Step 2 - Nearby PIN', value: stepCounts[2] },
      { name: 'Step 3 - Same City', value: stepCounts[3] },
      { name: 'Step 4 - Same State', value: stepCounts[4] }
    ];

    res.json(steps);
  } catch (error) {
    console.error('Error fetching trend:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get daily allocation trend (last 7 days)
router.get('/daily', async (req, res) => {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data, error } = await supabase
      .from('allocation_history')
      .select('allocated_at')
      .gte('allocated_at', sevenDaysAgo.toISOString())
      .order('allocated_at');

    if (error) throw error;

    // Group by date manually
    const dailyData = {};
    (data || []).forEach(item => {
      const date = new Date(item.allocated_at).toLocaleDateString();
      if (!dailyData[date]) {
        dailyData[date] = { date, total: 0 };
      }
      dailyData[date].total++;
    });

    // Convert to array and add allocated count (same as total for now)
    const result = Object.values(dailyData).map(item => ({
      ...item,
      allocated: item.total
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching daily trend:', error);
    res.status(500).json({ error: error.message });
  }
});

// Combined dashboard data
router.get('/history', async (req, res) => {
  try {
    // Fetch all data in parallel with proper error handling
    const baseUrl = `http://localhost:${process.env.PORT || 5000}`;
    
    const [statsRes, recentRes, trendRes, dailyRes] = await Promise.allSettled([
      fetch(`${baseUrl}/api/dashboard/stats`).then(r => r.json()),
      fetch(`${baseUrl}/api/dashboard/recent`).then(r => r.json()),
      fetch(`${baseUrl}/api/dashboard/trend`).then(r => r.json()),
      fetch(`${baseUrl}/api/dashboard/daily`).then(r => r.json())
    ]);

    res.json({
      stats: statsRes.status === 'fulfilled' ? statsRes.value : { totalCalls: 0, allocatedCalls: 0, unallocatedCalls: 0, pendingCalls: 0, totalASCs: 0 },
      recent: recentRes.status === 'fulfilled' ? recentRes.value : [],
      trend: trendRes.status === 'fulfilled' ? trendRes.value : [],
      daily: dailyRes.status === 'fulfilled' ? dailyRes.value : []
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;