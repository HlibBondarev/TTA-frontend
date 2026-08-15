import { getAuthToken } from "../services/tokenService";

const BASE_URL = import.meta.env.VITE_API_URL || "/api";
const DEFAULT_TIMEOUT_MS = 15000;

export interface RequestOptions extends RequestInit {
  token?: string;
}

export const apiClient = {
  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { token, headers, signal: externalSignal, ...rest } = options;

    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(headers as Record<string, string>),
    };

    // Use passed token or resolve dynamically via tokenService
    const authToken = token || (await getAuthToken());
    if (authToken) {
      requestHeaders["Authorization"] = `Bearer ${authToken}`;
    }

    const normalizedEndpoint = endpoint.startsWith("/")
      ? endpoint
      : `/${endpoint}`;

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort(
        new Error(`API Request timeout after ${DEFAULT_TIMEOUT_MS}ms`),
      );
    }, DEFAULT_TIMEOUT_MS);

    // Combine external signal and timeout signal safely
    let effectiveSignal = timeoutController.signal;
    if (externalSignal) {
      if (typeof AbortSignal.any === "function") {
        effectiveSignal = AbortSignal.any([
          externalSignal,
          timeoutController.signal,
        ]);
      } else {
        const combinedController = new AbortController();
        const onAbort = () => {
          combinedController.abort(
            externalSignal.reason || timeoutController.signal.reason,
          );
        };
        if (externalSignal.aborted) {
          onAbort();
        } else if (timeoutController.signal.aborted) {
          onAbort();
        } else {
          externalSignal.addEventListener("abort", onAbort, { once: true });
          timeoutController.signal.addEventListener("abort", onAbort, {
            once: true,
          });
        }
        effectiveSignal = combinedController.signal;
      }
    }

    try {
      const response = await fetch(`${BASE_URL}${normalizedEndpoint}`, {
        headers: requestHeaders,
        signal: effectiveSignal,
        ...rest,
      });

      if (!response.ok) {
        const error = new Error(
          `API Request failed: ${response.status} ${response.statusText}`,
        ) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return {} as T;
      }

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // Suppress or format user-friendly message for aborted signals
        console.warn(
          `[apiClient] Request aborted for ${normalizedEndpoint}:`,
          err.message,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "GET" });
  },

  post<T>(
    endpoint: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  put<T>(
    endpoint: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "PUT",
      body: JSON.stringify(body),
    });
  },

  delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: "DELETE" });
  },
};
