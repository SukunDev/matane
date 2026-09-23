// Shapes used by the sandbox globals; importable without pulling in the ambient declarations.

export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  /** A raw string, a JSON value, or form fields (application/x-www-form-urlencoded). */
  body?: string | { json: unknown } | { form: Record<string, string> };
  /** `bytes` returns base64 in `body` (rarely needed; decode with `base64.decode`). */
  responseType?: 'text' | 'json' | 'bytes';
}

export interface HttpResponse<T = unknown> {
  status: number;
  /** Final URL after redirects. */
  url: string;
  headers: Record<string, string>;
  body: T;
}

export interface HtmlElement {
  select(selector: string): HtmlElement[];
  selectFirst(selector: string): HtmlElement | null;
  text(): string;
  html(): string;
  attr(name: string): string | undefined;
  /** Resolves a URL attribute against the document base URL. */
  absUrl(name: string): string | undefined;
}
