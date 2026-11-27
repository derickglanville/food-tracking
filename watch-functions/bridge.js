'use strict';

const {randomBytes, randomUUID, createHash, timingSafeEqual} = require('node:crypto');
const OWNER_EMAIL = 'dglanville@gmail.com';
const DEVICES = 'food_tracker_health/watch_access/devices';
const TRACKER = 'food_tracker_health/departure_tracker';
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const digest = value => createHash('sha256').update(value).digest('hex');

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function easternTime(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}`};
}

function createBridge({db, auth, now = () => new Date()}) {
  async function owner(req) {
    const header = req.get('Authorization') || '';
    if (!header.startsWith('Bearer ')) throw new RequestError(401, 'Sign in to Gather first.');
    let user;
    try {
      user = await auth.verifyIdToken(header.slice(7), true);
    } catch {
      throw new RequestError(401, 'Sign in to Gather again.');
    }
    if (user.email !== OWNER_EMAIL || user.email_verified !== true) {
      throw new RequestError(403, 'This account cannot pair a watch.');
    }
    return user;
  }

  async function pair(req) {
    const user = await owner(req);
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + 365 * 86400000).toISOString();
    await db.doc(`${DEVICES}/${id}`).set({
      tokenHash: digest(secret), owner: user.uid, revoked: false,
      createdAt: createdAt.toISOString(), expiresAt, dailyCount: 0, dailyDate: ''
    });
    return {ok: true, deviceId: id, token: `${id}.${secret}`, expiresAt};
  }

  async function devices(req) {
    const user = await owner(req);
    const snapshot = await db.collection(DEVICES).where('owner', '==', user.uid).get();
    return {ok: true, devices: snapshot.docs.map(doc => {
      const {createdAt, expiresAt, revoked} = doc.data();
      return {id: doc.id, createdAt, expiresAt, revoked};
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))};
  }

  async function revoke(req, body) {
    const user = await owner(req);
    if (!validId(body.deviceId)) throw new RequestError(400, 'Choose a valid paired watch.');
    const ref = db.doc(`${DEVICES}/${body.deviceId}`);
    await db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (!doc.exists || doc.data().owner !== user.uid) throw new RequestError(404, 'Paired watch not found.');
      tx.update(ref, {revoked: true});
    });
    return {ok: true, message: 'Watch key revoked.'};
  }

  async function log(req, body) {
    const header = req.get('Authorization') || '';
    const match = /^Bearer ([a-zA-Z0-9_-]{1,100})\.([a-zA-Z0-9_-]{43})$/.exec(header);
    if (!match) throw new RequestError(401, 'Pair this watch in Gather.');
    const [,deviceId,secret] = match;
    if (!validId(body.requestId)) throw new RequestError(400, 'A unique requestId is required.');
    if (!['wellness', 'departure'].includes(body.action)) throw new RequestError(400, 'Choose Wellness or Left the House.');
    if (body.action === 'wellness' && !['Yes', 'No', 'Undetermined'].includes(body.status)) {
      throw new RequestError(400, 'Choose Yes, No, or Undetermined.');
    }
    const deviceRef = db.doc(`${DEVICES}/${deviceId}`);
    const requestRef = db.doc(`${DEVICES}/${deviceId}/requests/${body.requestId}`);
    const timestamp = now();
    const local = easternTime(timestamp);
    const fingerprint = digest(JSON.stringify([body.action, body.status || '']));
    return db.runTransaction(async tx => {
      const [deviceDoc, requestDoc] = await Promise.all([tx.get(deviceRef), tx.get(requestRef)]);
      const device = deviceDoc.data();
      const storedHash = Buffer.from(device?.tokenHash || '', 'hex');
      const suppliedHash = Buffer.from(digest(secret), 'hex');
      if (!deviceDoc.exists || device.revoked || Date.parse(device.expiresAt) <= timestamp.getTime() ||
          storedHash.length !== suppliedHash.length || !timingSafeEqual(storedHash, suppliedHash)) {
        throw new RequestError(401, 'Watch key expired or revoked. Pair again in Gather.');
      }
      if (requestDoc.exists) {
        if (requestDoc.data().fingerprint !== fingerprint) throw new RequestError(409, 'Use a new requestId for each check-in.');
        return requestDoc.data().result;
      }
      const dailyCount = device.dailyDate === local.date ? device.dailyCount : 0;
      if (dailyCount >= 100) throw new RequestError(429, 'Daily watch check-in limit reached.');
      const savedAt = timestamp.toISOString();
      if (body.action === 'departure') {
        tx.create(db.doc(`${TRACKER}/events/watch_${deviceId}_${body.requestId}`), {
          departedAt: savedAt, source: 'Apple Watch'
        });
        tx.set(db.doc(TRACKER), {leftHouse: true}, {merge: true});
      } else {
        tx.set(db.doc(`food_tracker_wellness/wellness_${local.date.replaceAll('-', '')}`), {
          date: local.date, bowelMovement: body.status === 'Undetermined' ? '' : body.status,
          time: body.status === 'Yes' ? local.time : ''
        }, {merge: true});
      }
      const message = body.action === 'departure' ? 'Departure saved.' : `Wellness ${body.status} saved.`;
      const result = {ok: true, message, savedAt};
      tx.create(requestRef, {fingerprint, result});
      tx.update(deviceRef, {dailyDate: local.date, dailyCount: dailyCount + 1});
      return result;
    });
  }

  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const path = req.path.replace(/\/$/, '');
      if (req.method === 'GET' && path === '/health') return res.json({ok: true, service: 'gather-watch', version: 1});
      if (req.method === 'GET' && path === '/devices') return res.json(await devices(req));
      if (req.method !== 'POST') throw new RequestError(405, 'Use POST for watch check-ins.');
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
          Buffer.byteLength(JSON.stringify(req.body)) > 4096) throw new RequestError(400, 'Invalid request.');
      const actions = {'/devices': pair, '/devices/revoke': revoke, '/log': log};
      if (!actions[path]) throw new RequestError(404, 'Watch action not found.');
      res.json(await actions[path](req, req.body));
    } catch (error) {
      res.status(error.status || 500).json({ok: false, message: error.status ? error.message : 'Could not save to Firebase. Try again.'});
    }
  };
}

module.exports = {createBridge, easternTime};
