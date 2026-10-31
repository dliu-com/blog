'use strict';

// Posts table: one item per post, keyed by id (yyyymmddNN).
const SUMMARY_FIELDS = ['id', 'title', 'status', 'authorName', 'createdAt', 'updatedAt', 'publishedAt', 'excerpt', 'cover'];

class NotFound extends Error {}
class TooLarge extends Error {}
class Exists extends Error {}
// A visitor's reaction changed between our read and our write.
class Conflict extends Error {}

let defaultClient;
function documentClient() {
  if (!defaultClient) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    defaultClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return defaultClient;
}

const isTooLarge = (error) => error && error.name === 'ValidationException' && /size/i.test(error.message || '');

function createStore({
  client, table = process.env.TABLE_NAME, tokensTable = process.env.TOKENS_TABLE, reactionsTable = process.env.REACTIONS_TABLE,
} = {}) {
  const lib = require('@aws-sdk/lib-dynamodb');
  const send = (command) => (client || documentClient()).send(command);

  return {
    // Everything but the body. Consistent, so a post saved a moment ago is in the rebuilt index.
    async listPosts() {
      const items = [];
      let ExclusiveStartKey;
      do {
        const page = await send(new lib.ScanCommand({
          TableName: table,
          ConsistentRead: true,
          ProjectionExpression: SUMMARY_FIELDS.map((_, i) => `#f${i}`).join(', '),
          ExpressionAttributeNames: Object.fromEntries(SUMMARY_FIELDS.map((name, i) => [`#f${i}`, name])),
          ExclusiveStartKey,
        }));
        items.push(...(page.Items || []));
        ExclusiveStartKey = page.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return items;
    },

    async getPost(id) {
      const result = await send(new lib.GetCommand({ TableName: table, Key: { id }, ConsistentRead: true }));
      return result.Item || null;
    },

    async putPost(item, { create = false } = {}) {
      try {
        await send(new lib.PutCommand({
          TableName: table,
          Item: item,
          ...(create ? { ConditionExpression: 'attribute_not_exists(id)' } : {}),
        }));
      } catch (error) {
        if (create && error && error.name === 'ConditionalCheckFailedException') throw new Exists(`Post ${item.id} already exists`);
        if (isTooLarge(error)) throw new TooLarge('This post is too large to save');
        throw error;
      }
      return item;
    },

    async deletePost(id) {
      await send(new lib.DeleteCommand({ TableName: table, Key: { id } }));
    },

    // API tokens live in their own small table (one item per token, keyed by token id).
    async listTokens() {
      const items = [];
      let ExclusiveStartKey;
      do {
        const page = await send(new lib.ScanCommand({ TableName: tokensTable, ConsistentRead: true, ExclusiveStartKey }));
        items.push(...(page.Items || []));
        ExclusiveStartKey = page.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return items;
    },

    async getToken(id) {
      const result = await send(new lib.GetCommand({ TableName: tokensTable, Key: { id }, ConsistentRead: true }));
      return result.Item || null;
    },

    async putToken(item) {
      await send(new lib.PutCommand({ TableName: tokensTable, Item: item, ConditionExpression: 'attribute_not_exists(id)' }));
      return item;
    },

    // Only updates a token that still exists, so a revoked token is never brought back.
    async touchToken(id, lastUsedAt) {
      try {
        await send(new lib.UpdateCommand({
          TableName: tokensTable,
          Key: { id },
          UpdateExpression: 'SET lastUsedAt = :t',
          ConditionExpression: 'attribute_exists(id)',
          ExpressionAttributeValues: { ':t': lastUsedAt },
        }));
      } catch (error) {
        if (!(error && error.name === 'ConditionalCheckFailedException')) throw error;
      }
    },

    async deleteToken(id) {
      const result = await send(new lib.DeleteCommand({ TableName: tokensTable, Key: { id }, ReturnValues: 'ALL_OLD' }));
      return Boolean(result.Attributes);
    },

    // Reactions table (pk, sk): per post, a "counts" item with one number per reaction and a
    // "visitor#<dl_vid>" item with each visitor's reaction; per IP hash, "viewer#<hash>" rate-limit windows.
    async getReactions(postId, visitor) {
      const pk = `post#${postId}`;
      const [counts, mine] = await Promise.all([
        send(new lib.GetCommand({ TableName: reactionsTable, Key: { pk, sk: 'counts' }, ConsistentRead: true })),
        visitor ? send(new lib.GetCommand({ TableName: reactionsTable, Key: { pk, sk: `visitor#${visitor}` }, ConsistentRead: true })) : {},
      ]);
      return { counts: counts.Item || {}, mine: (mine.Item && mine.Item.reaction) || null };
    },

    // Moves the visitor from `from` to `to` (either may be null) and adjusts the counts in one transaction.
    async setReaction(postId, visitor, from, to, at) {
      const pk = `post#${postId}`;
      const key = { pk, sk: `visitor#${visitor}` };
      const visitorWrite = to
        ? {
          Put: {
            TableName: reactionsTable,
            Item: { ...key, reaction: to, updatedAt: at },
            ConditionExpression: from ? 'reaction = :from' : 'attribute_not_exists(sk)',
            ...(from ? { ExpressionAttributeValues: { ':from': from } } : {}),
          },
        }
        : { Delete: { TableName: reactionsTable, Key: key, ConditionExpression: 'reaction = :from', ExpressionAttributeValues: { ':from': from } } };
      const names = {};
      const values = {};
      const adds = [];
      if (to) {
        names['#to'] = to;
        values[':up'] = 1;
        adds.push('#to :up');
      }
      if (from) {
        names['#from'] = from;
        values[':down'] = -1;
        adds.push('#from :down');
      }
      try {
        await send(new lib.TransactWriteCommand({
          TransactItems: [visitorWrite, {
            Update: {
              TableName: reactionsTable,
              Key: { pk, sk: 'counts' },
              UpdateExpression: `ADD ${adds.join(', ')}`,
              ExpressionAttributeNames: names,
              ExpressionAttributeValues: values,
            },
          }],
        }));
      } catch (error) {
        if (error && error.name === 'TransactionCanceledException') throw new Conflict('Reaction changed meanwhile');
        throw error;
      }
    },

    // Counts one request in this window; false once `limit` is reached. Windows expire through TTL.
    async countRequest(viewer, windowStart, limit, ttl) {
      try {
        await send(new lib.UpdateCommand({
          TableName: reactionsTable,
          Key: { pk: `viewer#${viewer}`, sk: String(windowStart) },
          UpdateExpression: 'ADD n :one SET #ttl = :ttl',
          ConditionExpression: 'attribute_not_exists(n) OR n < :limit',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':one': 1, ':ttl': ttl, ':limit': limit },
        }));
        return true;
      } catch (error) {
        if (error && error.name === 'ConditionalCheckFailedException') return false;
        throw error;
      }
    },

    async deleteReactions(postId) {
      const pk = `post#${postId}`;
      let ExclusiveStartKey;
      do {
        const page = await send(new lib.QueryCommand({
          TableName: reactionsTable,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          ProjectionExpression: 'pk, sk',
          ExclusiveStartKey,
        }));
        const keys = page.Items || [];
        for (let i = 0; i < keys.length; i += 25) {
          let requests = { [reactionsTable]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) };
          for (let attempt = 0; requests && Object.keys(requests).length && attempt < 5; attempt += 1) {
            if (attempt) await new Promise((resolve) => { setTimeout(resolve, 100 * 2 ** attempt); });
            requests = (await send(new lib.BatchWriteCommand({ RequestItems: requests }))).UnprocessedItems;
          }
        }
        ExclusiveStartKey = page.LastEvaluatedKey;
      } while (ExclusiveStartKey);
    },
  };
}

module.exports = { Conflict, createStore, Exists, NotFound, SUMMARY_FIELDS, TooLarge };
