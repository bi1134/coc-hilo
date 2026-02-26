import { GetErrorMessage } from "./GetErrorMessage";
import { IApiClient } from "./IApiClient";

import { getBaseUrl, getToken } from "./ApiRoute";


export class ApiClient implements IApiClient {
  private static instance: ApiClient;

  constructor(
    private baseUrl: string,
    private token?: string,
  ) { }

  public static getInstance(): ApiClient {
    if (!ApiClient.instance) {
      const { token } = getToken();
      const baseUrl = getBaseUrl();
      ApiClient.instance = new ApiClient(baseUrl, token);
    }
    return ApiClient.instance;
  }

  // Static wrappers for GameService compatibility
  public static async get<T>(url: string, params?: Record<string, any>): Promise<{ data: T, useMock: boolean }> {
    // Check for mock flag from getToken/url first if needed, 
    // but GameService handles useMock check based on response? 
    // Actually GameService expects { data: T, useMock: boolean } returned from these static calls?

    // WAIT: GameService code: 
    // const res = await ApiClient.get(ApiRoute.LAST_ACTIVITY);
    // if (res.useMock) ...

    // So ApiClient.get must return { data: T, useMock: boolean } or similar structure.
    // But looking at existing instance method:
    // public get<T>(...): Promise<T> { ... return this.request(...) }
    // And request returns Promise<T>.

    // The previous GameService refactor seemed to assume ApiClient returned an object with useMock property.
    // But ApiClient.ts implementation I saw returns Promise<T> (the json data directly).

    // I need to adjust these static wrappers to return what GameService expects: 
    // an object containing the data AND the useMock flag.

    const { useMock } = getToken();
    if (useMock) {
      return { data: {} as T, useMock: true };
    }

    const client = ApiClient.getInstance();
    const data = await client.get<T>(url, params);
    return { data, useMock: false };
  }

  public static async post<T>(url: string, body: unknown): Promise<{ data: T, useMock: boolean }> {
    const { useMock } = getToken();
    if (useMock) {
      return { data: {} as T, useMock: true };
    }

    const client = ApiClient.getInstance();
    const data = await client.post<T>(url, body);
    return { data, useMock: false };
  }


  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<T> {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };

    let response;
    try {
      response = await fetch(this.baseUrl + url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      // Shorten network error message
      GetErrorMessage.showApiErrorPopup({ code: 0, message: "Network error. Check connection." });
      throw error;
    }

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = "Request failed";

      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.errors) {
          const firstField = Object.keys(errorJson.errors)[0];
          const firstError = errorJson.errors[firstField];
          errorMessage = Array.isArray(firstError) ? firstError[0] : firstError;
        } else if (errorJson.message) {
          errorMessage = errorJson.message;
        }
      } catch {
        // Keep short default message
      }

      // Truncate long messages
      if (errorMessage.length > 50) {
        errorMessage = errorMessage.substring(0, 47) + "...";
      }

      GetErrorMessage.showApiErrorPopup({
        code: response.status.toString(),
        message: errorMessage
      });

      throw new Error(`API Error ${response.status}: ${errorMessage}`);
    }

    return response.json() as Promise<T>;
  }

  public get<T>(url: string, params?: Record<string, any>): Promise<T> {
    // Always read token fresh — singleton may have been created before token was in URL
    const { token } = getToken();
    const allParams: Record<string, any> = {};
    if (token) {
      allParams.token = token;
    }
    if (params) {
      Object.assign(allParams, params);
    }
    const query = Object.keys(allParams).length > 0
      ? "?" + new URLSearchParams(allParams).toString()
      : "";
    return this.request<T>("GET", url + query);
  }

  public post<T>(url: string, body: unknown): Promise<T> {
    // Always read token fresh — singleton may have been created before token was in URL
    const { token } = getToken();
    // Always inject token into body — server requires it in every POST request
    const safeBody = (typeof body === 'object' && body !== null) ? body : {};
    const finalBody = token ? { token, ...safeBody } : safeBody;
    return this.request<T>("POST", url, finalBody);
  }

  public put<T>(url: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", url, body);
  }

  public delete<T>(url: string): Promise<T> {
    return this.request<T>("DELETE", url);
  }
}
