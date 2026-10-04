import { describe, expect, it } from 'vitest';
import { APP_PERMISSIONS, type PermissionSession, denyPermissionsByDefault, restrictPermissions } from './permissions';

/** Records the handlers a session was given, and answers like Electron would. */
function fakeSession() {
  let request: ((contents: unknown, permission: string, callback: (granted: boolean) => void) => void) | null = null;
  let check: ((contents: unknown, permission: string) => boolean) | null = null;
  let device: (() => boolean) | null = null;
  const session = {
    setPermissionRequestHandler: (handler: typeof request) => void (request = handler),
    setPermissionCheckHandler: (handler: typeof check) => void (check = handler),
    setDevicePermissionHandler: (handler: typeof device) => void (device = handler),
  } as unknown as PermissionSession;
  return {
    session,
    requested: (permission: string) => {
      let granted: boolean | undefined;
      request?.(null, permission, (value) => (granted = value));
      return granted;
    },
    checked: (permission: string) => check?.(null, permission),
    device: () => device?.(),
  };
}

const ASKED = ['geolocation', 'media', 'notifications', 'fullscreen', 'openExternal', 'clipboard-read', 'midi', 'usb'];

describe('restrictPermissions', () => {
  it('grants only what is allowed, to requests and to checks alike', () => {
    const fake = fakeSession();
    restrictPermissions(fake.session, APP_PERMISSIONS);
    expect(fake.requested('clipboard-sanitized-write')).toBe(true);
    expect(fake.checked('clipboard-sanitized-write')).toBe(true);
    for (const permission of ASKED) {
      expect(fake.requested(permission), permission).toBe(false);
      expect(fake.checked(permission), permission).toBe(false);
    }
  });

  it('never grants a device', () => {
    const fake = fakeSession();
    restrictPermissions(fake.session, APP_PERMISSIONS);
    expect(fake.device()).toBe(false);
  });

  it('with nothing allowed, refuses even copying', () => {
    const fake = fakeSession();
    restrictPermissions(fake.session, new Set());
    expect(fake.requested('clipboard-sanitized-write')).toBe(false);
    expect(fake.checked('clipboard-sanitized-write')).toBe(false);
  });
});

describe('denyPermissionsByDefault', () => {
  it('restricts every session the app creates, with nothing allowed', () => {
    let created: ((session: PermissionSession) => void) | null = null;
    denyPermissionsByDefault({
      on: ((event: string, listener: (session: PermissionSession) => void) => {
        if (event === 'session-created') created = listener;
      }) as never,
    });
    expect(created).not.toBeNull();

    const extension = fakeSession();
    created!(extension.session);
    expect(extension.requested('geolocation')).toBe(false);
    expect(extension.requested('clipboard-sanitized-write')).toBe(false);
    expect(extension.checked('notifications')).toBe(false);
    expect(extension.device()).toBe(false);
  });
});
