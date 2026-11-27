'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createBridge, easternTime} = require('./bridge');

function fixture() {
  const records = new Map();
  let clock = new Date('2026-11-28T02:15:00Z');
  let queue = Promise.resolve();
  const snapshot = path => ({exists: records.has(path), data: () => structuredClone(records.get(path))});
  const db = {
    doc: path => ({path, set: async data => records.set(path, structuredClone(data))}),
    collection: path => ({where: (field, operator, value) => ({get: async () => ({
      docs: [...records.entries()].filter(([key, data]) => key.startsWith(path + '/') &&
        key.split('/').length === path.split('/').length + 1 && data[field] === value)
        .map(([key, data]) => ({id: key.split('/').pop(), data: () => data}))
    })})}),
    runTransaction: work => {
      const run = queue.then(async () => {
        const writes = [];
        const tx = {
          get: async ref => snapshot(ref.path),
          create: (ref, data) => writes.push([ref.path, data, false]),
          set: (ref, data, options) => writes.push([ref.path, data, options?.merge]),
          update: (ref, data) => writes.push([ref.path, data, true])
        };
        const result = await work(tx);
        for (const [path, data, merge] of writes) records.set(path, structuredClone(merge ? {...records.get(path), ...data} : data));
        return result;
      });
      queue = run.catch(() => {});
      return run;
    }
  };
  const auth = {verifyIdToken: async token => {
    if (token !== 'owner') throw Error('Invalid token');
    return {uid: 'owner-id', email: 'dglanville@gmail.com', email_verified: true};
  }};
  const bridge = createBridge({db, auth, now: () => clock});
  async function call(path, body = {}, token = 'owner', method = 'POST') {
    const output = {status: 200};
    const res = {set() {}, status(code) {output.status = code; return this;}, json(value) {output.body = value;}};
    await bridge({path, method, body, get: key => key === 'Authorization' ? 'Bearer ' + token : ''}, res);
    return output;
  }
  return {call, records, setClock: value => {clock = new Date(value);}};
}

test('only the verified owner pairs devices and receives the private key', async () => {
  const f = fixture();
  assert.equal((await f.call('/devices', {}, 'bad')).status, 401);
  const paired = await f.call('/devices');
  assert.equal(paired.status, 200);
  assert.match(paired.body.token, /^[\w-]+\.[\w-]{43}$/);
  assert.equal(JSON.stringify([...f.records.values()]).includes(paired.body.token), false);
  const devices = await f.call('/devices', {}, 'owner', 'GET');
  assert.equal(devices.body.devices.length, 1);
  assert.equal(JSON.stringify(devices.body).includes('tokenHash'), false);
  assert.equal((await f.call('/log', {requestId: 'r1', action: 'departure'}, 'bad')).status, 401);
});

test('watch departures use the normal event path and retries are idempotent', async () => {
  const f = fixture();
  const {token} = (await f.call('/devices')).body;
  const input = {requestId: 'outing-1', action: 'departure'};
  const [first, retry] = await Promise.all([f.call('/log', input, token), f.call('/log', input, token)]);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, retry.body);
  assert.equal([...f.records.keys()].filter(path => path.includes('/events/')).length, 1);
  assert.equal(f.records.get('food_tracker_health/departure_tracker').leftHouse, true);
  assert.equal((await f.call('/log', {requestId: 'outing-1', action: 'wellness', status: 'Yes'}, token)).status, 409);
  await f.call('/log', {...input, requestId: 'outing-2'}, token);
  assert.equal([...f.records.keys()].filter(path => path.includes('/events/')).length, 2);
});

test('wellness saves the Eastern day and time and retains the notes', async () => {
  const f = fixture();
  const {token} = (await f.call('/devices')).body;
  const path = 'food_tracker_wellness/wellness_20261127';
  f.records.set(path, {date: '2026-11-27', notes: 'Existing notes'});
  await f.call('/log', {requestId: 'w1', action: 'wellness', status: 'Yes'}, token);
  assert.deepEqual(f.records.get(path), {date: '2026-11-27', notes: 'Existing notes', bowelMovement: 'Yes', time: '21:15'});
  await f.call('/log', {requestId: 'w2', action: 'wellness', status: 'No'}, token);
  assert.equal(f.records.get(path).bowelMovement, 'No');
  assert.equal(f.records.get(path).time, '');
  await f.call('/log', {requestId: 'w3', action: 'wellness', status: 'Undetermined'}, token);
  assert.equal(f.records.get(path).bowelMovement, '');
  assert.equal((await f.call('/log', {requestId: 'w4', action: 'wellness', status: 'Maybe'}, token)).status, 400);
  assert.equal((await f.call('/log', {requestId: 'w5', action: 'delete'}, token)).status, 400);
});

test('revoked, expired, wrong, and rate-limited keys cannot write', async () => {
  const f = fixture();
  const {token, deviceId} = (await f.call('/devices')).body;
  const path = 'food_tracker_health/watch_access/devices/' + deviceId;
  const input = {requestId: 'r1', action: 'departure'};
  assert.equal((await f.call('/log', input, deviceId + '.' + 'a'.repeat(43))).status, 401);
  f.records.get(path).dailyDate = '2026-11-27';
  f.records.get(path).dailyCount = 100;
  assert.equal((await f.call('/log', input, token)).status, 429);
  f.records.get(path).dailyCount = 0;
  assert.equal((await f.call('/devices/revoke', {deviceId})).status, 200);
  assert.equal((await f.call('/log', input, token)).status, 401);
  f.records.get(path).revoked = false;
  f.setClock('2028-01-01T12:00:00Z');
  assert.equal((await f.call('/log', input, token)).status, 401);
  assert.equal([...f.records.keys()].filter(key => key.includes('/events/')).length, 0);
});

test('Eastern time formatting handles daylight saving and midnight', () => {
  assert.deepEqual(easternTime(new Date('2026-07-01T03:15:00Z')), {date: '2026-06-30', time: '23:15'});
  assert.deepEqual(easternTime(new Date('2026-12-01T05:01:00Z')), {date: '2026-12-01', time: '00:01'});
});
