const supabase = require('./supabaseClient');
require('dotenv').config();

// ZeptoMail API configuration
const ZEPTO_API_URL = 'https://api.zeptomail.in/v1.1/email/template';
const ZEPTO_API_KEY = process.env.ZEPTOMAIL_PASSWORD; //

// Send email using ZeptoMail REST API
const sendEmailViaAPI = async (to, cc, subject, htmlContent) => {
  try {
    const payload = {
      "from": {
        "address": "notifications@rvsolutions-notify.in",
        "name": "Consumer Services - RV Solutions"
      },
      "to": to.map(email => ({ "email_address": { "address": email } })),
      "cc": cc.map(email => ({ "email_address": { "address": email } })),
      "subject": subject,
      "htmlbody": htmlContent
    };

    console.log('📧 Sending email via ZeptoMail API...');

    const response = await fetch(ZEPTO_API_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Zoho-enczapikey ${ZEPTO_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to send email');
    }

    console.log('✅ Email sent successfully:', data);
    return { success: true, data };
  } catch (error) {
    console.error('❌ Email API error:', error);
    return { success: false, error: error.message };
  }
};

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

  // Prepare email content
  const subject = `Reliance TV | RV Solutions – Technician Visit Request – Job ID ${jobNo}`;
  
  const htmlContent = `
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
  `;

  // Prepare recipient lists
  const toList = [asc.sc_email_id].filter(email => email && email.trim() !== '');
  const ccList = [kamEmail, asmEmail].filter(email => email && email.trim() !== '');

  if (toList.length === 0) {
    console.error('❌ No recipient email address provided');
    return { success: false, error: 'No recipient email' };
  }

  // Send email via API
  const result = await sendEmailViaAPI(toList, ccList, subject, htmlContent);

  if (result.success) {
    // Update database
    await supabase
      .from('job_allocations')
      .update({ email_sent_status: true, email_sent_at: new Date() })
      .eq('job_no', jobNo);
  } else {
    // Log failed email attempt
    await supabase
      .from('email_logs')
      .insert({
        job_no: jobNo,
        asc_email: asc.sc_email_id,
        error: result.error,
        attempted_at: new Date()
      });
  }

  return result;
};

// Send batch emails for all allocated calls
const sendBatchEmails = async (allocatedCalls) => {
  const results = {
    total: allocatedCalls.length,
    successful: 0,
    failed: 0,
    details: []
  };

  // Default KAM email
  const defaultKAM = 'kam@rvsolutions.com';
  
  for (const item of allocatedCalls) {
    const asc = item.allocated_asc;
    const kamEmail = defaultKAM;
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
    
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(`📊 Email Summary: ${results.successful}/${results.total} sent successfully`);
  if (results.failed > 0) {
    console.log(`❌ Failed: ${results.failed}`);
  }
  
  return results;
};

// Test email configuration
const testEmailConfig = async (testEmail) => {
  const subject = 'ZeptoMail Configuration Test';
  const htmlContent = '<h3>✅ ZeptoMail is configured correctly!</h3><p>Your email service is ready to send allocation emails.</p>';
  
  return await sendEmailViaAPI(
    [testEmail || 'harpinder.singh@rvsolutions.in'],
    [],
    subject,
    htmlContent
  );
};

// Send welcome email to new users
const sendWelcomeEmail = async (email, password, name) => {
  const subject = 'Welcome to RV Solutions - Your Account Details';
  
  const htmlContent = `
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
          <p><a href="https://callallocation-frontend.vercel.app" class="button">Login to RV Solutions</a></p>
          
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
  `;

  return await sendEmailViaAPI([email], [], subject, htmlContent);
};

module.exports = {
  sendAllocationEmail,
  sendBatchEmails,
  testEmailConfig,
  sendWelcomeEmail
};