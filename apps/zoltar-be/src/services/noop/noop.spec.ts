import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NoopAssetStorageService } from './noop-asset-storage.service';
import { NoopEmailService } from './noop-email.service';
import { NoopEntitlementsService } from './noop-entitlements.service';
import { NoopFeatureFlagService } from './noop-feature-flag.service';
import { NoopMeteringService } from './noop-metering.service';
import { NoopRealtimeService } from './noop-realtime.service';

beforeEach(() => {
  vi.restoreAllMocks();
});

function spyDebug() {
  return vi
    .spyOn(Logger.prototype, 'debug')
    .mockImplementation(() => undefined);
}

describe('NoopEntitlementsService', () => {
  it('permits adventure creation by default', async () => {
    const svc = new NoopEntitlementsService();
    await expect(svc.canCreateAdventure('user_1')).resolves.toBe(true);
  });

  it('warns once across many calls', async () => {
    const debug = spyDebug();
    const svc = new NoopEntitlementsService();
    await svc.canCreateAdventure('user_1');
    await svc.canCreateAdventure('user_2');
    await svc.canCreateAdventure('user_3');
    expect(debug).toHaveBeenCalledTimes(1);
  });
});

describe('NoopMeteringService', () => {
  it('returns void', async () => {
    const svc = new NoopMeteringService();
    await expect(
      svc.recordTokenUsage('adv_1', 100, 200),
    ).resolves.toBeUndefined();
  });

  it('warns once across many calls', async () => {
    const debug = spyDebug();
    const svc = new NoopMeteringService();
    await svc.recordTokenUsage('adv_1', 1, 1);
    await svc.recordTokenUsage('adv_1', 2, 2);
    expect(debug).toHaveBeenCalledTimes(1);
  });
});

describe('NoopEmailService', () => {
  it('returns void', async () => {
    const svc = new NoopEmailService();
    await expect(
      svc.sendTransactional('alex@example.com', 'hi', 'body'),
    ).resolves.toBeUndefined();
  });

  it('warns once across many calls', async () => {
    const debug = spyDebug();
    const svc = new NoopEmailService();
    await svc.sendTransactional('a@x.com', 's', 'b');
    await svc.sendTransactional('b@x.com', 's', 'b');
    expect(debug).toHaveBeenCalledTimes(1);
  });
});

describe('NoopAssetStorageService', () => {
  it('upload echoes the key', async () => {
    const svc = new NoopAssetStorageService();
    await expect(
      svc.upload('avatars/user_1.png', Buffer.from(''), 'image/png'),
    ).resolves.toBe('avatars/user_1.png');
  });

  it('getSignedUrl returns a noop:// placeholder', async () => {
    const svc = new NoopAssetStorageService();
    await expect(svc.getSignedUrl('avatars/user_1.png')).resolves.toBe(
      'noop://avatars/user_1.png',
    );
  });

  it('warns once across upload and getSignedUrl combined', async () => {
    const debug = spyDebug();
    const svc = new NoopAssetStorageService();
    await svc.upload('a', Buffer.from(''), 'text/plain');
    await svc.getSignedUrl('a');
    await svc.upload('b', Buffer.from(''), 'text/plain');
    expect(debug).toHaveBeenCalledTimes(1);
  });
});

describe('NoopRealtimeService', () => {
  it('returns void', async () => {
    const svc = new NoopRealtimeService();
    await expect(
      svc.publish('campaign:1', 'message', { hi: true }),
    ).resolves.toBeUndefined();
  });

  it('warns once across many calls', async () => {
    const debug = spyDebug();
    const svc = new NoopRealtimeService();
    await svc.publish('c1', 'e', {});
    await svc.publish('c1', 'e', {});
    expect(debug).toHaveBeenCalledTimes(1);
  });
});

describe('NoopFeatureFlagService', () => {
  it('reports every flag as disabled', async () => {
    const svc = new NoopFeatureFlagService();
    await expect(svc.isEnabled('any_flag')).resolves.toBe(false);
    await expect(svc.isEnabled('another', { user: 'u1' })).resolves.toBe(false);
  });

  it('warns once across many calls', async () => {
    const debug = spyDebug();
    const svc = new NoopFeatureFlagService();
    await svc.isEnabled('flag_a');
    await svc.isEnabled('flag_b');
    await svc.isEnabled('flag_c');
    expect(debug).toHaveBeenCalledTimes(1);
  });
});
