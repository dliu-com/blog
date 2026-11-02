'use strict';

// Clears CloudFront's copy of post media that changed outside a deploy, so a deleted or overwritten
// file stops being served at once rather than up to a day later.
// S3 (EventBridge) -> SQS queue -> this function, a minute's worth of events at a time.
// Keys are media/<postId>/<fileId>/<name>; each file has its own folder, so one wildcard per file
// needs no URL-encoding of the name. Several files of one post become /media/<postId>/*, and a large
// batch (or an unexpected key) becomes /media/*, so a bulk delete costs one invalidation path.
const MEDIA_KEY = /^media\/(\d{10})\/([A-Za-z0-9_-]{16})\/[^/]+$/;
const MAX_PATHS = 10;

function keyOf(record) {
  const event = JSON.parse(record.body);
  const key = event && event.detail && event.detail.object && event.detail.object.key;
  return typeof key === 'string' ? key : null;
}

function invalidationPaths(keys) {
  const posts = new Map();
  for (const key of keys) {
    const match = MEDIA_KEY.exec(key || '');
    if (!match) return ['/media/*'];
    if (!posts.has(match[1])) posts.set(match[1], new Set());
    posts.get(match[1]).add(match[2]);
  }
  const paths = [...posts].map(([postId, files]) =>
    files.size === 1 ? `/media/${postId}/${[...files][0]}/*` : `/media/${postId}/*`);
  return paths.length > MAX_PATHS ? ['/media/*'] : paths.sort();
}

// The AWS SDK comes with the Lambda runtime; tests pass their own.
function createHandler({ lib = () => require('@aws-sdk/client-cloudfront'), distributionId = process.env.DISTRIBUTION_ID } = {}) {
  let cloudfront;
  return async function handler(event) {
    const records = (event && event.Records) || [];
    if (!records.length) return { paths: [] };
    const paths = invalidationPaths(records.map(keyOf));
    const { CloudFrontClient, CreateInvalidationCommand } = lib();
    cloudfront = cloudfront || new CloudFrontClient({});
    // A failure throws, so SQS delivers the batch again (until the queue drops it after a day,
    // when CloudFront's copy has expired anyway).
    await cloudfront.send(new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `media-${records[0].messageId}-${records.length}`,
        Paths: { Quantity: paths.length, Items: paths },
      },
    }));
    console.log(JSON.stringify({ invalidated: paths, objects: records.length }));
    return { paths };
  };
}

module.exports = { MAX_PATHS, createHandler, handler: createHandler(), invalidationPaths };
