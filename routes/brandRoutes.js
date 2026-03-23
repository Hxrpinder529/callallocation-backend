const express = require('express');
const router = express.Router();
const supabase = require('../services/supabaseClient');
const { authenticate, authorize } = require('../middleware/auth');

// Get all brands
router.get('/', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('brands')
      .select('*')
      .order('name');
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching brands:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get brand by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('brands')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching brand:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new brand (Admin only)
router.post('/', authenticate, authorize('Admin'), async (req, res) => {
  try {
    const { name, sla_days } = req.body;
    
    const { data, error } = await supabase
      .from('brands')
      .insert({ name, sla_days })
      .select()
      .single();
    
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error creating brand:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update brand (Admin only)
router.put('/:id', authenticate, authorize('Admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, sla_days } = req.body;
    
    const { data, error } = await supabase
      .from('brands')
      .update({ name, sla_days, updated_at: new Date() })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error updating brand:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete brand (Admin only)
router.delete('/:id', authenticate, authorize('Admin'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from('brands')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting brand:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;