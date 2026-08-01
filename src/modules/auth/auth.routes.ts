import bcrypt from 'bcrypt';
import { AuditAction } from '@prisma/client';
import { Router, type Request, type Response } from 'express';

import { env } from '../../config/env.js';
import { AppError } from '../../core/errors/AppError.js';
import { sendSuccess } from '../../core/http/apiResponse.js';
import { asyncHandler } from '../../core/http/asyncHandler.js';
import {
	AUTHENTICATION_REQUIRED_MESSAGE,
	INVALID_CREDENTIALS_MESSAGE,
	REFRESH_TOKEN_COOKIE_NAME,
} from './auth.constants.js';
import { assertActiveUser, sanitiseUser } from './auth.helpers.js';
import { authRepository } from './auth.repository.js';
import { changePasswordSchema, loginSchema } from './auth.schema.js';
import { clearAuthCookies, setAuthCookies } from './security/auth.cookies.js';
import {
	durationToMilliseconds,
	generateAccessToken,
	generateRefreshToken,
	hashRefreshToken,
	verifyRefreshToken,
} from './security/auth.tokens.js';
import { loginRateLimiter } from './security/auth.rate-limit.js';
import { requireAuthentication } from './auth.middleware.js';

export { authRepository } from './auth.repository.js';

export const authRouter = Router();

function getMetadata(req: Request) {
	return {
		ipAddress: req.ip,
		userAgent: req.get('user-agent'),
	};
}

export async function login(req: Request, res: Response) {
	const input = loginSchema.parse(req.body);
	const metadata = getMetadata(req);
	const identifier = input.identifier.trim().toLowerCase();
	const user = await authRepository.findUserByIdentifier(identifier);

	if (user === null) {
		throw new AppError(INVALID_CREDENTIALS_MESSAGE, 401);
	}

	assertActiveUser(user);

	const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);

	if (!passwordMatches) {
		throw new AppError(INVALID_CREDENTIALS_MESSAGE, 401);
	}

	const expiresAt = new Date(Date.now() + durationToMilliseconds(env.JWT_REFRESH_EXPIRES_IN));
	const session = await authRepository.createSession(user.id, expiresAt, metadata.ipAddress, metadata.userAgent);
	const tokens = {
		accessToken: generateAccessToken({ userId: user.id, role: user.role, sessionId: session.id }),
		refreshToken: generateRefreshToken({ userId: user.id, sessionId: session.id }),
	};

	await authRepository.updateSessionRefreshTokenHash(session.id, hashRefreshToken(tokens.refreshToken), expiresAt);
	await authRepository.updateLastLoginAt(user.id);
	await authRepository.createAuditLog(user.id, AuditAction.LOGIN, metadata);

	setAuthCookies(res, tokens);

	return sendSuccess(res, 200, 'Login successful', {
		user: sanitiseUser(user),
	});
}

export async function refresh(req: Request, res: Response) {
	const refreshToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME] as string | undefined;

	if (refreshToken === undefined) {
		throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
	}

	const payload = verifyRefreshToken(refreshToken);
	const session = await authRepository.findSessionWithUserById(payload.sessionId);

	if (
		session === null ||
		session.revokedAt !== null ||
		session.expiresAt.getTime() <= Date.now() ||
		session.userId !== Number(payload.sub)
	) {
		throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
	}

	assertActiveUser(session.user);

	if (session.refreshTokenHash !== hashRefreshToken(refreshToken)) {
		throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
	}

	const tokens = {
		accessToken: generateAccessToken({ userId: session.user.id, role: session.user.role, sessionId: session.id }),
		refreshToken: generateRefreshToken({ userId: session.user.id, sessionId: session.id }),
	};

	await authRepository.updateSessionRefreshTokenHash(
		session.id,
		hashRefreshToken(tokens.refreshToken),
		new Date(Date.now() + durationToMilliseconds(env.JWT_REFRESH_EXPIRES_IN)),
	);

	setAuthCookies(res, tokens);

	return sendSuccess(res, 200, 'Token refreshed successfully', {
		user: sanitiseUser(session.user),
	});
}

export async function logout(req: Request, res: Response) {
	const refreshToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME] as string | undefined;
	const metadata = getMetadata(req);

	if (refreshToken !== undefined) {
		try {
			const payload = verifyRefreshToken(refreshToken);
			const session = await authRepository.findSessionWithUserById(payload.sessionId);

			if (session !== null && session.userId === Number(payload.sub)) {
				await authRepository.revokeSession(session.id);
				await authRepository.createAuditLog(session.userId, AuditAction.LOGOUT, metadata);
			}
		} catch {
			// Preserve logout idempotency.
		}
	}

	clearAuthCookies(res);

	return sendSuccess(res, 200, 'Logout successful', null);
}

export async function me(req: Request, res: Response) {
	if (req.user === undefined) {
		throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
	}

	return sendSuccess(res, 200, 'Authenticated user retrieved', {
		user: req.user,
	});
}

export async function changePassword(req: Request, res: Response) {
	const input = changePasswordSchema.parse(req.body);
	const metadata = getMetadata(req);

	if (req.user === undefined) {
		throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
	}

	const user = await authRepository.findUserById(req.user.id);

	if (user === null) {
		throw new AppError(AUTHENTICATION_REQUIRED_MESSAGE, 401);
	}

	assertActiveUser(user);

	const currentPasswordMatches = await bcrypt.compare(input.currentPassword, user.passwordHash);

	if (!currentPasswordMatches) {
		throw new AppError('Current password is incorrect', 401);
	}

	const samePassword = await bcrypt.compare(input.newPassword, user.passwordHash);

	if (samePassword) {
		throw new AppError('New password must be different from the current password', 400);
	}

	const passwordHash = await bcrypt.hash(input.newPassword, env.BCRYPT_SALT_ROUNDS);

	await authRepository.updatePassword(user.id, passwordHash);
	await authRepository.revokeActiveSessions(user.id);
	await authRepository.createAuditLog(user.id, AuditAction.PASSWORD_CHANGE, metadata);
	clearAuthCookies(res);

	return sendSuccess(res, 200, 'Password changed successfully. Please log in again.', null);
}

authRouter.post('/login', loginRateLimiter, asyncHandler(login));
authRouter.post('/refresh', asyncHandler(refresh));
authRouter.post('/logout', asyncHandler(logout));
authRouter.get('/me', requireAuthentication, asyncHandler(me));
authRouter.post('/change-password', requireAuthentication, asyncHandler(changePassword));
