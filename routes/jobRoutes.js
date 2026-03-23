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

// Re-assign job to different ASC
router.post('/reassign', authenticate, authorize('KAM', 'Admin'), async (req, res) => {
  try {
    const { job_no, new_asc_id, reason } = req.body;
    
    if (!job_no || !new_asc_id) {
      return res.status(400).json({ error: 'Job number and new ASC are required' });
    }
    
    // Get current job
    const { data: job, error: jobError } = await supabase
      .from('job_allocations')
      .select('*')
      .eq('job_no', job_no)
      .maybeSingle();
    
    if (jobError || !job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    // Get new ASC details
    const { data: newAsc, error: ascError } = await supabase
      .from('asc_network')
      .select('*')
      .eq('id', new_asc_id)
      .maybeSingle();
    
    if (ascError || !newAsc) {
      return res.status(404).json({ error: 'ASC not found' });
    }
    
    // Update job with new ASC
    const { data: updatedJob, error: updateError } = await supabase
      .from('job_allocations')
      .update({
        allocated_asc_id: new_asc_id,
        allocated_asc_name: newAsc.asp_name,
        allocation_status: 'reallocated',
        reassigned_at: new Date(),
        reassigned_by: req.user.id,
        reassign_reason: reason || null,
        updated_at: new Date()
      })
      .eq('job_no', job_no)
      .select();
    
    if (updateError) throw updateError;
    
    // Log to history
    await supabase
      .from('allocation_history')
      .insert({
        job_no: job_no,
        asc_id: new_asc_id,
        asc_name: newAsc.asp_name,
        allocation_step: 5, // 5 = re-assigned
        file_name: job.file_name,
        reallocated_from: job.allocated_asc_id,
        reallocated_reason: reason
      });
    
    // Send email for re-assignment
    const { sendAllocationEmail } = require('../services/emailService');
    await sendAllocationEmail(updatedJob[0], newAsc, 'kam@rvsolutions.com', newAsc.asm_email_id);
    
    res.json({
      success: true,
      message: `Job ${job_no} reassigned to ${newAsc.asp_name}`,
      data: updatedJob[0]
    });
    
  } catch (error) {
    console.error('Reassignment error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get unallocated jobs for manual allocation
router.get('/unallocated', authenticate, authorize('KAM', 'Admin'), async (req, res) => {
  try {
    const { brand, limit = 100 } = req.query;
    
    let query = supabase
      .from('job_allocations')
      .select('*')
      .is('allocated_asc_id', null)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));
    
    if (brand && brand !== 'all') {
      query = query.eq('brand', brand);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    
    res.json(data);
  } catch (error) {
    console.error('Get unallocated error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all ASCs for selection
router.get('/asc-list', authenticate, async (req, res) => {
  try {
    const { brand_id, city, pincode } = req.query;
    
    let query = supabase
      .from('asc_network')
      .select('id, asp_name, city, coverage_pincode, zone, state');
    
    if (brand_id) {
      query = query.eq('brand_id', brand_id);
    }
    if (city) {
      query = query.ilike('city', `%${city}%`);
    }
    if (pincode) {
      query = query.eq('coverage_pincode', pincode);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    
    res.json(data);
  } catch (error) {
    console.error('Get ASC list error:', error);
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