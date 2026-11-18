import { apiRequest } from "./httpClient";

export interface AuthResponseDto {
  accessToken: string;
  expiresAt: string;
  user: {
    id: string;
    displayName: string;
    email: string;
  };
}

export interface UserProfileDto {
  id: string;
  displayName: string;
  email: string;
}

export async function registerUser(
  displayName: string,
  email: string,
  password: string,
  inviteCode: string
): Promise<AuthResponseDto> {
  return apiRequest<AuthResponseDto>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ displayName, email, password, inviteCode }),
  });
}

export async function loginUser(
  email: string,
  password: string
): Promise<AuthResponseDto> {
  return apiRequest<AuthResponseDto>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function getCurrentUser(): Promise<UserProfileDto> {
  return apiRequest<UserProfileDto>("/api/auth/me", {
    method: "GET",
  });
}
