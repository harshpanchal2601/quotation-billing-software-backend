import { z } from 'zod';
import { AppError } from '../../../core/errors/AppError.js';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const sendQuotationEmailSchema = z
  .object({
    generatedDocumentId: z.number().int().positive({ message: 'Valid generated document ID is required' }),
    to: z
      .array(z.string().trim().toLowerCase())
      .min(1, { message: 'At least one primary recipient (To) is required' })
      .max(10, { message: 'Maximum 10 primary recipients allowed' })
      .refine((emails) => emails.every((e) => emailRegex.test(e)), {
        message: 'One or more primary recipient email addresses are invalid',
      }),
    cc: z
      .array(z.string().trim().toLowerCase())
      .max(10, { message: 'Maximum 10 CC recipients allowed' })
      .optional()
      .default([]),
    bcc: z
      .array(z.string().trim().toLowerCase())
      .max(10, { message: 'Maximum 10 BCC recipients allowed' })
      .optional()
      .default([]),
    subject: z
      .string()
      .trim()
      .min(1, { message: 'Subject is required' })
      .max(200, { message: 'Subject cannot exceed 200 characters' })
      .refine((val) => !/[\r\n]/.test(val), {
        message: 'Subject cannot contain newline or carriage return characters',
      }),
    message: z
      .string()
      .trim()
      .min(1, { message: 'Message body is required' })
      .max(10000, { message: 'Message body cannot exceed 10,000 characters' }),
    attachmentIds: z
      .array(z.number().int().positive())
      .max(10, { message: 'Maximum 10 attachments can be selected' })
      .optional()
      .default([]),
  })
  .superRefine((data, ctx) => {
    // Validate email formatting in cc and bcc
    for (const email of data.cc) {
      if (!emailRegex.test(email)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid CC email address: "${email}"`,
          path: ['cc'],
        });
      }
    }
    for (const email of data.bcc) {
      if (!emailRegex.test(email)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid BCC email address: "${email}"`,
          path: ['bcc'],
        });
      }
    }

    // Deduplicate and total recipient cap
    const uniqueRecipients = new Set([...data.to, ...data.cc, ...data.bcc]);
    if (uniqueRecipients.size > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Total unique email recipients across To, CC, and BCC cannot exceed 20',
        path: ['to'],
      });
    }
  });

export function validateSendQuotationEmailInput(input: unknown) {
  const result = sendQuotationEmailSchema.safeParse(input);
  if (!result.success) {
    const firstMessage = result.error.issues[0]?.message || 'Invalid email request data';
    throw new AppError(firstMessage, 400);
  }
  return result.data;
}
