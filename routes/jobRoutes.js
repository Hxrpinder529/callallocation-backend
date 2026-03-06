const express = require('express');
const router = express.Router();
const supabase = require('../services/supabaseClient');
const { authenticate } = require('../middleware/auth');

// Search jobs by number (partial match)
router.get('/search', authenticate, async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q) {
      return res.json([]);
    }

    const { data, error } = await supabase
      .from('job_allocations')
      .select(`
        id,
        job_no,
        customer_name,
        contact_no,
        product,
        brand,
        model,
        job_status,
        allocated_asc_name,
        allocation_date,
        close_date,
        remark,
        created_at
      `)
      .ilike('job_no', `%${q}%`)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update job status
router.post('/update-status', authenticate, async (req, res) => {
  try {
    const { 
      job_no, 
      job_status, 
      close_date, 
      remark, 
      cancellation_reason,
      updated_by 
    } = req.body;

    if (!job_no || !job_status) {
      return res.status(400).json({ error: 'Job number and status are required' });
    }

    // Prepare update data
    const updateData = {
      job_status,
      remark: remark || null,
      updated_at: new Date(),
      updated_by: updated_by || req.user.name
    };

    // Add close date if status is Closed
    if (job_status === 'Closed') {
      if (!close_date) {
        return res.status(400).json({ error: 'Close date is required for closed jobs' });
      }
      updateData.close_date = close_date;
    }

    // Add cancellation reason if status is Cancelled
    if (job_status === 'Cancelled') {
      updateData.cancellation_reason = cancellation_reason || null;
    }

    // Update in database
    const { data, error } = await supabase
      .from('job_allocations')
      .update(updateData)
      .eq('job_no', job_no)
      .select();

    if (error) throw error;

    // Add to history
    await supabase
      .from('job_status_history')
      .insert({
        job_no,
        old_status: data[0]?.job_status,
        new_status: job_status,
        changed_by: updated_by || req.user.name,
        changed_at: new Date(),
        remark: remark || null
      });

    res.json({ 
      success: true, 
      message: `Job ${job_no} updated to ${job_status}`,
      data: data[0]
    });

  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get job by exact number
router.get('/:jobNo', authenticate, async (req, res) => {
  try {
    const { jobNo } = req.params;

    const { data, error } = await supabase
      .from('job_allocations')
      .select('*')
      .eq('job_no', jobNo)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(data);
  } catch (error) {
    console.error('Fetch job error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get status history for a job
router.get('/:jobNo/history', authenticate, async (req, res) => {
  try {
    const { jobNo } = req.params;

    const { data, error } = await supabase
      .from('job_status_history')
      .select('*')
      .eq('job_no', jobNo)
      .order('changed_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;