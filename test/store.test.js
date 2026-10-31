'use strict';

const { Conflict, createStore } = require('../lambda/api/store');

function fakeClient(fail) {
  const sent = [];
  return {
    sent,
    async send(command) {
      sent.push({ name: command.constructor.name, input: command.input });
      if (fail) throw Object.assign(new Error('failed'), { name: fail });
      return {};
    },
  };
}

describe('reactions in DynamoDB', () => {
  test('switching moves the visitor and both counts in one conditional transaction', async () => {
    const client = fakeClient();
    await createStore({ client, reactionsTable: 'R' }).setReaction('2026102701', 'abc12345', 'like', 'love', 'now');
    const [{ name, input }] = client.sent;
    expect(name).toBe('TransactWriteCommand');
    const [visitor, counts] = input.TransactItems;
    expect(visitor.Put).toEqual({
      TableName: 'R', Item: { pk: 'post#2026102701', sk: 'visitor#abc12345', reaction: 'love', updatedAt: 'now' },
      ConditionExpression: 'reaction = :from', ExpressionAttributeValues: { ':from': 'like' },
    });
    expect(counts.Update).toEqual({
      TableName: 'R', Key: { pk: 'post#2026102701', sk: 'counts' }, UpdateExpression: 'ADD #to :up, #from :down',
      ExpressionAttributeNames: { '#to': 'love', '#from': 'like' }, ExpressionAttributeValues: { ':up': 1, ':down': -1 },
    });
  });

  test('a first reaction needs no item yet; removing one deletes the item', async () => {
    const client = fakeClient();
    const store = createStore({ client, reactionsTable: 'R' });
    await store.setReaction('2026102701', 'abc12345', null, 'sad', 'now');
    await store.setReaction('2026102701', 'abc12345', 'sad', null, 'now');
    expect(client.sent[0].input.TransactItems[0].Put.ConditionExpression).toBe('attribute_not_exists(sk)');
    expect(client.sent[0].input.TransactItems[1].Update.UpdateExpression).toBe('ADD #to :up');
    expect(client.sent[1].input.TransactItems[0].Delete).toEqual({
      TableName: 'R', Key: { pk: 'post#2026102701', sk: 'visitor#abc12345' }, ConditionExpression: 'reaction = :from', ExpressionAttributeValues: { ':from': 'sad' },
    });
    expect(client.sent[1].input.TransactItems[1].Update.UpdateExpression).toBe('ADD #from :down');
  });

  test('a cancelled transaction is a conflict; a full rate-limit window says no', async () => {
    await expect(createStore({ client: fakeClient('TransactionCanceledException'), reactionsTable: 'R' }).setReaction('2026102701', 'abc12345', null, 'like', 'now'))
      .rejects.toBeInstanceOf(Conflict);
    expect(await createStore({ client: fakeClient('ConditionalCheckFailedException'), reactionsTable: 'R' }).countRequest('hash', 3600, 60, 10800)).toBe(false);
    const client = fakeClient();
    expect(await createStore({ client, reactionsTable: 'R' }).countRequest('hash', 3600, 60, 10800)).toBe(true);
    expect(client.sent[0].input).toMatchObject({ Key: { pk: 'viewer#hash', sk: '3600' }, ConditionExpression: 'attribute_not_exists(n) OR n < :limit' });
  });
});
