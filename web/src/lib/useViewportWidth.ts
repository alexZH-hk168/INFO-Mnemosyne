import { useSyncExternalStore } from 'react';

function subscribe(cb: () => void) {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}

/** 当前视口宽度（px），随窗口缩放更新 */
export function useViewportWidth(): number {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth,
    () => 1440,
  );
}
