const { MAX_PATHS, createHandler, invalidationPaths } = require('../lambda/invalidate');

const key = (post, file, name = 'photo.jpg') => `media/${post}/${file}/${name}`;
const A = 'AAAAAAAAAAAAAAAA';
const B = 'BBBBBBBBBBBBBBBB';
const fake = (send) => () => ({
  CloudFrontClient: class { send(command) { return send(command); } },
  CreateInvalidationCommand: class { constructor(input) { this.input = input; } },
});
const record = (k, id = 'm1') => ({ messageId: id, body: JSON.stringify({ 'detail-type': 'Object Deleted', detail: { object: { key: k } } }) });

test('one file clears its own folder, so the name never needs encoding', () => {
  expect(invalidationPaths([key('2026103100', A, 'a b%2B中.jpg')])).toEqual([`/media/2026103100/${A}/*`]);
});

test('several files of a post become one path for the post', () => {
  expect(invalidationPaths([key('2026103100', A), key('2026103100', B), key('2026103100', A)])).toEqual(['/media/2026103100/*']);
  expect(invalidationPaths([key('2026103100', A), key('2026103101', B)])).toEqual([`/media/2026103100/${A}/*`, `/media/2026103101/${B}/*`]);
});

test('a large batch or an unexpected key clears /media/* with a single path', () => {
  const many = Array.from({ length: MAX_PATHS + 1 }, (_, i) => key(String(2026103100 + i), A));
  expect(invalidationPaths(many)).toEqual(['/media/*']);
  expect(invalidationPaths(many.slice(0, MAX_PATHS))).toHaveLength(MAX_PATHS);
  for (const odd of ['media/x.jpg', 'media/2026103100/short/x.jpg', `media/2026103100/${A}/`, `media/2026103100/${A}/x/y`, '../media', null]) {
    expect(invalidationPaths([key('2026103100', A), odd])).toEqual(['/media/*']);
  }
});

test('the handler sends one invalidation for the batch to its own distribution', async () => {
  const sent = [];
  const handler = createHandler({ distributionId: 'EDIST', lib: fake(async (command) => sent.push(command.input)) });
  await expect(handler({ Records: [record(key('2026103100', A), 'x1'), record(key('2026103100', B), 'x2')] })).resolves.toEqual({ paths: ['/media/2026103100/*'] });
  expect(sent).toEqual([{ DistributionId: 'EDIST', InvalidationBatch: { CallerReference: 'media-x1-2', Paths: { Quantity: 1, Items: ['/media/2026103100/*'] } } }]);
  await expect(handler({ Records: [] })).resolves.toEqual({ paths: [] });
  expect(sent).toHaveLength(1);
});

test('a CloudFront failure fails the batch so SQS retries it', async () => {
  const handler = createHandler({ distributionId: 'EDIST', lib: fake(async () => { throw new Error('throttled'); }) });
  await expect(handler({ Records: [record(key('2026103100', A))] })).rejects.toThrow('throttled');
});
