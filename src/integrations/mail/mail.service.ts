import nodemailer, { type SentMessageInfo, type Transporter } from 'nodemailer';

import { mailConfig } from '../../config/mail.config.js';
import { AppError } from '../../core/errors/AppError.js';
import type { SendMailInput, SendMailResult } from './mail.types.js';

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!mailConfig.smtpHost) {
    throw new AppError('Email service is not configured on this server.', 503);
  }

  if (cachedTransporter) {
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    host: mailConfig.smtpHost,
    port: mailConfig.smtpPort ?? (mailConfig.smtpSecure ? 465 : 587),
    secure: Boolean(mailConfig.smtpSecure),
    auth:
      mailConfig.smtpUser && mailConfig.smtpPassword
        ? {
            user: mailConfig.smtpUser,
            pass: mailConfig.smtpPassword,
          }
        : undefined,
    connectionTimeout: mailConfig.connectionTimeoutMs,
    greetingTimeout: mailConfig.greetingTimeoutMs,
    socketTimeout: mailConfig.socketTimeoutMs,
  });

  return cachedTransporter;
}

function normaliseRecipients(value: SentMessageInfo['accepted'] | SentMessageInfo['rejected']) {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function formatDefaultSender() {
  if (mailConfig.fromName && mailConfig.fromEmail) {
    return `"${mailConfig.fromName}" <${mailConfig.fromEmail}>`;
  }

  return mailConfig.fromEmail ?? 'noreply@example.com';
}

export const mailService = {
  async send(input: SendMailInput): Promise<SendMailResult> {
    const result = await getTransporter().sendMail({
      from: input.from ?? formatDefaultSender(),
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.text,
      html: input.html,
      replyTo: input.replyTo,
      attachments: input.attachments,
    });

    return {
      messageId: typeof result.messageId === 'string' && result.messageId.trim().length > 0 ? result.messageId : null,
      accepted: normaliseRecipients(result.accepted),
      rejected: normaliseRecipients(result.rejected),
      response: result.response,
    };
  },
};
