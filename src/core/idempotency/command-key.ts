import { z } from 'zod';

export const commandKeySchema = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
