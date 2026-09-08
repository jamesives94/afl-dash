const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { Readable } = require('node:stream');

function server() {
  const payload = { players: [], gamesByPlayer: {
    cody: [{ matchId: 'talent', leagueCode: 'TLB' }, { matchId: 'senior', leagueCode: 'VFL' }, { matchId: 'trial', leagueCode: 'TRIAL' }],
    other: [{ matchId: 'other', leagueCode: 'U18C' }],
  } };
  let downloads = 0;
  const sandbox = {
    module: { exports: {} }, global: {}, Buffer, Date, Map, console,
    process: { env: { DATA_API_KEY: 'test-only', AZURE_STORAGE_CONNECTION_STRING: 'test-only' } },
    require(name) {
      if (name === 'papaparse') return {};
      assert.equal(name, '@azure/storage-blob');
      return { BlobServiceClient: { fromConnectionString: () => ({ getContainerClient: () => ({ getBlobClient: () => ({
        getProperties: async () => ({ etag: 'v1', lastModified: new Date('2026-09-08') }),
        download: async () => { downloads++; return { readableStreamBody: Readable.from([JSON.stringify(payload)]) }; },
      }) }) }) } };
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../api/data/index.js'), 'utf8'), sandbox);
  return {
    downloads: () => downloads,
    async request(playerId, key = 'test-only', file = 'second_tier_ratings_payload.json') {
      const context = {};
      await sandbox.module.exports(context, { headers: { 'x-data-key': key }, query: { file, playerId } });
      return JSON.parse(JSON.stringify(context.res));
    },
  };
}

test('history returns all leagues for only the requested player; full and scoped caches stay separate', async () => {
  const api = server();
  const history = await api.request('cody');
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.games.map(g => g.leagueCode), ['TLB', 'VFL', 'TRIAL']);
  assert.equal(history.body.playerId, 'cody');
  const full = await api.request();
  assert.ok(JSON.parse(full.body).gamesByPlayer.other);
  const other = await api.request('other');
  assert.deepEqual(other.body.games.map(g => g.matchId), ['other']);
  assert.equal(api.downloads(), 1);
});

test('unknown players are empty; authorization and allowed-file validation still apply', async () => {
  const api = server();
  assert.deepEqual((await api.request('unknown')).body.games, []);
  assert.equal((await api.request('cody', 'wrong')).status, 401);
  assert.equal((await api.request('../cody')).status, 400);
  assert.equal((await api.request('cody', 'test-only', 'league_trends.json')).status, 400);
});
