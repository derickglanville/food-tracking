'use strict';

const {onRequest} = require('firebase-functions/v2/https');
const {initializeApp} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const {getFirestore} = require('firebase-admin/firestore');
const {createBridge} = require('./bridge');

initializeApp();
exports.watchBridge = onRequest({
  region: 'us-central1',
  cors: ['https://derickglanville.github.io'],
  invoker: 'public',
  minInstances: 0,
  maxInstances: 1,
  timeoutSeconds: 30,
  memory: '256MiB'
}, createBridge({db: getFirestore(), auth: getAuth()}));
