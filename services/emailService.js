const nodemailer = require("nodemailer");
const supabase = require('./supabaseClient');
require('dotenv').config();

// Create transporter for ZeptoMail
const createTransporter = () => {
  return nodemailer.createTransport({
    host: "smtp.zeptomail.in",
    port: 465,
    secure: true, // Use SSL
    auth: {
      user: "emailapikey",
      pass: process.env.ZEPTOMAIL_PASSWORD
    },
    tls: {
      rejectUnauthorized: false
    },
    connectionTimeout: 60000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
    debug: true,
    logger: true
  });
};

// Initialize transporter
let transporter = createTransporter();
let connectionVerified = false;

// Verify connection with retry mechanism
const verifyConnection = async (retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`🔄 Attempting to verify ZeptoMail connection (attempt ${i + 1}/${retries})...`);
      await transporter.verify();
      console.log('✅ ZeptoMail transporter ready');
      connectionVerified = true;
      return true;
    } catch (error) {
      console.error(`❌ ZeptoMail connection error (attempt ${i + 1}/${retries}):`, error.message);
      
      if (i < retries - 1) {
        console.log('⏳ Waiting 5 seconds before retry...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        // Recreate transporter for new attempt
        transporter = createTransporter();
      }
    }
  }
  
  console.error('❌ Failed to verify ZeptoMail connection after multiple attempts');
  connectionVerified = false;
  return false;
};

// Verify connection on startup (don't block server start)
verifyConnection();

// Send single allocation email
const sendAllocationEmail = async (job, asc, kamEmail, asmEmail) => {
  // Format job data (handle both Excel format and DB format)
  const jobNo = job['Job No.'] || job.job_no;
  const jobFor = job['Job For'] || job.job_for || 'Service';
  const customerName = job['Customer Name'] || job.customer_name;
  const contactNo = job['Contact No.'] || job.contact_no;
  const address = job.Address || job.address;
  const brand = job.Brand || job.brand;
  const product = job.Product || job.product;
  const model = job.Model || job.model;

  // Check if connection is verified
  if (!connectionVerified) {
    console.warn('⚠️ ZeptoMail connection not verified, attempting to reconnect...');
    await verifyConnection(2);
  }

  const mailOptions = {
    from: {
      name: 'Consumer Services - RV Solutions',
      address: 'notifications@rvsolutions-notify.in'
    },
    to: asc.sc_email_id,
    cc: [kamEmail, asmEmail].filter(email => email && email.trim() !== ''),
    subject: `Reliance TV | RV Solutions – Technician Visit Request – Job ID ${jobNo}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .header { background: #003366; color: white; padding: 20px; text-align: center; }
          .header h2 { margin: 0; font-size: 24px; }
          .header p { margin: 5px 0 0; opacity: 0.9; }
          .content { padding: 30px; background: #ffffff; }
          .greeting { font-size: 16px; margin-bottom: 20px; }
          .table-container { margin: 25px 0; border-radius: 6px; overflow: hidden; border: 1px solid #e0e0e0; }
          table { width: 100%; border-collapse: collapse; }
          td { padding: 12px 15px; border-bottom: 1px solid #e0e0e0; }
          tr:last-child td { border-bottom: none; }
          td:first-child { font-weight: 600; width: 35%; background: #f8f9fa; color: #495057; }
          td:last-child { background: #ffffff; }
          .note { background: #fff3cd; border: 1px solid #ffeeba; border-radius: 6px; padding: 18px; margin: 25px 0; color: #856404; }
          .note p { margin: 8px 0; }
          .note strong { color: #533f03; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 13px; border-top: 1px solid #e0e0e0; }
          .footer p { margin: 5px 0; }
          .badge { display: inline-block; background: #28a745; color: white; padding: 3px 8px; border-radius: 4px; font-size: 12px; margin-left: 8px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>🔧 Technician Visit Request</h2>
            <p>RV Solutions - Consumer Services</p>
          </div>
          <div class="content">
            <div class="greeting">
              <p>Hey <strong>${asc.asp_name}</strong>,</p>
              <p>Requesting a technician visit for alignment services for the customer mentioned below.</p>
            </div>
            
            <div class="table-container">
              <table>
                <tr><td>Job ID</td><td><strong>${jobNo}</strong> <span class="badge">New Request</span></td></tr>
                <tr><td>Service Type</td><td>${jobFor}</td></tr>
                <tr><td>Customer Name</td><td>${customerName}</td></tr>
                <tr><td>Contact No.</td><td><a href="tel:${contactNo}">${contactNo}</a></td></tr>
                <tr><td>Address</td><td>${address}</td></tr>
                <tr><td>Brand</td><td>${brand}</td></tr>
                <tr><td>Product</td><td>${product}</td></tr>
                <tr><td>Model</td><td>${model}</td></tr>
              </table>
            </div>
            
            <div class="note">
              <p><strong>📌 Important Instructions:</strong></p>
              <p>• <strong>Specialized Technician Required:</strong> Please deploy an experienced technician who specializes in <strong>${jobFor}</strong> for <strong>${product}</strong>.</p>
              <p>• Do not send technicians with expertise in other related products.</p>
              <p>• The technician represents the RV Solutions brand and must maintain a professional demeanor.</p>
              <p>• Carry valid ID card and company uniform.</p>
            </div>
            
            <p style="margin-top: 25px;">Thanks,<br>
            <strong>Consumer Services Team</strong><br>
            RV Solutions</p>
          </div>
          <div class="footer">
            <p>📧 This is an automated message from RV Solutions. Please do not reply to this email.</p>
            <p>🏢 RV Solutions - Consumer Services Division</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    console.log(`📧 Sending email to ${asc.sc_email_id} for job ${jobNo}`);
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent: ${info.messageId}`);
    
    // Update database
    await supabase
      .from('job_allocations')
      .update({ email_sent_status: true, email_sent_at: new Date() })
      .eq('job_no', jobNo);
    
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`❌ Email failed for job ${jobNo}:`, error.message);
    
    // Log failed email attempt
    await supabase
      .from('email_logs')
      .insert({
        job_no: jobNo,
        asc_email: asc.sc_email_id,
        error: error.message,
        attempted_at: new Date()
      });
    
    return { success: false, error: error.message };
  }
};

