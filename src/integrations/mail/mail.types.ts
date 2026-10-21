export type MailAddressInput = string | string[];

export type MailAttachment = {
  filename?: string;
  path?: string;
  contentType?: string;
  [key: string]: unknown;
};

export type SendMailInput = {
  from?: string;
  to: MailAddressInput;
  cc?: MailAddressInput;
  bcc?: MailAddressInput;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  attachments?: MailAttachment[];
};

export type SendMailResult = {
  messageId: string | null;
  accepted: string[];
  rejected: string[];
  response: unknown;
};
