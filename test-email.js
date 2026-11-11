// Test email configuration
require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

console.log('Testing email configuration...');
console.log('EMAIL_USER:', process.env.EMAIL_USER);
console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? '***' + process.env.EMAIL_PASS.slice(-4) : 'NOT SET');
console.log('ADMIN_EMAIL:', process.env.ADMIN_EMAIL || 'NOT SET (will use EMAIL_USER)');
console.log('PARTNER_EMAIL:', process.env.PARTNER_EMAIL || 'NOT SET');

async function testEmail() {
  try {
    // Verify transporter
    await transporter.verify();
    console.log('\n✅ SMTP connection verified successfully!');
    
    // Send test email
    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
      subject: '🧪 NIVA Test Email - Email System Working!',
      html: `
        <h2>Email Test Successful! ✅</h2>
        <p>This confirms that your NIVA email notification system is configured correctly.</p>
        <p>Time: ${new Date().toLocaleString('en-IN')}</p>
      `
    });
    
    console.log('✅ Test email sent successfully!');
    console.log('   Message ID:', info.messageId);
    console.log('\n📧 Check inbox of:', process.env.ADMIN_EMAIL || process.env.EMAIL_USER);
    
  } catch (error) {
    console.error('\n❌ Email test failed!');
    console.error('   Error:', error.message);
    
    if (error.code === 'EAUTH') {
      console.error('\n⚠️  AUTHENTICATION FAILED');
      console.error('   This usually means:');
      console.error('   1. The Gmail App Password is incorrect or expired');
      console.error('   2. 2-Factor Authentication is not enabled on the Gmail account');
      console.error('   3. "Less secure app access" is not enabled');
      console.error('\n📋 To fix:');
      console.error('   1. Go to https://myaccount.google.com/security');
      console.error('   2. Enable 2-Step Verification');
      console.error('   3. Go to https://myaccount.google.com/apppasswords');
      console.error('   4. Create a new App Password for "Mail" on "Windows Computer"');
      console.error('   5. Update EMAIL_PASS in .env with the new 16-character password');
    }
  }
}

testEmail();
