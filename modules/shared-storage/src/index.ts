import { requireNativeModule } from 'expo-modules-core';

interface SharedStorageModule {
  getPendingCSV(): string | null;
  clearPendingCSV(): void;
}

const module = requireNativeModule<SharedStorageModule>('SharedStorage');

export function getPendingCSV(): string | null {
  return module.getPendingCSV();
}

export function clearPendingCSV(): void {
  module.clearPendingCSV();
}
