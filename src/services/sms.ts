import axios from 'axios';
import { env } from '../config/env';
import logger from '../config/logger';

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
    let formattedMobileNumber = String(phoneNumber).trim().replace(/^\+/, '');

    if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(formattedMobileNumber)) {
      formattedMobileNumber = String(Math.round(Number(formattedMobileNumber)));
    } else if (formattedMobileNumber.includes('.') && !formattedMobileNumber.includes('e')) {
      formattedMobileNumber = formattedMobileNumber.split('.')[0];
    }

    formattedMobileNumber = formattedMobileNumber.replace(/\s+/g, '');

    if (/^[17]\d{8}$/.test(formattedMobileNumber)) {
      formattedMobileNumber = `0${formattedMobileNumber}`;
    }

    if (!formattedMobileNumber.startsWith('254')) {
      formattedMobileNumber = '254' + formattedMobileNumber.replace(/^0+/, '');
    }

    const valid = /^254[71]\d{8}$/.test(formattedMobileNumber);

    if (!valid) {
      return { error: 'Invalid phone number' };
    }

    return formattedMobileNumber;
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
