const supabase = require('./supabaseClient');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

const authService = {
  // Register new user
  register: async (userData) => {
    try {
      // Check if user exists
      const { data: existing } = await supabase
        .from('users')
        .select('email')
        .eq('email', userData.email)
        .maybeSingle();

      if (existing) {
        return { success: false, error: 'User already exists' };
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(userData.password, 10);

      // Insert user
      const { data, error } = await supabase
        .from('users')
        .insert({
          email: userData.email,
          password: hashedPassword,
          name: userData.name,
          role: userData.role || 'KAM',
          brand_id: userData.brand_id || 1,
          created_at: new Date()
        })
        .select()
        .single();

      if (error) throw error;

      // Generate token
      const token = jwt.sign(
        { id: data.id, email: data.email, role: data.role, brand_id: data.brand_id },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      return {
        success: true,
        token,
        user: {
          id: data.id,
          email: data.email,
          name: data.name,
          role: data.role,
          brand_id: data.brand_id
        }
      };
    } catch (error) {
      console.error('Registration error:', error);
      return { success: false, error: error.message };
    }
  },

  // Login user
  login: async (email, password) => {
    try {
      console.log('Login attempt for email:', email); // Debug log
      
      // Get user
      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .maybeSingle(); // Use maybeSingle instead of single to avoid error
  
      console.log('User found:', user ? 'Yes' : 'No'); // Debug log
  
      if (error || !user) {
        console.log('User not found or error:', error);
        return { success: false, error: 'Invalid email or password' };
      }
  
      // Check if user is active
      if (user.is_active === false) {
        return { success: false, error: 'Account is deactivated. Please contact admin.' };
      }
  
      // TEMPORARY: Plain text password check
      // We'll check both plain text and bcrypt for now
      let validPassword = false;
      
      // Check if it's a bcrypt hash (starts with $2a$ or $2b$)
      if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
        // It's a bcrypt hash
        validPassword = await bcrypt.compare(password, user.password);
        console.log('Bcrypt comparison result:', validPassword);
      } else {
        // It's plain text - direct comparison
        validPassword = (user.password === password);
        console.log('Plain text comparison result:', validPassword);
      }
  
      if (!validPassword) {
        console.log('Password mismatch');
        return { success: false, error: 'Invalid email or password' };
      }
  
      // Update last login
      await supabase
        .from('users')
        .update({ last_login: new Date() })
        .eq('id', user.id);
  
      // Generate token
      const token = jwt.sign(
        { 
          id: user.id, 
          email: user.email, 
          role: user.role, 
          brand_id: user.brand_id,
          name: user.name 
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
  
      console.log('Login successful for:', user.email); // Debug log
  
      return {
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          brand_id: user.brand_id
        }
      };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message };
    }
  },

  // Verify token
  verifyToken: (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return { success: true, user: decoded };
    } catch (error) {
      return { success: false, error: 'Invalid token' };
    }
  },

  // Get user by ID
  getUserById: async (id) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, name, role, brand_id, created_at')
        .eq('id', id)
        .single();

      if (error) throw error;
      return { success: true, user: data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Change password
  changePassword: async (userId, oldPassword, newPassword) => {
    try {
      // Get user
      const { data: user, error } = await supabase
        .from('users')
        .select('password')
        .eq('id', userId)
        .single();

      if (error) throw error;

      // Verify old password
      const validPassword = await bcrypt.compare(oldPassword, user.password);
      if (!validPassword) {
        return { success: false, error: 'Current password is incorrect' };
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password
      const { error: updateError } = await supabase
        .from('users')
        .update({ password: hashedPassword })
        .eq('id', userId);

      if (updateError) throw updateError;

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

module.exports = authService;