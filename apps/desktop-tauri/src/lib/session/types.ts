export interface SessionInfo {
  loggedIn: boolean;
  email?: string | null;
}

export interface AuthResponse {
  user: { email: string };
  accessToken: string;
  refreshToken?: string | null;
}
