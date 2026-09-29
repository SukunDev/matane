import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HttpRequest, HttpResponse } from '@matane/extension-sdk';
import type { HostApi, LogLevel } from '@matane/extension-runtime';
import { nodeFetch } from './node-host.js';

export interface FixtureHostOptions {
  dir: string;
  /** Fetch and save responses that have no fixture yet (e.g. `MR_RECORD=1`). */
  record?: boolean;
  /** Answer some requests without fixtures (e.g. fire-and-forget reports). */
  stub?: (request: HttpRequest) => HttpResponse | undefined;
  /** Trims a freshly recorded response before it is saved (drop fields the tests never read). */
  shrink?: (response: HttpResponse, request: HttpRequest) => HttpResponse;
}

export interface FixtureHost extends HostApi {
  /** Every request the extension made, in order. */
  requests: HttpRequest[];
  logs: { level: LogLevel; message: string }[];
  store: Map<string, unknown>;
}

interface Fixture {
  request: { method: string; url: string; body?: HttpRequest['body'] };
  response: HttpResponse;
}

// Only headers extensions plausibly read; keeps fixtures small and stable.
const KEPT_HEADERS = ['content-type', 'location', 'retry-after'];

export function fixtureKey(request: HttpRequest): string {
  const identity = JSON.stringify([request.method ?? 'GET', request.url, request.body ?? null]);
  return createHash('sha1').update(identity).digest('hex').slice(0, 16);
}

/**
 * Whether `dir` holds recorded responses. Lets an extension's tests skip themselves (instead of
 * failing on "No fixture") in a checkout where fixtures were not committed.
 */
export function hasFixtures(dir: string): boolean {
  try {
    return readdirSync(dir).some((file) => file.endsWith('.json'));
  } catch {
    return false;
  }
}

/** Host that replays recorded HTTP responses, so extension tests never touch the network in CI. */
export function createFixtureHost(options: FixtureHostOptions): FixtureHost {
  const requests: HttpRequest[] = [];
  const logs: { level: LogLevel; message: string }[] = [];
  const store = new Map<string, unknown>();

  return {
    requests,
    logs,
    store,
    async http(request) {
      requests.push(request);
      const stubbed = options.stub?.(request);
      if (stubbed) return stubbed;

      const file = path.join(options.dir, `${fixtureKey(request)}.json`);
      const saved = await readFile(file, 'utf8').then(
        (text) => JSON.parse(text) as Fixture,
        () => undefined,
      );
      if (saved) return saved.response;
      if (!options.record) {
        throw new Error(`No fixture for ${request.method ?? 'GET'} ${request.url}; re-run with MR_RECORD=1`);
      }

      const fetched = await nodeFetch(request);
      const response = options.shrink ? options.shrink(fetched, request) : fetched;
      const headers = Object.fromEntries(Object.entries(response.headers).filter(([k]) => KEPT_HEADERS.includes(k)));
      const fixture: Fixture = {
        request: { method: request.method ?? 'GET', url: request.url, body: request.body },
        response: { ...response, headers },
      };
      await mkdir(options.dir, { recursive: true });
      await writeFile(file, `${JSON.stringify(fixture)}\n`);
      return fixture.response;
    },
    storage: {
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => void store.set(key, value),
      remove: async (key) => void store.delete(key),
    },
    log: (level, message) => void logs.push({ level, message }),
  };
}