// Send batch emails for all allocated calls
const sendBatchEmails = async (allocatedCalls) => {
  const results = {
    total: allocatedCalls.length,
    successful: 0,
    failed: 0,
    details: []
  };

  // Default KAM email (you can make this dynamic based on brand/zone)
  const defaultKAM = 'kam@rvsolutions.com';
  
  for (const item of allocatedCalls) {
    const asc = item.allocated_asc;
    const kamEmail = defaultKAM; // You can customize this based on zone/region
    const asmEmail = asc.asm_email_id;
    
    const result = await sendAllocationEmail(item, asc, kamEmail, asmEmail);
    
    if (result.success) {
      results.successful++;
    } else {
      results.failed++;
    }
    
    results.details.push({
      jobNo: item['Job No.'],
      ascEmail: asc.sc_email_id,
      success: result.success,
      error: result.error
    });
    
    // Small delay to avoid rate limits (ZeptoMail allows high volume, but good practice)
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(`📊 Email Summary: ${results.successful}/${results.total} sent successfully`);
  if (results.failed > 0) {
    console.log(`❌ Failed: ${results.failed}`);
  }
  
  return results;
};

// Function to test email configuration
const testEmailConfig = async (testEmail) => {
  try {
    const testResult = await transporter.sendMail({
      from: 'Consumer Services <notifications@rvsolutions-notify.in>',
      to: testEmail || 'harpinder.singh@rvsolutions.in',
      subject: 'ZeptoMail Configuration Test',
      html: '<h3>✅ ZeptoMail is configured correctly!</h3><p>Your email service is ready to send allocation emails.</p>'
    });
    console.log('✅ Test email sent successfully');
    return { success: true, messageId: testResult.messageId };
  } catch (error) {
    console.error('❌ Test email failed:', error);
    return { success: false, error: error.message };
  }
};

// Send welcome email to new users
const sendWelcomeEmail = async (email, password, name) => {
  const mailOptions = {
    from: {
      name: 'RV Solutions Admin',
      address: 'notifications@rvsolutions-notify.in'
    },
    to: email,
    subject: 'Welcome to RV Solutions - Your Account Details',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Inter', sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #007AFF, #5856D6); color: white; padding: 30px; text-align: center; border-radius: 16px; }
          .content { padding: 30px; background: #f5f5f5; border-radius: 16px; margin-top: 20px; }
          .credentials { background: white; padding: 20px; border-radius: 12px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          .button { background: #007AFF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to RV Solutions!</h1>
            <p>Your account has been created</p>
          </div>
          
          <div class="content">
            <p>Hello <strong>${name}</strong>,</p>
            
            <p>An administrator has created an account for you on RV Solutions platform.</p>
            
            <div class="credentials">
              <h3>Your Login Credentials:</h3>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Password:</strong> ${password}</p>
              <p style="color: #FF3B30; font-size: 14px;">⚠️ Please change your password after first login</p>
            </div>
            
            <p>You can access the platform at:</p>
            <p><a href="http://localhost:3000" class="button">Login to RV Solutions</a></p>
            
            <p>For security reasons, we recommend:</p>
            <ul>
              <li>Change your password immediately after first login</li>
              <li>Never share your credentials with anyone</li>
              <li>Use a strong, unique password</li>
            </ul>
          </div>
          
          <div class="footer">
            <p>This is an automated message from RV Solutions. Please do not reply to this email.</p>
            <p>© 2026 RV Solutions. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Welcome email sent to ${email}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Failed to send welcome email:`, error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendAllocationEmail,
  sendBatchEmails,
  testEmailConfig,
  sendWelcomeEmail
};