import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { api, errorMessage } from './api';

/** Charge une ressource à chaque affichage de l'écran ; garde les données précédentes pendant le rechargement. */
export function useQuery<T>(path: string | null, opts: { auth?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await api<T>(path, { auth: opts.auth });
      if (n === seq.current) setData(d);
    } catch (e) {
      if (n === seq.current) setError(errorMessage(e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path, opts.auth]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return { data, error, loading, reload: load, setData };
}
