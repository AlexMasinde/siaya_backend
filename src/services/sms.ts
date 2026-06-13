import axios from 'axios';
import { env } from '../config/env';
import logger from '../config/logger';
import { parseKenyanMobile } from '../utils/kenyanPhone';

class SmsService {
  private username: string;
  private password: string;
  private source: string;

  constructor() {
    this.username = env.SMS_LEOPARD_USERNAME;
    this.password = env.SMS_LEOPARD_PASSWORD;
    this.source = env.SMS_LEOPARD_SOURCE;
  }

  normalizePhoneNumber(phoneNumber: string): string | { error: string } {
    const parsed = parseKenyanMobile(phoneNumber);
    if (!parsed.ok) {
      return { error: parsed.error };
    }
    return parsed.international;
  }

  private sanitizePhoneNumber(phoneNumber: string): string | { error: string } {
    return this.normalizePhoneNumber(phoneNumber);
  }

  private async sendMessage(phoneNumber: string, message: string): Promise<boolean> {
    try {
      const sanitized = this.sanitizePhoneNumber(phoneNumber);

      if (typeof sanitized === 'object' && 'error' in sanitized) {
        logger.error('Invalid phone number for SMS:', { phoneNumber, error: sanitized.error });
        return false;
      }

      const url = `https://api.smsleopard.com/v1/sms/send?message=${encodeURIComponent(message)}&source=${this.source}&username=${this.username}&password=${encodeURIComponent(this.password)}&destination=${sanitized}`;

      await axios.get(url);

      logger.info('SMS sent successfully', { phoneNumber: sanitized });
      return true;
    } catch (error) {
      logger.error('Error sending SMS:', {
        error: error instanceof Error ? error.message : String(error),
        phoneNumber,
      });
      return false;
    }
  }

  async sendUserCredentials(phoneNumber: string, email: string, password: string): Promise<boolean> {
    const message = `Welcome to UDA Events! Your account has been created.\nEmail: ${email}\nPassword: ${password}`;
    return this.sendMessage(phoneNumber, message);
  }

  async sendPasswordReset(phoneNumber: string, email: string, password: string): Promise<boolean> {
    const message = `UDA Events password reset.\nEmail: ${email}\nNew password: ${password}`;
    return this.sendMessage(phoneNumber, message);
  }
}

export const smsService = new SmsService();
