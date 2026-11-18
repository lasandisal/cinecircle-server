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
        requireTLS: ENV.BREVO_SMTP_PORT === 587,
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

    const subject = `${otp} is your CineCircle verification code`;

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
        replyTo: ENV.BREVO_SENDER_EMAIL,
        subject,
        text: `Your CineCircle verification code is: ${otp}. It expires in 10 minutes.`,
        html: htmlContent,
        headers: {
          'X-Entity-Ref-ID': `${Date.now()}-${otp}`,
          'X-Priority': '1',
          'Importance': 'high',
          'Auto-Submitted': 'auto-generated',
        },
      });

      console.log(`\n==================================================`);
      console.log(`[EmailService] OTP email sent successfully to ${recipientEmail}`);
      console.log(`[EmailService] 6-digit Code: ${otp}`);
      console.log(`[EmailService] Message ID: ${info.messageId}`);
      console.log(`==================================================\n`);

      return {
        success: true,
        devCode: ENV.NODE_ENV !== 'production' ? otp : undefined,
      };
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

  /**
   * Send Welcome & Quick-Start email (1-time on signup right after email verification)
   * Kept under 100 words with 3 quick actionable steps.
   */
  public static async sendWelcomeEmail(
    recipientEmail: string,
    userName: string
  ): Promise<{ success: boolean; error?: string }> {
    const firstName = userName ? userName.trim().split(' ')[0] : 'there';
    const subject = `Welcome to CineCircle, ${firstName}! 🎬 3 steps to start`;
    const appUrl = ENV.CLIENT_URL || 'http://localhost:5173';

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
                  <td style="padding: 35px 30px 15px; text-align: center; background: linear-gradient(180deg, rgba(139, 92, 246, 0.15) 0%, rgba(17, 24, 39, 0) 100%);">
                    <div style="display: inline-block; padding: 12px; border-radius: 16px; background-color: #1e1b4b; border: 1px solid #4338ca; margin-bottom: 12px;">
                      <span style="font-size: 28px;">🎬</span>
                    </div>
                    <h1 style="margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff;">
                      Welcome to Cine<span style="color: #a78bfa;">Circle</span>!
                    </h1>
                    <p style="margin: 6px 0 0; font-size: 13px; color: #94a3b8; font-weight: 500;">
                      Say goodbye to scrolling paralysis.
                    </p>
                  </td>
                </tr>

                <!-- Content Body -->
                <tr>
                  <td style="padding: 15px 35px 30px;">
                    <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                      Hi <strong style="color: #ffffff;">${firstName}</strong>, your account is verified. Here are 3 quick steps to get the most out of CineCircle tonight:
                    </p>

                    <!-- 3 Steps -->
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 25px;">
                      <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #1e293b;">
                          <span style="font-size: 16px;">⭐</span>
                          <strong style="color: #f8fafc; font-size: 13px; margin-left: 8px;">Rate 3 movies</strong>
                          <div style="font-size: 12px; color: #94a3b8; margin-top: 2px; padding-left: 27px;">
                            Calibrates your solo recommendation algorithm.
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid #1e293b;">
                          <span style="font-size: 16px;">📺</span>
                          <strong style="color: #f8fafc; font-size: 13px; margin-left: 8px;">Pick your streaming subscriptions</strong>
                          <div style="font-size: 12px; color: #94a3b8; margin-top: 2px; padding-left: 27px;">
                            See only what you can actually stream (Netflix, Prime, Max, etc.).
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0;">
                          <span style="font-size: 16px;">👥</span>
                          <strong style="color: #f8fafc; font-size: 13px; margin-left: 8px;">Share a circle room code</strong>
                          <div style="font-size: 12px; color: #94a3b8; margin-top: 2px; padding-left: 27px;">
                            Decide tonight's movie together with friends without arguing.
                          </div>
                        </td>
                      </tr>
                    </table>

                    <!-- CTA Button -->
                    <div style="text-align: center; margin-top: 20px;">
                      <a href="${appUrl}" style="display: inline-block; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 700; padding: 12px 28px; border-radius: 12px; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);">
                        Get Started
                      </a>
                    </div>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 20px 30px; text-align: center; border-top: 1px solid #1f2937; background-color: #0b0f19;">
                    <p style="margin: 0; font-size: 11px; color: #64748b;">
                      Sent automatically to ${recipientEmail} upon verification &bull; CineCircle
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

    const textContent = `
Welcome to CineCircle, ${firstName}!

Say goodbye to scrolling paralysis. Here are 3 quick steps to get started:
1. Rate 3 movies — calibrates your solo recommendation algorithm.
2. Pick your streaming subscriptions — see only what you can stream (Netflix, Prime, Max, etc.).
3. Share your room code — decide tonight's movie together with friends.

Get started: ${appUrl}
    `.trim();

    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({
        from: `"${ENV.BREVO_SENDER_NAME}" <${ENV.BREVO_SENDER_EMAIL}>`,
        to: recipientEmail,
        replyTo: ENV.BREVO_SENDER_EMAIL,
        subject,
        text: textContent,
        html: htmlContent,
        headers: {
          'X-Entity-Ref-ID': `welcome-${Date.now()}-${recipientEmail}`,
          'Auto-Submitted': 'auto-generated',
        },
      });

      console.log(`[EmailService] Welcome email sent to ${recipientEmail} (msgId: ${info.messageId})`);
      return { success: true };
    } catch (err: any) {
      console.warn(`[EmailService] Failed to send welcome email to ${recipientEmail}:`, err.message);
      return { success: false, error: err.message };
    }
  }
}
