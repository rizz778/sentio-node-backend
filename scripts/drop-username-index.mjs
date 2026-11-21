/**
 * One-time migration: drop the stale `username_1` unique index from the users collection.
 * Run from node-backend root:
 *   node scripts/drop-username-index.mjs
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sentio';

await mongoose.connect(uri);
console.log('Connected to MongoDB:', uri);

const indexes = await mongoose.connection.collection('users').indexes();
console.log('Current indexes:', indexes.map(i => `${i.name} (${JSON.stringify(i.key)})`).join('\n  '));

const stale = indexes.find(i => i.name === 'username_1');
if (stale) {
  await mongoose.connection.collection('users').dropIndex('username_1');
  console.log('\n✅  Dropped stale username_1 index — sync will work now.');
} else {
  console.log('\n✅  No username_1 index found — nothing to do.');
}

await mongoose.disconnect();
