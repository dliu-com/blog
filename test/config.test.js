'use strict';

const { loadConfig, resetConfigCache, NotConfigured, PARAMETERS } = require('../lambda/api/config');

const stored = {
  '/dliu/entra-tenant-id': ' tenant ',
  '/blog/entra-client-id': 'client',
  '/blog/entra-client-secret': 'secret',
  '/blog/entra-tenant-id': 'old-copy',
};

function fakeSsm(values) {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command.input);
      return { Parameters: command.input.Names.filter((n) => values[n]).map((Name) => ({ Name, Value: values[Name] })) };
    },
  };
}

beforeEach(resetConfigCache);

test('reads the shared tenant ID and only this app\'s own client ID and secret, in one call', async () => {
  const ssm = fakeSsm(stored);
  const config = await loadConfig(ssm, 1);
  expect(PARAMETERS).toEqual({ tenantId: '/dliu/entra-tenant-id', clientId: '/blog/entra-client-id', clientSecret: '/blog/entra-client-secret' });
  expect(ssm.calls).toEqual([{ Names: ['/dliu/entra-tenant-id', '/blog/entra-client-id', '/blog/entra-client-secret'], WithDecryption: true }]);
  expect(config).toMatchObject({ tenantId: 'tenant', clientId: 'client', clientSecret: 'secret' });
});

test('a missing shared tenant ID means sign-in is not configured', async () => {
  const { ['/dliu/entra-tenant-id']: _, ...rest } = stored;
  await expect(loadConfig(fakeSsm(rest), 1)).rejects.toBeInstanceOf(NotConfigured);
  await expect(loadConfig(fakeSsm(rest), 1)).rejects.toThrow('/dliu/entra-tenant-id');
});
