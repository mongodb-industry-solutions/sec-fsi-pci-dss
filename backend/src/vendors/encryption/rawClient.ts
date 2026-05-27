import { MongoClient } from 'mongodb';

let _rawClient: MongoClient | null = null;

export async function getRawClient(): Promise<MongoClient> {
  if (_rawClient) return _rawClient;
  _rawClient = new MongoClient(process.env.MONGODB_URI!);
  await _rawClient.connect();
  return _rawClient;
}

export async function closeRawClient(): Promise<void> {
  if (_rawClient) {
    await _rawClient.close();
    _rawClient = null;
  }
}
