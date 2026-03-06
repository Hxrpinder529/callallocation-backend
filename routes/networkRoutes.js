const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const supabase = require('../services/supabaseClient');
const { authenticate, authorize } = require('../middleware/auth');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'network-' + uniqueSuffix + '.xlsx');
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.(xlsx|xls)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed!'), false);
    }
  }
});

// Download template
router.get('/template', authenticate, (req, res) => {
  try {
    // Create template data with headers
    const templateData = [{
      'ASP Name': 'Example Service Center',
      'Address': '123 Main Street',
      'State': 'Karnataka',
      'City': 'Bangalore',
      'Coverage Pincode': '560001',
      'SC Email Id': 'service@example.com',
      'Zone': 'South',
      'ASM': 'ASM Name',
      'ASM Mail ID': 'asm@example.com',
      'Nearby Pincode': '560002',
      'Nearby Pincode': '560003',
      'Nearby Pincode': '560004',
      'Nearby Pincode': '560005',
      'Nearby Pincode': '560006',
      'Nearby Pincode': '560007',
      'Nearby Pincode': '560008',
      'Nearby Pincode': '560009',
      'Nearby Pincode': '560010',
      'Nearby Pincode': '560011'
    }];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=network-template.xlsx');
    res.send(buffer);
  } catch (error) {
    console.error('Template error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export current network data
router.get('/export', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('asc_network')
      .select('*')
      .order('id');

    if (error) throw error;

    // Format data for export
    const exportData = data.map(asc => ({
      'ASP Name': asc.asp_name,
      'Address': asc.address,
      'State': asc.state,
      'City': asc.city,
      'Coverage Pincode': asc.coverage_pincode,
      'SC Email Id': asc.sc_email_id,
      'Zone': asc.zone,
      'ASM': asc.asm_name,
      'ASM Mail ID': asc.asm_email_id,
      'Nearby Pincode 1': asc.nearby_pincode1,
      'Nearby Pincode 2': asc.nearby_pincode2,
      'Nearby Pincode 3': asc.nearby_pincode3,
      'Nearby Pincode 4': asc.nearby_pincode4,
      'Nearby Pincode 5': asc.nearby_pincode5,
      'Nearby Pincode 6': asc.nearby_pincode6,
      'Nearby Pincode 7': asc.nearby_pincode7,
      'Nearby Pincode 8': asc.nearby_pincode8,
      'Nearby Pincode 9': asc.nearby_pincode9,
      'Nearby Pincode 10': asc.nearby_pincode10,
      'Added By': asc.created_by,
      'Added On': new Date(asc.created_at).toLocaleDateString()
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, 'Network Data');
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=network-data.xlsx');
    res.send(buffer);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload and add new ASCs
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Read Excel file
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const networkData = XLSX.utils.sheet_to_json(worksheet);

    // Get all values and filter for Nearby Pincode
    const enrichedData = networkData.map(row => {
      const values = Object.values(row);
      const keys = Object.keys(row);
      
      // Find all Nearby Pincode columns
      const nearbyColumns = [];
      keys.forEach((key, index) => {
        if (key === 'Nearby Pincode') {
          nearbyColumns.push(values[index]);
        }
      });

      return {
        asp_name: row['ASP Name'],
        address: row['Address'],
        state: row['State'],
        city: row['City'],
        coverage_pincode: row['Coverage Pincode']?.toString(),
        sc_email_id: row['SC Email Id'],
        zone: row['Zone'],
        asm_name: row['ASM'],
        asm_email_id: row['ASM Mail ID'],
        nearby_pincode1: nearbyColumns[0]?.toString(),
        nearby_pincode2: nearbyColumns[1]?.toString(),
        nearby_pincode3: nearbyColumns[2]?.toString(),
        nearby_pincode4: nearbyColumns[3]?.toString(),
        nearby_pincode5: nearbyColumns[4]?.toString(),
        nearby_pincode6: nearbyColumns[5]?.toString(),
        nearby_pincode7: nearbyColumns[6]?.toString(),
        nearby_pincode8: nearbyColumns[7]?.toString(),
        nearby_pincode9: nearbyColumns[8]?.toString(),
        nearby_pincode10: nearbyColumns[9]?.toString(),
        created_by: req.user.name || req.user.email,
        created_at: new Date(),
        brand_id: 1
      };
    });

    // Insert into database
    const { data, error } = await supabase
      .from('asc_network')
      .insert(enrichedData)
      .select();

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    // Clean up
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: `✅ Successfully added ${data.length} new ASCs`,
      count: data.length,
      data: data
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add single ASC manually
router.post('/add', authenticate, async (req, res) => {
  try {
    const ascData = {
      ...req.body,
      created_by: req.user.name || req.user.email,
      created_at: new Date(),
      brand_id: 1
    };

    const { data, error } = await supabase
      .from('asc_network')
      .insert(ascData)
      .select();

    if (error) throw error;

    res.json({ 
      success: true, 
      message: 'ASC added successfully',
      data: data[0] 
    });
  } catch (error) {
    console.error('Add ASC error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update ASC
router.put('/update/:id', authenticate, authorize('Admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = {
      ...req.body,
      updated_by: req.user.name || req.user.email,
      updated_at: new Date()
    };

    const { data, error } = await supabase
      .from('asc_network')
      .update(updateData)
      .eq('id', id)
      .select();

    if (error) throw error;

    res.json({ 
      success: true, 
      message: 'ASC updated successfully',
      data: data[0] 
    });
  } catch (error) {
    console.error('Update ASC error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete ASC
router.delete('/delete/:id', authenticate, authorize('Admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('asc_network')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ 
      success: true, 
      message: 'ASC deleted successfully' 
    });
  } catch (error) {
    console.error('Delete ASC error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;