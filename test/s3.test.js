'use strict';

const { createFiles, mediaHeaders, mediaKey, mediaUrl, presignUrl, servedType, storageName } = require('../lambda/api/s3');

test('presigned URLs match the AWS SigV4 example', () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
  const url = presignUrl({
    method: 'GET',
    host: 'examplebucket.s3.amazonaws.com',
    key: 'test.txt',
    region: 'us-east-1',
    credentials: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
    expires: 86400,
    date: new Date('2013-05-24T00:00:00Z'),
  });
  expect(url).toBe('https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256'
    + '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z'
    + '&X-Amz-Expires=86400&X-Amz-SignedHeaders=host'
    + '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

test('upload URLs are short-lived and pin the size and type', () => {
  const files = createFiles({
    bucket: 'b',
    region: 'eu-west-1',
    credentials: () => ({ accessKeyId: 'AK', secretAccessKey: 'SK', sessionToken: 'TOKEN' }),
    now: () => new Date('2026-10-01T00:00:00Z'),
  });
  const { url, headers } = files.uploadUrl('abcdefghijkl', 'abcdefghijklmnop', { size: 123, type: 'image/png' });
  const parsed = new URL(url);
  expect(parsed.host).toBe('b.s3.eu-west-1.amazonaws.com');
  expect(parsed.pathname).toBe('/pending/abcdefghijkl/abcdefghijklmnop');
  expect(parsed.searchParams.get('X-Amz-Expires')).toBe('900');
  expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
  expect(parsed.searchParams.get('X-Amz-Security-Token')).toBe('TOKEN');
  expect(headers).toEqual({ 'content-type': 'image/png' });
});

test('media keys are URL-safe and keep the extension', () => {
  expect(storageName('Café menu (1).JPG')).toBe('Cafe-menu-1.jpg');
  expect(storageName('照片.png')).toBe('file.png');
  expect(storageName('README')).toBe('README');
  expect(mediaKey('P', 'F', 'a b.pdf')).toBe('media/P/F/a-b.pdf');
  expect(mediaUrl('media/P/F/a-b.pdf')).toBe('/media/P/F/a-b.pdf');
});

test('only safe types open in the browser; everything else downloads', () => {
  expect(mediaHeaders({ name: 'a.png', type: 'image/png' })).toEqual({
    ContentType: 'image/png',
    ContentDisposition: 'inline; filename="a.png"; filename*=UTF-8\'\'a.png',
    CacheControl: 'public, max-age=86400',
  });
  for (const type of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/javascript', 'application/octet-stream']) {
    expect(servedType(type)).toBe('application/octet-stream');
    expect(mediaHeaders({ name: 'x', type }).ContentDisposition).toMatch(/^attachment;/);
  }
  expect(mediaHeaders({ name: '照片 "x".pdf', type: 'application/pdf' }).ContentDisposition)
    .toBe('inline; filename="__ _x_.pdf"; filename*=UTF-8\'\'%E7%85%A7%E7%89%87%20%22x%22.pdf');
});

test('published JSON is revalidated on every view; uploads move out of pending/', async () => {
  const sent = [];
  const files = createFiles({ bucket: 'b', region: 'eu-west-1', client: { send: async (command) => { sent.push(command); return {}; } } });
  await files.putContent('posts/hello.json', { title: 'Hello' });
  expect(sent[0].input).toMatchObject({ Bucket: 'b', Key: 'content/posts/hello.json', CacheControl: 'no-cache', ContentType: 'application/json; charset=utf-8' });

  await files.keep('abcdefghijkl', 'abcdefghijklmnop', { name: 'x.svg', type: 'image/svg+xml' }, 'media/abcdefghijkl/abcdefghijklmnop/x.svg');
  expect(sent[1].input).toMatchObject({
    CopySource: 'b/pending/abcdefghijkl/abcdefghijklmnop',
    Key: 'media/abcdefghijkl/abcdefghijklmnop/x.svg',
    MetadataDirective: 'REPLACE',
    ContentType: 'application/octet-stream',
  });
  expect(sent[2].input).toEqual({ Bucket: 'b', Key: 'pending/abcdefghijkl/abcdefghijklmnop' });
});
