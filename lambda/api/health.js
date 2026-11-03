'use strict';

// GET /health for status.dliu.com (see /docs/health): one cheap read per dependency, no writes, no LIST, no
// third-party calls. It takes nothing from the request (CloudFront forwards no cookies, headers or query string
// on /health), and the response names no tables, buckets or functions: only a function key, a status and a
// generic reason.

const CHECK_TIMEOUT_MS = 2000;
const SLOW_MS = 1000;
const HEALTH_POST_ID = 'health-check'; // never a real post ID (those are yyyymmddNN)
const CONTENT_INDEX = 'content/index.json';

// Key and name of every function /health reports; /docs/health and /docs/health.md list the same keys.
const FUNCTIONS = [
  { key: 'posts', name: 'Posts' },
  { key: 'reactions', name: 'Reactions' },
  { key: 'storage', name: 'Published content storage' },
  { key: 'signin', name: 'Microsoft sign-in' },
];

const RANK = { pass: 0, warn: 1, fail: 2 };

class Timeout extends Error {}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Timeout()), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function createHealthChecks({
  table = process.env.TABLE_NAME,
  reactionsTable = process.env.REACTIONS_TABLE,
  bucket = process.env.CONTENT_BUCKET,
  loadConfig,
  documentClient,
  s3Client,
} = {}) {
  let doc = documentClient;
  let s3 = s3Client;
  const getItem = async (TableName, Key) => {
    const lib = require('@aws-sdk/lib-dynamodb');
    if (!doc) {
      const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
      doc = lib.DynamoDBDocumentClient.from(new DynamoDBClient({}));
    }
    await doc.send(new lib.GetCommand({ TableName, Key }));
  };
  return {
    posts: () => getItem(table, { id: HEALTH_POST_ID }),
    reactions: () => getItem(reactionsTable, { pk: `post#${HEALTH_POST_ID}`, sk: 'counts' }),
    storage: async () => {
      const { HeadObjectCommand, S3Client } = require('@aws-sdk/client-s3');
      s3 = s3 || new S3Client({});
      await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: CONTENT_INDEX }));
    },
    signin: async () => {
      const config = await loadConfig();
      if (!config || !config.tenantId || !config.clientId || !config.clientSecret) throw new Error('not configured');
    },
  };
}

async function runCheck(fn, { timeoutMs = CHECK_TIMEOUT_MS, slowMs = SLOW_MS, now = Date.now } = {}) {
  const started = now();
  try {
    await withTimeout(Promise.resolve().then(() => fn()), timeoutMs);
  } catch (error) {
    return { status: 'fail', output: error instanceof Timeout ? 'timeout' : 'read failed' };
  }
  return now() - started > slowMs ? { status: 'warn', output: 'slow' } : { status: 'pass' };
}

// checks: { [key]: async () => void }. Resolves to the health+json body; never throws.
async function checkHealth(checks, { clock = () => new Date(), ...options } = {}) {
  const functions = await Promise.all(FUNCTIONS.map(async ({ key, name }) => {
    const result = await runCheck(checks[key], options);
    return { key, name, ...result };
  }));
  const status = functions.reduce((worst, item) => (RANK[item.status] > RANK[worst] ? item.status : worst), 'pass');
  return { status, time: clock().toISOString().replace(/\.\d{3}Z$/, 'Z'), functions };
}

function healthResponse(body, method = 'GET') {
  return {
    statusCode: body.status === 'fail' ? 503 : 200,
    headers: {
      'content-type': 'application/health+json',
      // CloudFront's /health cache policy keys on nothing, so the checks run at most about once a minute.
      'cache-control': 'public, max-age=60',
      'x-content-type-options': 'nosniff',
    },
    body: method === 'HEAD' ? '' : JSON.stringify(body),
  };
}

module.exports = { CHECK_TIMEOUT_MS, CONTENT_INDEX, FUNCTIONS, HEALTH_POST_ID, SLOW_MS, checkHealth, createHealthChecks, healthResponse, runCheck };
