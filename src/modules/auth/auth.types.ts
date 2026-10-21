import type { AccountType, UserRole, UserStatus } from '@prisma/client';

import type { Permission } from './permissions.js';

export type SanitisedUser = {
  id: number;
  name: string;
  email: string;
  username: string;
  role: UserRole;
  accountType: AccountType;
  status: UserStatus;
  firmId: number | null;
  firm: { id: number; name: string; slug: string } | null;
  firmRole: { id: number; name: string } | null;
  permissions: Permission[];
  mustChangePassword: boolean;
};

export type AccessTokenPayload = {
  sub: string;
  role: UserRole;
  sessionId: number;
  iat: number;
};

export type RefreshTokenPayload = {
  sub: string;
  sessionId: number;
  tokenType: 'refresh';
  jti: string;
  iat: number;
};

export type AuthenticatedRequestUser = SanitisedUser & {
  sessionId: number;
};
