// Dashboard password. Env may name the pair; otherwise non-production uses operator/operator.
// That fallback is not an env-schema default.
import crypto from 'node:crypto';
import type { Config } from '../../config/load.ts';
import { fail } from '../../shared/errors.ts';

const LOGIN_ID = /^[a-z0-9._-]{2,64}$/;
const DEV_LOGIN = 'operator';
const DEV_PASSWORD = 'operator';

export interface DashboardAuthConfig { env: Config['env']; dashboard: Config['dashboard'] }

export function passwordsMatch(given: string, expected: string): boolean {
  const left = Buffer.from(given, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Both env values, or the non-production fallback. Production with either unset is unconfigured. */
export function dashboardCredentials(config: DashboardAuthConfig): { login: string; password: string } | null {
  const { login, password } = config.dashboard;
  if (login && password) return { login, password };
  if (config.env === 'production') return null;
  return { login: DEV_LOGIN, password: DEV_PASSWORD };
}

/** The session account (the login string), or 401 / 403. */
export function authenticateDashboard(config: DashboardAuthConfig, login: string, password: string): string {
  const creds = dashboardCredentials(config);
  if (!creds) fail('FORBIDDEN', 'Dashboard login is not configured');
  const loginOk = LOGIN_ID.test(login) && login === creds.login;
  const passwordOk = passwordsMatch(password, creds.password);
  if (!loginOk || !passwordOk) fail('UNAUTHORIZED', 'Sign in failed');
  return creds.login;
}
