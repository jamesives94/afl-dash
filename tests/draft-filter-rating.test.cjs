const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const fixture = require('./fixtures/cody-walker-history.json');
let source = fs.readFileSync(require.resolve('../src/DraftProspectProfileDashboard.tsx'), 'utf8');
source = source.replaceAll('(import.meta as any)', '({ env: {} } as any)');
source += '\nexport { filteredGamesForPlayer, averageWeightedRating, isRatedDraftProfileGame };';
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const context = { exports: {}, require: () => ({}) };
vm.runInNewContext(js, context);
const { filteredGamesForPlayer, averageWeightedRating, isRatedDraftProfileGame } = context.exports;
const all = '__ALL__';
const payload = { players: [fixture.player], gamesByPlayer: { [fixture.player.playerId]: fixture.games }, statsByPlayer: {} };
const champion = new Map(fixture.championGames.map(g => [`${g.playerId}_${g.matchId}`, g]));
const games = (season, league) => filteredGamesForPlayer(payload, fixture.player, season, league, 'MEN', all);
const rating = rows => averageWeightedRating(rows, champion, fixture.player, null, 'RAW');

test('Cody full history contains all five competitions and excludes three trials', () => {
  const history = fixture.games.filter(isRatedDraftProfileGame);
  assert.equal(history.length, 38);
  assert.deepEqual([...new Set(history.map(g => g.leagueCode))].sort(), ['AFLAISA','TLB','U16C','U18C','VFL']);
  assert.equal(history.filter(g => g.leagueCode === 'TLB').length, 19);
  assert.equal(history.filter(g => g.leagueCode === 'VFL').length, 7);
});

test('rating sample changes by league and season while full history stays available', () => {
  assert.equal(games('2026','MENS_U18').length, 8);
  assert.equal(games('2026','VFL').length, 7);
  assert.equal(games('2026',all).length, 15);
  assert.equal(games(all,all).length, 38);
  const values = [rating(games('2026','MENS_U18')),rating(games('2026','VFL')),rating(games('2026',all)),rating(games(all,all))];
  assert.ok(values.every(Number.isFinite));
  assert.equal(new Set(values.map(v => v.toFixed(2))).size, 4);
  assert.equal(rating(games('2024','VFL')), null);
});
