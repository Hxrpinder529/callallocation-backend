const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const supabase = require('../services/supabaseClient');
const { authenticate, authorize } = require('../middleware/auth');

// Helper function to calculate TAT (Turn Around Time)
const calculateTAT = (allocationDate, closeDate) => {
    if (!allocationDate || !closeDate) return null;
    try {
      const start = new Date(allocationDate);
      const end = new Date(closeDate);
      const diffTime = Math.abs(end - start);
      const diffDays = diffTime / (1000 * 60 * 60 * 24);
      return diffDays;
    } catch (e) {
      console.error('TAT calculation error:', e);
      return null;
    }
  };

// ASC Performance Report
router.get('/performance/asc-performance', authenticate, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
  
      console.log('Fetching ASC performance with dates:', { startDate, endDate });
  
      // Build query
      let query = supabase
        .from('job_allocations')
        .select(`
          allocated_asc_name,
          job_no,
          job_status,
          allocation_date,
          close_date,
          email_sent_status
        `)
        .not('allocated_asc_name', 'is', null)
        .neq('allocated_asc_name', '');  // Also exclude empty strings
  
      // Apply date filters if provided
      if (startDate && endDate) {
        // Convert dates to proper format
        const startDateTime = `${startDate}T00:00:00`;
        const endDateTime = `${endDate}T23:59:59`;
        
        query = query
          .gte('allocation_date', startDateTime)
          .lte('allocation_date', endDateTime);
      }
  
      const { data, error } = await query;
      
      if (error) {
        console.error('Query error:', error);
        throw error;
      }
  
      console.log(`Found ${data?.length || 0} jobs for ASC performance report`);
  
      if (!data || data.length === 0) {
        return res.json({ 
          ascData: [],
          message: 'No data found for the selected date range'
        });
      }
  
      // Aggregate by ASC
      const ascMap = {};
      data.forEach(job => {
        const ascName = job.allocated_asc_name;
        if (!ascMap[ascName]) {
          ascMap[ascName] = {
            total_jobs: 0,
            completed: 0,
            cancelled: 0,
            pending: 0,
            total_tat: 0,
            tat_count: 0,
            emails_sent: 0
          };
        }
        
        const asc = ascMap[ascName];
        asc.total_jobs++;
        
        if (job.email_sent_status) asc.emails_sent++;
        
        if (job.job_status === 'Closed') {
          asc.completed++;
          if (job.allocation_date && job.close_date) {
            const tat = calculateTAT(job.allocation_date, job.close_date);
            if (tat !== null) {
              asc.total_tat += tat;
              asc.tat_count++;
            }
          }
        } else if (job.job_status === 'Cancelled') {
          asc.cancelled++;
        } else {
          asc.pending++;
        }
      });
  
      // Calculate averages and format
      const ascData = Object.entries(ascMap).map(([name, stats]) => ({
        asc_name: name,
        total_jobs: stats.total_jobs,
        completed: stats.completed,
        cancelled: stats.cancelled,
        pending: stats.pending,
        avg_tat: stats.tat_count > 0 ? Number((stats.total_tat / stats.tat_count).toFixed(1)) : 0,
        email_success_rate: stats.total_jobs > 0 ? 
          Math.round((stats.emails_sent / stats.total_jobs) * 100) : 0,
        completion_rate: stats.total_jobs > 0 ?
          Math.round((stats.completed / stats.total_jobs) * 100) : 0
      }));
  
      // Sort by total jobs (descending)
      ascData.sort((a, b) => b.total_jobs - a.total_jobs);
  
      console.log(`Returning ${ascData.length} ASCs with performance data`);
      res.json({ ascData });
  
    } catch (error) {
      console.error('ASC Performance error:', error);
      res.status(500).json({ error: error.message });
    }
  });

