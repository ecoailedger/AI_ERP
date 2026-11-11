import { useEffect, useState } from 'react';
import { WorldCanvas } from './WorldCanvas';

type ApiStatus = 'checking' | 'ok' | 'down';

/** Shell for milestone 1.0: a placeholder world and a HUD strip that proves the API link. */
export function App() {
  const [api, setApi] = useState<ApiStatus>('checking');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((response) => setApi(response.ok ? 'ok' : 'down'))
      .catch(() => {
        if (!controller.signal.aborted) setApi('down');
      });
    return () => controller.abort();
  }, []);

  return (
    <>
      <WorldCanvas />
      <header className="hud">
        <strong>AI_ERP</strong>
        <span>Stage 1 scaffold: placeholder world, dummy data only</span>
        <span className={api === 'ok' ? 'ok' : 'down'}>core: {api}</span>
      </header>
    </>
  );
}
