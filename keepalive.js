const https = require('https');

const RENDER_URL = process.env.RENDER_URL || 'https://your-app.onrender.com';

// Ping interval (14 minutes = 840,000 ms)
const INTERVAL = 14 * 60 * 1000;

function pingServer() {
  console.log(`[${new Date().toISOString()}] Pinging server to keep it alive...`);
  
  https.get(`${RENDER_URL}/api/health`, (resp) => {
    if (resp.statusCode === 200) {
      console.log('Server is awake!');
    } else {
      console.log(`Server returned status: ${resp.statusCode}`);
    }
  }).on('error', (err) => {
    console.error('Ping failed:', err.message);
  });
}

// Start pinging
console.log(`Keep-alive service started. Pinging every ${INTERVAL/60000} minutes`);
pingServer(); // Ping immediately
setInterval(pingServer, INTERVAL);