import type { UserRow } from './services/users';

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 503,
    message: string,
  ) {
    super(message);
  }
}

export type AppEnv = { Variables: { user: UserRow } };
