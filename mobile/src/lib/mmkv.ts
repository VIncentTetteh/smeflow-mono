import Constants from 'expo-constants';

type StorageLike = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
  delete: (key: string) => void;
};

const memoryStore = new Map<string, string>();

const memoryStorage: StorageLike = {
  getString: (key) => memoryStore.get(key),
  set: (key, value) => {
    memoryStore.set(key, value);
  },
  delete: (key) => {
    memoryStore.delete(key);
  },
};

function createStorage(): StorageLike {
  if (Constants.appOwnership === 'expo') {
    return memoryStorage;
  }

  try {
    const { MMKV } = require('react-native-mmkv') as {
      MMKV: new (config: { id: string }) => StorageLike;
    };
    return new MMKV({ id: 'smeflow-storage' });
  } catch (error) {
    console.warn('Falling back to in-memory storage', error);
    return memoryStorage;
  }
}

export const storage = createStorage();
