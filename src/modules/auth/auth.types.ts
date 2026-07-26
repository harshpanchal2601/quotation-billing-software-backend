import type { UserRole, UserStatus } from '@prisma/client';

export type SanitisedUser = {
  id: number;
  name: string;
  email: string;
  username: string;
  role: UserRole;
  status: UserStatus;
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
