import { getAuthToken } from "../services/tokenService";

const BASE_URL = import.meta.env.VITE_API_URL || "/api";
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Standard RFC 7807 Problem Details payload structure returned by backend services.
 */
export interface ProblemDetails {
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  traceId?: string;
  errors?: Record<string, string[]>;
  [key: string]: unknown;
}

/**
 * Custom API Error class wrapping HTTP status codes and structured Problem Details response.
 */
export class ApiError extends Error {
  status: number;
  problemDetails?: ProblemDetails;

  constructor(
    message: string,
    status: number,
    problemDetails?: ProblemDetails,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.problemDetails = problemDetails;
  }
}

export interface RequestOptions extends RequestInit {
  token?: string;
}

function combineAbortSignals(
  externalSignal: AbortSignal,
  timeoutSignal: AbortSignal,
): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([externalSignal, timeoutSignal]);
  }

  const combinedController = new AbortController();
  const onAbort = () => {
    combinedController.abort(externalSignal.reason || timeoutSignal.reason);
  };

  if (externalSignal.aborted || timeoutSignal.aborted) {
    onAbort();
  } else {
    externalSignal.addEventListener("abort", onAbort, { once: true });
    timeoutSignal.addEventListener("abort", onAbort, { once: true });
  }

  return combinedController.signal;
}

/**
 * Safely parses RFC 7807 Problem Details payload or constructs fallback error message from HTTP response.
 */
async function parseProblemDetails(
  response: Response,
): Promise<{ errorMessage: string; problemDetails?: ProblemDetails }> {
  let problemDetails: ProblemDetails | undefined;
  let errorMessage = `API Request failed: ${response.status} ${response.statusText}`;

  try {
    const text = await response.text();
    if (!text?.trim()) {
      return { errorMessage, problemDetails };
    }

    const parsed = JSON.parse(text) as ProblemDetails;
    if (parsed && typeof parsed === "object") {
      problemDetails = parsed;
      const detailMsg = parsed.detail?.trim();
      const titleMsg = parsed.title?.trim();

      if (detailMsg) {
        errorMessage = detailMsg;
      } else if (titleMsg) {
        errorMessage = titleMsg;
      }
    }
  } catch {
    // Fallback to default HTTP status message if body parsing fails
  }

  return { errorMessage, problemDetails };
}

/**
 * Safely parses successful response body, handling 204 No Content and empty payload responses.
 */
async function parseResponseBody<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return {} as T;
  }

  const text = await response.text();
  if (!text?.trim()) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

export const apiClient = {
  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { token, headers, signal: externalSignal, ...rest } = options;

    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(headers as Record<string, string>),
    };

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

    const effectiveSignal = externalSignal
      ? combineAbortSignals(externalSignal, timeoutController.signal)
      : timeoutController.signal;

    try {
      const response = await fetch(`${BASE_URL}${normalizedEndpoint}`, {
        headers: requestHeaders,
        signal: effectiveSignal,
        ...rest,
      });

      if (!response.ok) {
        const { errorMessage, problemDetails } =
          await parseProblemDetails(response);
        throw new ApiError(errorMessage, response.status, problemDetails);
      }

      return await parseResponseBody<T>(response);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
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
