import { useDesktopSettingsStore } from "../../stores/desktopSettingsStore";

export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function getApiBaseUrl(): string {
  const { serverUrl } = useDesktopSettingsStore.getState().settings;
  return serverUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api(\/.*)?$/i, "");
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const token = useDesktopSettingsStore.getState().settings.authSession?.accessToken;

  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    let errorCode: string | undefined;
    try {
      const payload = (await response.json()) as {
        message?: string;
        error?: string;
        code?: string;
      };
      errorMessage = payload.message || payload.error || errorMessage;
      errorCode = payload.code;
    } catch {
      // Ignore JSON parse failure
    }
    throw new ApiError(response.status, errorMessage, errorCode);
  }

  return (await response.json()) as T;
}
