import nodemailer from 'nodemailer';
import { logger } from './logger';

// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

// Verify transporter connection
transporter.verify((error) => {
  if (error) {
    logger.error('SMTP connection error:', error);
  } else {
    logger.info('✉️  SMTP server is ready to send emails');
  }
});

interface SendQREmailOptions {
  to: string;
  name: string;
  traineeId: string;
  qrCode: string; // Base64 QR code
  department: string;
  foodPreference: string;
  eventName?: string;
}

export const sendQRCodeEmail = async (options: SendQREmailOptions): Promise<boolean> => {
  const { to, name, traineeId, qrCode, department, foodPreference, eventName = 'Cricket Fiesta 2025' } = options;

  // Extract base64 data from data URL
  const base64Data = qrCode.replace(/^data:image\/png;base64,/, '');

  const mailOptions = {
    from: `"${eventName}" <${process.env.SMTP_USER}>`,
    to,
    subject: `🍽️ Your Food QR Code - ${eventName}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Food QR Code</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f4f4;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 40px 0;">
              <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                <!-- Header -->
                <tr>
                  <td style="padding: 40px 40px 20px 40px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px 12px 0 0;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">🏏 ${eventName}</h1>
                    <p style="margin: 10px 0 0 0; color: rgba(255, 255, 255, 0.9); font-size: 16px;">Food Distribution QR Code</p>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px;">
                    <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px;">Hello <strong>${name}</strong>,</p>
                    <p style="margin: 0 0 30px 0; color: #666666; font-size: 14px; line-height: 1.6;">
                      Your food QR code for the event is ready! Please present this QR code at the food counter to collect your meal.
                    </p>
                    
                    <!-- QR Code -->
                    <div style="text-align: center; padding: 30px; background-color: #f8f9fa; border-radius: 12px; margin-bottom: 30px;">
                      <img src="cid:qrcode" alt="QR Code" style="width: 200px; height: 200px; border: 4px solid #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);" />
                      <p style="margin: 15px 0 0 0; color: #888888; font-size: 12px;">Scan this QR code at the food counter</p>
                    </div>
                    
                    <!-- Details -->
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
                      <tr>
                        <td style="padding: 12px 16px; background-color: #f8f9fa; border-radius: 8px 8px 0 0;">
                          <span style="color: #888888; font-size: 12px; text-transform: uppercase;">Trainee ID</span>
                          <p style="margin: 4px 0 0 0; color: #333333; font-size: 16px; font-weight: 600;">${traineeId}</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 12px 16px; background-color: #ffffff; border: 1px solid #f0f0f0;">
                          <span style="color: #888888; font-size: 12px; text-transform: uppercase;">Department</span>
                          <p style="margin: 4px 0 0 0; color: #333333; font-size: 16px;">${department}</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 12px 16px; background-color: #f8f9fa; border-radius: 0 0 8px 8px;">
                          <span style="color: #888888; font-size: 12px; text-transform: uppercase;">Food Preference</span>
                          <p style="margin: 4px 0 0 0; color: #333333; font-size: 16px;">
                            <span style="display: inline-block; padding: 4px 12px; background-color: ${foodPreference === 'VEGETARIAN' ? '#dcfce7' : '#fef3c7'}; color: ${foodPreference === 'VEGETARIAN' ? '#166534' : '#92400e'}; border-radius: 20px; font-size: 14px;">
                              ${foodPreference === 'VEGETARIAN' ? 'Vegetarian' : 'Non-Vegetarian'}
                            </span>
                          </p>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Instructions -->
                    <div style="padding: 20px; background-color: #fef3c7; border-radius: 8px; border-left: 4px solid #f59e0b;">
                      <p style="margin: 0; color: #92400e; font-size: 14px; font-weight: 600;">Important Instructions:</p>
                      <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #92400e; font-size: 13px; line-height: 1.8;">
                        <li>Keep this QR code safe - it can only be used once</li>
                        <li>Show this email or screenshot at the food counter</li>
                        <li>Contact the organizing committee if you face any issues</li>
                      </ul>
                    </div>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="padding: 30px 40px; text-align: center; background-color: #f8f9fa; border-radius: 0 0 12px 12px;">
                    <p style="margin: 0; color: #888888; font-size: 12px;">
                      This is an automated email from ${eventName} Management System.
                    </p>
                    <p style="margin: 10px 0 0 0; color: #aaaaaa; font-size: 11px;">
                      © 2025 SLT-Mobitel. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    attachments: [
      {
        filename: 'qrcode.png',
        content: base64Data,
        encoding: 'base64',
        cid: 'qrcode', // Content ID referenced in the HTML
      },
    ],
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`QR code email sent successfully to ${to}`);
    return true;
  } catch (error) {
    logger.error(`Failed to send QR code email to ${to}:`, error);
    throw error;
  }
};

export default transporter;
