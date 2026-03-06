const express = require('express');
const router = express.Router();
const supabase = require('../services/supabaseClient');
const { authenticate, authorize } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { sendWelcomeEmail } = require('../services/emailService');

// Get all users (Admin only)
router.get('/users', authenticate, authorize('Admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, name, role, brand_id, is_active, created_at, last_login')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new user (Admin only)
router.post('/users', authenticate, authorize('Admin'), async (req, res) => {
  try {
    const { email, password, name, role, brand_id, is_active, send_email } = req.body;

    // Check if user exists
    const { data: existing } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const { data, error } = await supabase
      .from('users')
      .insert({
        email,
        password: hashedPassword,
        name,
        role: role || 'KAM',
        brand_id: brand_id || 1,
        is_active: is_active !== undefined ? is_active : true,
        created_by: req.user.id,
        created_at: new Date()
      })
      .select()
      .single();

    if (error) throw error;

    // Send welcome email if requested
    if (send_email) {
      try {
        await sendWelcomeEmail(email, password, name);
      } catch (emailError) {
        console.error('Welcome email failed:', emailError);
      }
    }

    // Log the action
    await supabase
      .from('admin_logs')
      .insert({
        admin_id: req.user.id,
        action: 'CREATE_USER',
        target: email,
        details: { role, brand_id }
      });

    res.json({
      success: true,
      message: 'User created successfully',
      user: {
        id: data.id,
        email: data.email,
        name: data.name,
        role: data.role,
        brand_id: data.brand_id
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update user (Admin only)
router.put('/users/:id', authenticate, authorize('Admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const { name, email, role, brand_id, is_active } = req.body;
  
      // Check if email already exists for another user
      if (email) {
        const { data: existing } = await supabase
          .from('users')
          .select('id')
          .eq('email', email)
          .neq('id', id)
          .maybeSingle();
  
        if (existing) {
          return res.status(400).json({ error: 'Email already in use by another user' });
        }
      }
  
      const updateData = {
        name,
        email,
        role,
        brand_id,
        is_active,
        updated_at: new Date(),
        updated_by: req.user.id
      };
  
      // Remove undefined fields
      Object.keys(updateData).forEach(key => 
        updateData[key] === undefined && delete updateData[key]
      );
  
      const { data, error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
  
      if (error) throw error;
  
      // Log the action
      await supabase
        .from('admin_logs')
        .insert({
          admin_id: req.user.id,
          action: 'UPDATE_USER',
          target: data.email,
          details: { name, email, role, brand_id, is_active }
        });
  
      res.json({ 
        success: true, 
        message: 'User updated successfully',
        user: {
          id: data.id,
          name: data.name,
          email: data.email,
          role: data.role,
          brand_id: data.brand_id,
          is_active: data.is_active
        }
      });
    } catch (error) {
      console.error('Error updating user:', error);
      res.status(500).json({ error: error.message });
    }
  });

// Reset password (Admin only)
router.post('/users/:id/reset-password', authenticate, authorize('Admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const { error } = await supabase
      .from('users')
      .update({
        password: hashedPassword,
        password_reset_at: new Date(),
        password_reset_by: req.user.id
      })
      .eq('id', id);

    if (error) throw error;

    // Get user email for logging
    const { data: user } = await supabase
      .from('users')
      .select('email')
      .eq('id', id)
      .single();

    // Log the action
    await supabase
      .from('admin_logs')
      .insert({
        admin_id: req.user.id,
        action: 'RESET_PASSWORD',
        target: user.email
      });

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: error.message });
  }
});

// Toggle user status (Admin only)
router.put('/users/:id/status', authenticate, authorize('Admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    const { data, error } = await supabase
      .from('users')
      .update({
        is_active,
        updated_at: new Date(),
        updated_by: req.user.id
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Log the action
    await supabase
      .from('admin_logs')
      .insert({
        admin_id: req.user.id,
        action: is_active ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
        target: data.email
      });

    res.json({ 
      success: true, 
      message: `User ${is_active ? 'activated' : 'deactivated'} successfully` 
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get admin logs (Admin only)
router.get('/logs', authenticate, authorize('Admin'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('admin_logs')
      .select(`
        *,
        admin:admin_id (name, email)
      `)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;