import type { HttpRequest, HttpResponse } from '@matane/extension-sdk';

// Converts between the sandbox's JSON-friendly HttpRequest/HttpResponse and WHATWG fetch.
// Shared by every embedder (app network layer, mr-ext) so body/response handling is identical.

export interface FetchParts {
  method: string;
  headers: Headers;
  body?: string;
}

export function toFetchParts(request: HttpRequest): FetchParts {
  const headers = new Headers(request.headers);
  let body: string | undefined;
  if (typeof request.body === 'string') {
    body = request.body;
  } else if (request.body && 'json' in request.body) {
    body = JSON.stringify(request.body.json);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  } else if (request.body && 'form' in request.body) {
    body = new URLSearchParams(request.body.form).toString();
    if (!headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded');
  }
  return { method: request.method ?? 'GET', headers, body };
}

export async function fromFetchResponse(
  response: Response,
  responseType: HttpRequest['responseType'],
  url: string = response.url,
): Promise<HttpResponse> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => (headers[key] = value));
  let body: unknown;
  switch (responseType ?? 'text') {
    case 'bytes':
      body = Buffer.from(await response.arrayBuffer()).toString('base64');
      break;
    case 'json': {
      const text = await response.text();
      try {
        body = text === '' ? null : JSON.parse(text);
      } catch {
        // Error pages are often HTML; keep the text so status handling still works.
        body = text;
      }
      break;
    }
    default:
      body = await response.text();
  }
  return { status: response.status, url, headers, body };
}
