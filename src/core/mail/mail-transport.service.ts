import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { AppError } from '../errors/AppError.js';

let cachedTransporter: nodemailer.Transporter | null = null;

export function getMailTransporter(): nodemailer.Transporter {
  if (!env.SMTP_HOST) {
    throw new AppError('Email service is not configured on this server.', 503);
  }

  if (cachedTransporter) {
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT || (env.SMTP_SECURE ? 465 : 587),
    secure: Boolean(env.SMTP_SECURE),
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? {
            user: env.SMTP_USER,
            pass: env.SMTP_PASSWORD,
          }
        : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  return cachedTransporter;
}

export function clearMailTransporterCache(): void {
  cachedTransporter = null;
}
