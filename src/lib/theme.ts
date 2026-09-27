import { useEffect } from 'react';
import { usePrefs } from '../state/ui';
import { useMedia } from './useMedia';

export function useResolvedTheme(): 'light' | 'dark' {
  const pref = usePrefs((s) => s.theme);
  const systemDark = useMedia('(prefers-color-scheme: dark)');
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

/** Applique le thème au document (et à la barre d'état sur iOS). */
export function useApplyTheme() {
  const theme = useResolvedTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff');
  }, [theme]);
  return theme;
}
