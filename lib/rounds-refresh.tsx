import { createContext, useCallback, useContext, useState } from 'react';

const RoundsRefreshContext = createContext({ refreshKey: 0, triggerRefresh: () => {} });

export function RoundsRefreshProvider({ children }: { children: React.ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const triggerRefresh = useCallback(() => setRefreshKey(k => k + 1), []);
  return (
    <RoundsRefreshContext.Provider value={{ refreshKey, triggerRefresh }}>
      {children}
    </RoundsRefreshContext.Provider>
  );
}

export const useRoundsRefresh = () => useContext(RoundsRefreshContext);
