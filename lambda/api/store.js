'use strict';

// Posts table: one item per post, keyed by id. The bySlug index finds which post owns a permalink.
const SLUG_INDEX = 'bySlug';
const SUMMARY_FIELDS = ['id', 'title', 'status', 'slug', 'authorName', 'createdAt', 'updatedAt', 'publishedAt', 'excerpt', 'cover'];

class NotFound extends Error {}
class TooLarge extends Error {}

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

function createStore({ client, table = process.env.TABLE_NAME } = {}) {
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

    async putPost(item) {
      try {
        await send(new lib.PutCommand({ TableName: table, Item: item }));
      } catch (error) {
        if (isTooLarge(error)) throw new TooLarge('This post is too large to save');
        throw error;
      }
      return item;
    },

    async deletePost(id) {
      await send(new lib.DeleteCommand({ TableName: table, Key: { id } }));
    },

    // Id of the post using this permalink, or null.
    async slugOwner(slug) {
      const result = await send(new lib.QueryCommand({
        TableName: table,
        IndexName: SLUG_INDEX,
        KeyConditionExpression: '#slug = :slug',
        ExpressionAttributeNames: { '#slug': 'slug' },
        ExpressionAttributeValues: { ':slug': slug },
        Limit: 1,
      }));
      return (result.Items && result.Items[0] && result.Items[0].id) || null;
    },
  };
}

module.exports = { createStore, NotFound, SLUG_INDEX, SUMMARY_FIELDS, TooLarge };