// TAT Report
router.get('/performance/tat-report', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let query = supabase
      .from('job_allocations')
      .select(`
        job_no,
        customer_name,
        allocated_asc_name,
        allocation_date,
        close_date,
        job_status
      `)
      .eq('job_status', 'Closed')
      .not('close_date', 'is', null);

    if (startDate) {
      query = query.gte('close_date', startDate);
    }
    if (endDate) {
      query = query.lte('close_date', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Calculate TAT for each job
    const jobsWithTAT = data.map(job => {
      const tat = calculateTAT(job.allocation_date, job.close_date);
      return {
        ...job,
        tat: tat || 0
      };
    }).filter(job => job.tat > 0);

    // Calculate statistics
    const tats = jobsWithTAT.map(j => j.tat);
    const avgTAT = tats.reduce((a, b) => a + b, 0) / tats.length;
    const minTAT = Math.min(...tats);
    const maxTAT = Math.max(...tats);
    const withinSLA = tats.filter(t => t <= 2).length; // 48 hours SLA
    const withinSLAPercent = Math.round((withinSLA / tats.length) * 100);

    // Create distribution
    const distribution = [
      { range: '0-1 days', count: tats.filter(t => t <= 1).length },
      { range: '1-2 days', count: tats.filter(t => t > 1 && t <= 2).length },
      { range: '2-3 days', count: tats.filter(t => t > 2 && t <= 3).length },
      { range: '3-5 days', count: tats.filter(t => t > 3 && t <= 5).length },
      { range: '5+ days', count: tats.filter(t => t > 5).length }
    ];

    // Get slowest jobs (exceeding SLA)
    const slowJobs = jobsWithTAT
      .filter(j => j.tat > 2)
      .sort((a, b) => b.tat - a.tat)
      .slice(0, 20)
      .map(j => ({
        job_no: j.job_no,
        asc_name: j.allocated_asc_name,
        customer_name: j.customer_name,
        allocation_date: j.allocation_date,
        close_date: j.close_date,
        tat: j.tat
      }));

    res.json({
      tatData: {
        avg_tat: avgTAT,
        min_tat: minTAT,
        max_tat: maxTAT,
        within_sla: withinSLAPercent,
        total_jobs: tats.length,
        distribution,
        slow_jobs: slowJobs
      }
    });
  } catch (error) {
    console.error('TAT Report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Brand Performance
router.get('/performance/brand-performance', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let query = supabase
      .from('job_allocations')
      .select(`
        brand,
        job_no,
        job_status,
        allocation_date,
        close_date
      `)
      .not('brand', 'is', null);

    if (startDate) {
      query = query.gte('allocation_date', startDate);
    }
    if (endDate) {
      query = query.lte('allocation_date', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Aggregate by brand
    const brandMap = {};
    const brandDistribution = [];

    data.forEach(job => {
      if (!brandMap[job.brand]) {
        brandMap[job.brand] = {
          total: 0,
          completed: 0,
          cancelled: 0,
          total_tat: 0,
          tat_count: 0
        };
      }
      
      const brand = brandMap[job.brand];
      brand.total++;
      
      if (job.job_status === 'Closed') {
        brand.completed++;
        const tat = calculateTAT(job.allocation_date, job.close_date);
        if (tat !== null) {
          brand.total_tat += tat;
          brand.tat_count++;
        }
      } else if (job.job_status === 'Cancelled') {
        brand.cancelled++;
      }
    });

    // Format brand performance
    const brandPerformance = Object.entries(brandMap).map(([name, stats]) => ({
      name,
      total: stats.total,
      completed: stats.completed,
      cancelled: stats.cancelled,
      avg_tat: stats.tat_count > 0 ? (stats.total_tat / stats.tat_count) : 0,
      success_rate: stats.total > 0 ? 
        Math.round((stats.completed / stats.total) * 100) : 0
    }));

    // Distribution for pie chart
    const distribution = brandPerformance.map(b => ({
      name: b.name,
      value: b.total
    }));

    res.json({
      brandData: {
        performance: brandPerformance,
        distribution
      }
    });
  } catch (error) {
    console.error('Brand Performance error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Zone Performance
router.get('/performance/zone-performance', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // First get all ASCs with their zones
    const { data: ascData, error: ascError } = await supabase
      .from('asc_network')
      .select('id, asp_name, zone, asm_name');

    if (ascError) throw ascError;

    // Create zone mapping
    const zoneMap = {};
    ascData.forEach(asc => {
      if (!zoneMap[asc.zone]) {
        zoneMap[asc.zone] = {
          name: asc.zone,
          asms: new Set(),
          asc_ids: []
        };
      }
      zoneMap[asc.zone].asms.add(asc.asm_name);
      zoneMap[asc.zone].asc_ids.push(asc.id);
    });

    // Get job data
    let jobQuery = supabase
      .from('job_allocations')
      .select(`
        allocated_asc_id,
        job_status,
        allocation_date,
        close_date
      `)
      .not('allocated_asc_id', 'is', null);

    if (startDate) {
      jobQuery = jobQuery.gte('allocation_date', startDate);
    }
    if (endDate) {
      jobQuery = jobQuery.lte('allocation_date', endDate);
    }

    const { data: jobData, error: jobError } = await jobQuery;
    if (jobError) throw jobError;

    // Calculate zone performance
    const zonePerformance = Object.values(zoneMap).map(zone => {
      const zoneJobs = jobData.filter(job => zone.asc_ids.includes(job.allocated_asc_id));
      
      const completed = zoneJobs.filter(j => j.job_status === 'Closed').length;
      const tats = zoneJobs
        .filter(j => j.job_status === 'Closed' && j.close_date)
        .map(j => calculateTAT(j.allocation_date, j.close_date))
        .filter(t => t !== null);

      return {
        name: zone.name,
        total: zoneJobs.length,
        completed,
        cancelled: zoneJobs.filter(j => j.job_status === 'Cancelled').length,
        pending: zoneJobs.filter(j => !['Closed', 'Cancelled'].includes(j.job_status)).length,
        avg_tat: tats.length > 0 ? tats.reduce((a, b) => a + b, 0) / tats.length : 0,
        asm_count: zone.asms.size
      };
    });

    res.json({ zoneData: zonePerformance });
  } catch (error) {
    console.error('Zone Performance error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Daily Trends
router.get('/performance/daily-trends', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let query = supabase
      .from('job_allocations')
      .select(`
        job_no,
        job_status,
        allocation_date,
        close_date
      `);

    if (startDate) {
      query = query.gte('allocation_date', startDate);
    }
    if (endDate) {
      query = query.lte('allocation_date', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Group by date
    const dailyMap = {};
    data.forEach(job => {
      if (!job.allocation_date) return;
      
      const date = new Date(job.allocation_date).toLocaleDateString();
      if (!dailyMap[date]) {
        dailyMap[date] = {
          date,
          allocated: 0,
          completed: 0,
          cancelled: 0,
          pending: 0
        };
      }
      
      dailyMap[date].allocated++;
      
      if (job.job_status === 'Closed') {
        dailyMap[date].completed++;
      } else if (job.job_status === 'Cancelled') {
        dailyMap[date].cancelled++;
      } else {
        dailyMap[date].pending++;
      }
    });

    const dailyData = Object.values(dailyMap).sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    );

    // Calculate summary
    const summary = {
      total: data.length,
      completed: data.filter(j => j.job_status === 'Closed').length,
      cancelled: data.filter(j => j.job_status === 'Cancelled').length,
      pending: data.filter(j => !['Closed', 'Cancelled'].includes(j.job_status)).length,
      completion_rate: data.length > 0 ? 
        Math.round((data.filter(j => j.job_status === 'Closed').length / data.length) * 100) : 0,
      cancellation_rate: data.length > 0 ?
        Math.round((data.filter(j => j.job_status === 'Cancelled').length / data.length) * 100) : 0,
      avg_daily: data.length > 0 ? Math.round(data.length / Object.keys(dailyMap).length) : 0
    };

    res.json({
      dailyData,
      summary
    });
  } catch (error) {
    console.error('Daily Trends error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download endpoints (Excel/CSV)
router.get('/performance/:reportType/download', authenticate, async (req, res) => {
  try {
    const { reportType } = req.params;
    const { startDate, endDate, format = 'excel' } = req.query;

    // Fetch the same data as the view endpoint
    const response = await fetch(`http://localhost:${process.env.PORT || 5000}/api/reports/performance/${reportType}?startDate=${startDate}&endDate=${endDate}`, {
      headers: { Authorization: req.headers.authorization }
    });
    
    const data = await response.json();

    // Format data for export based on report type
    let exportData = [];
    switch(reportType) {
      case 'asc-performance':
        exportData = data.ascData?.map(asc => ({
          'ASC Name': asc.asc_name,
          'Total Jobs': asc.total_jobs,
          'Completed': asc.completed,
          'Cancelled': asc.cancelled,
          'Pending': asc.pending,
          'Avg TAT (Days)': asc.avg_tat.toFixed(1),
          'Email Success Rate': `${asc.email_success_rate}%`,
          'Completion Rate': `${asc.completion_rate}%`
        })) || [];
        break;
        
      case 'tat-report':
        exportData = data.tatData?.slow_jobs?.map(job => ({
          'Job No': job.job_no,
          'ASC': job.asc_name,
          'Customer': job.customer_name,
          'Allocation Date': new Date(job.allocation_date).toLocaleDateString(),
          'Close Date': new Date(job.close_date).toLocaleDateString(),
          'TAT (Days)': job.tat.toFixed(1)
        })) || [];
        break;
        
      case 'brand-performance':
        exportData = data.brandData?.performance?.map(brand => ({
          'Brand': brand.name,
          'Total Jobs': brand.total,
          'Completed': brand.completed,
          'Cancelled': brand.cancelled,
          'Avg TAT': brand.avg_tat.toFixed(1),
          'Success Rate': `${brand.success_rate}%`
        })) || [];
        break;
        
      case 'zone-performance':
        exportData = data.zoneData?.map(zone => ({
          'Zone': zone.name,
          'Total Jobs': zone.total,
          'Completed': zone.completed,
          'Cancelled': zone.cancelled,
          'Pending': zone.pending,
          'Avg TAT': zone.avg_tat.toFixed(1),
          'ASM Count': zone.asm_count
        })) || [];
        break;
        
      case 'daily-trends':
        exportData = data.dailyData?.map(day => ({
          'Date': day.date,
          'Allocated': day.allocated,
          'Completed': day.completed,
          'Cancelled': day.cancelled,
          'Pending': day.pending
        })) || [];
        break;
        
      default:
        exportData = [];
    }

    if (format === 'excel') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportData);
      XLSX.utils.book_append_sheet(wb, ws, reportType);
      
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${reportType}-${startDate}-to-${endDate}.xlsx`);
      res.send(buffer);
    } else {
      // CSV format
      const ws = XLSX.utils.json_to_sheet(exportData);
      const csv = XLSX.utils.sheet_to_csv(ws);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${reportType}-${startDate}-to-${endDate}.csv`);
      res.send(csv);
    }
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;