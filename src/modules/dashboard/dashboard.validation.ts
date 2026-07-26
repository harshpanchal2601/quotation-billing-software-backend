import { z } from 'zod';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const dashboardOverviewQuerySchema = z
  .object({
    period: z
      .enum(['CURRENT_FINANCIAL_YEAR', 'LAST_30_DAYS', 'LAST_90_DAYS', 'CURRENT_CALENDAR_YEAR', 'CUSTOM'])
      .optional()
      .default('CURRENT_FINANCIAL_YEAR'),
    dateFrom: z.string().regex(dateRegex, 'Invalid dateFrom format (expected YYYY-MM-DD)').optional(),
    dateTo: z.string().regex(dateRegex, 'Invalid dateTo format (expected YYYY-MM-DD)').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.period === 'CUSTOM') {
      if (!data.dateFrom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Custom dashboard period requires dateFrom',
          path: ['dateFrom'],
        });
      }
      if (!data.dateTo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Custom dashboard period requires dateTo',
          path: ['dateTo'],
        });
      }
      if (data.dateFrom && data.dateTo) {
        const fromDate = new Date(data.dateFrom);
        const toDate = new Date(data.dateTo);

        if (Number.isNaN(fromDate.getTime())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Invalid dateFrom value',
            path: ['dateFrom'],
          });
        }
        if (Number.isNaN(toDate.getTime())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Invalid dateTo value',
            path: ['dateTo'],
          });
        }

        if (fromDate > toDate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Dashboard dateFrom cannot be after dateTo',
            path: ['dateFrom'],
          });
        }

        // Limit range to max 24 months
        const diffMonths = (toDate.getFullYear() - fromDate.getFullYear()) * 12 + (toDate.getMonth() - fromDate.getMonth());
        if (diffMonths > 24) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Dashboard date range cannot exceed 24 months',
            path: ['dateTo'],
          });
        }
      }
    }
  });
