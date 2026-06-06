type SecureStoreModule = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
  isAvailableAsync?: () => Promise<boolean>;
};

type PersistStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const memoryStore = new Map<string, string>();

function getSecureStore(): SecureStoreModule | null {
  try {
    return require('expo-secure-store') as SecureStoreModule;
  } catch {
    return null;
  }
}

export const secureAuthStorage: PersistStorage = {
  async getItem(key) {
    const secureStore = getSecureStore();
    if (!secureStore) {
      return memoryStore.get(key) ?? null;
    }

    try {
      const available = secureStore.isAvailableAsync
        ? await secureStore.isAvailableAsync()
        : true;
      if (!available) {
        return memoryStore.get(key) ?? null;
      }
      return await secureStore.getItemAsync(key);
    } catch {
      return memoryStore.get(key) ?? null;
    }
  },
  async setItem(key, value) {
    const secureStore = getSecureStore();
    if (!secureStore) {
      memoryStore.set(key, value);
      return;
    }

    try {
      const available = secureStore.isAvailableAsync
        ? await secureStore.isAvailableAsync()
        : true;
      if (!available) {
        memoryStore.set(key, value);
        return;
      }
      await secureStore.setItemAsync(key, value);
    } catch {
      memoryStore.set(key, value);
    }
  },
  async removeItem(key) {
    const secureStore = getSecureStore();
    memoryStore.delete(key);
    if (!secureStore) {
      return;
    }

    try {
      const available = secureStore.isAvailableAsync
        ? await secureStore.isAvailableAsync()
        : true;
      if (available) {
        await secureStore.deleteItemAsync(key);
      }
    } catch {
      // Memory fallback was already cleared.
    }
  },
};
