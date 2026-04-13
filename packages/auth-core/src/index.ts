export type AuthUser = {
  id: string;
  email: string | null;
  name: string | null;
};

export abstract class AuthService {
  /** Validate a session token. Returns the associated user or null if invalid/expired. */
  abstract validateSession(sessionToken: string): Promise<AuthUser | null>;
  abstract getUserById(id: string): Promise<AuthUser | null>;
}
