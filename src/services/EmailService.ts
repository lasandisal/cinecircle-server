import nodemailer, { Transporter } from 'nodemailer';
import { ENV } from '../config/env';

export class EmailService {
  private static transporter: Transporter | null = null;

  /**
   * Get or initialize Nodemailer transporter configured for Brevo SMTP
   */
  private static getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: ENV.BREVO_SMTP_HOST,
        port: ENV.BREVO_SMTP_PORT,
        secure: ENV.BREVO_SMTP_PORT === 465,
        auth: {
          user: ENV.BREVO_SMTP_LOGIN,
          pass: ENV.BREVO_SMTP_KEY,
        },
        tls: {
          rejectUnauthorized: false,
        },
      });
    }
    return this.transporter;
  }

  /**
   * Send a branded OTP verification email
   */
  public static async sendVerificationOtp(
    recipientEmail: string,
    otp: string,
    type: 'register' | 'login' | 'reset' = 'register'
  ): Promise<{ success: boolean; devCode?: string; error?: string }> {
    const actionText =
      type === 'register'
        ? 'Complete your CineCircle registration'
        : type === 'login'
        ? 'Sign in to your CineCircle account'
        : 'Reset your CineCircle password';

    const subject =
      type === 'register'
        ? `CineCircle Verification Code: ${otp}`
        : `Your CineCircle Sign-In Code: ${otp}`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f1f5f9;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0b0f19; padding: 40px 15px;">
          <tr>
            <td align="center">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 500px; background-color: #111827; border-radius: 20px; border: 1px solid #1f2937; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);">
                <!-- Brand Header -->
                <tr>
                  <td style="padding: 35px 30px 20px; text-align: center; background: linear-gradient(180deg, rgba(139, 92, 246, 0.15) 0%, rgba(17, 24, 39, 0) 100%);">
                    <div style="display: inline-block; padding: 12px; border-radius: 16px; background-color: #1e1b4b; border: 1px solid #4338ca; margin-bottom: 12px;">
                      <span style="font-size: 28px;">🎬</span>
                    </div>
                    <h1 style="margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff;">
                      Cine<span style="color: #a78bfa;">Circle</span>
                    </h1>
                    <p style="margin: 6px 0 0; font-size: 13px; color: #94a3b8; font-weight: 500;">
                      Social Streaming & Watch Decisions
                    </p>
                  </td>
                </tr>

                <!-- Content Body -->
                <tr>
                  <td style="padding: 10px 35px 30px; text-align: center;">
                    <h2 style="margin: 0 0 10px; font-size: 18px; font-weight: 600; color: #f8fafc;">
                      ${actionText}
                    </h2>
                    <p style="margin: 0 0 25px; font-size: 14px; line-height: 1.6; color: #94a3b8;">
                      Use the 6-digit verification code below to verify your email address and continue:
                    </p>

                    <!-- OTP Code Badge -->
                    <div style="background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%); border: 1px solid #6366f1; border-radius: 14px; padding: 18px; margin: 0 auto 25px; display: inline-block;">
                      <span style="font-family: 'Courier New', monospace; font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #38bdf8; text-shadow: 0 0 15px rgba(56, 189, 248, 0.4);">
                        ${otp}
                      </span>
                    </div>

                    <p style="margin: 0; font-size: 13px; color: #cbd5e1;">
                      ⏱️ This code will expire in <strong style="color: #f1f5f9;">10 minutes</strong>.
                    </p>
                    <p style="margin: 10px 0 0; font-size: 12px; color: #64748b;">
                      If you did not request this verification code, please ignore this email.
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 20px 30px; text-align: center; border-top: 1px solid #1f2937; background-color: #0b0f19;">
                    <p style="margin: 0; font-size: 11px; color: #475569;">
                      Sent automatically by CineCircle Platform &bull; ${ENV.BREVO_SENDER_EMAIL}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({
        from: `"${ENV.BREVO_SENDER_NAME}" <${ENV.BREVO_SENDER_EMAIL}>`,
        to: recipientEmail,
        subject,
        text: `Your CineCircle verification code is: ${otp}. It expires in 10 minutes.`,
        html: htmlContent,
      });

      console.log(`[EmailService] OTP email sent successfully to ${recipientEmail}. Message ID: ${info.messageId}`);
      return { success: true };
    } catch (err: any) {
      console.warn(`[EmailService] SMTP error sending to ${recipientEmail}:`, err.message);

      // If development mode, log OTP for seamless testing
      if (ENV.NODE_ENV !== 'production') {
        console.log(`\n==================================================`);
        console.log(`[EmailService DEV BYPASS] For testing/dev:`);
        console.log(`Email: ${recipientEmail}`);
        console.log(`OTP Code: ${otp}`);
        console.log(`==================================================\n`);
        return { success: true, devCode: otp };
      }

      return { success: false, error: err.message };
    }
  }
}
