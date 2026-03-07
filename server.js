const express = require('express');
const cors = require('cors');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const authRoutes = require('./routes/authRoutes');
const reportRoutes = require('./routes/reportRoutes');
const networkRoutes = require('./routes/networkRoutes');
const jobRoutes = require('./routes/jobRoutes');
const performanceRoutes = require('./routes/performanceRoutes');
const adminRoutes = require('./routes/adminRoutes');
const fs = require('fs');
const dashboardRoutes = require('./routes/dashboardRoutes');
const allocationLogic = require('./services/allocationLogic');
const supabase = require('./services/supabaseClient');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const corsOptions = {
  origin: function (origin, callback) {
    // Allow all localhost origins for development
    const allowedOrigins = [
      /^http:\/\/localhost:\d+$/,
      /^http:\/\/127\.0\.0\.1:\d+$/,
      'https://callallocation-backend.onrender.com',
      'https://callallocation-frontend.vercel.app',
      /\.vercel\.app$/
    ];
    
    // Check if origin matches any pattern
    const allowed = allowedOrigins.some(pattern => {
      if (pattern instanceof RegExp) {
        return pattern.test(origin);
      }
      return pattern === origin;
    });

    // Allow requests with no origin
    if (allowed || !origin) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

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
    cb(null, 'calls-' + uniqueSuffix + '.xlsx');
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

// Root endpoint (to check if API is running)
app.get('/', (req, res) => {
  res.json({ 
    message: 'RV Solutions API is running',
    version: '1.0.0',
    endpoints: [
      '/api/health',
      '/api/upload-allocate',
      '/api/history',
      '/api/network',
      '/api/auth',
      '/api/dashboard',
      '/api/reports',
      '/api/jobs',
      '/api/admin'
    ]
  });
});

// Health check endpoint (for keep-alive and Render monitoring)
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Simple ping endpoint (for keep-alive)
app.get('/api/ping', (req, res) => {
  res.status(200).send('pong');
});

// API ROUTES
// 1. Upload and allocate calls
app.post('/api/upload-allocate', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Read uploaded Excel file
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const callsData = XLSX.utils.sheet_to_json(worksheet);
    
    // Get network data from database
    const { data: networkData, error: networkError } = await supabase
      .from('asc_network')
      .select('*')
      .eq('brand_id', 1); // Reliance TV brand
      
    if (networkError) {
      throw networkError;
    }
    
    if (!networkData || networkData.length === 0) {
      return res.status(400).json({ 
        error: 'No network data found. Please upload network data first.' 
      });
    }
    
    // Run allocation logic
    const result = await allocationLogic.allocateCalls(
      callsData, 
      networkData, 
      req.file.originalname
    );
    
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }
    
    // Create output Excel file with allocations
    const outputData = callsData.map(call => {
      const allocated = result.allocated.find(a => a['Job No.'] === call['Job No.']);
      if (allocated) {
        return {
          ...call,
          'Allocated ASC': allocated.allocated_asc.asp_name,
          'Allocated ASC Email': allocated.allocated_asc.sc_email_id,
          'Allocation Step': allocated.allocation_step
        };
      }
      return {
        ...call,
        'Allocated ASC': 'NOT ALLOCATED',
        'Allocation Step': '0'
      };
    });
    
    // Create new workbook
    const newWorkbook = XLSX.utils.book_new();
    const newWorksheet = XLSX.utils.json_to_sheet(outputData);
    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, 'Allocated Calls');
    
    // Save output file
    const outputFileName = 'allocated-' + Date.now() + '.xlsx';
    const outputPath = path.join('uploads', outputFileName);
    XLSX.writeFile(newWorkbook, outputPath);
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      message: 'Allocation completed',
      summary: result.summary,
      downloadUrl: `/uploads/${outputFileName}`,
      outputFile: outputFileName
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Download allocated file
app.get('/api/download/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'uploads', req.params.filename);
  res.download(filePath);
});

// 3. Get allocation history
app.get('/api/history', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('allocation_history')
      .select('*')
      .order('allocated_at', { ascending: false })
      .limit(100);
      
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Get network data
app.get('/api/network', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('asc_network')
      .select('*')
      .eq('brand_id', 1);
      
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Add new ASC to network
app.post('/api/network/add', async (req, res) => {
  try {
    const ascData = {
      ...req.body,
      created_by: 'Harpinder Singh',
      created_at: new Date(),
      brand_id: 1
    };
    
    const { data, error } = await supabase
      .from('asc_network')
      .insert(ascData)
      .select();
      
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Bulk upload network data
app.post('/api/network/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Read Excel file
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const networkData = XLSX.utils.sheet_to_json(worksheet);
    
    console.log('First row of Excel:', networkData[0]); // Debug log
    
    // Map your Excel columns to database columns
    const enrichedData = networkData.map(row => {
      // Handle the multiple Nearby Pincode columns
      const nearbyArray = [];
      
      // Collect all Nearby Pincode columns (there are 10 of them)
      for (let i = 1; i <= 10; i++) {
        // Check if the column exists (Excel might name them "Nearby Pincode" repeatedly)
        const nearbyValue = row[`Nearby Pincode`];
        
        // Since Excel has multiple columns with same name, we need to access by position
        // This is tricky - let's use Object.values approach
      }
      
      // Better approach: get all values and filter for Nearby Pincode
      const values = Object.values(row);
      const keys = Object.keys(row);
      
      // Find all Nearby Pincode columns (they'll have same key name)
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
        created_by: 'Harpinder Singh',
        created_at: new Date(),
        brand_id: 1
      };
    });
    
    console.log('Mapped data first row:', enrichedData[0]); // Debug log
    
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
      message: `Uploaded ${data.length} ASC records`,
      count: data.length
    });
    
  } catch (error) {
    console.error('Network upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ROUTE MOUNTING (AFTER ALL ROUTES ARE DEFINED)
app.use('/api/auth', authRoutes);
app.use('/api/reports', performanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/network', networkRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/admin', adminRoutes);

// Simple in-memory keep-alive
if (process.env.NODE_ENV === 'production') {
  console.log('Starting keep-alive service...');
  
  const PING_INTERVAL = 14 * 60 * 1000; // 14 minutes
  const SELF_URL = process.env.RENDER_URL || 'https://callallocation-backend.onrender.com';
  
  function pingSelf() {
    console.log(`[${new Date().toISOString()}] Pinging self to keep alive...`);
    
    const https = require('https');
    https.get(`${SELF_URL}/api/ping`, (resp) => {
      if (resp.statusCode === 200) {
        console.log('Self-ping successful');
      } else {
        console.log(`Self-ping returned ${resp.statusCode}`);
      }
    }).on('error', (err) => {
      console.error('Self-ping failed:', err.message);
    });
  }
  
  // Ping immediately, then every 14 minutes
  setTimeout(() => pingSelf(), 30 * 1000); // Wait 30 seconds after startup
  setInterval(pingSelf, PING_INTERVAL);
  
  console.log(`Keep-alive scheduled every ${PING_INTERVAL/60000} minutes`);
}

// START SERVER

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`API base URL: https://callallocation-backend.onrender.com`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});