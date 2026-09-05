'use client';

import { useEffect } from 'react';
import { useAppearance } from '@/lib/use-appearance';

export function AppearanceThemeBridge() {
  const appearance = useAppearance();
  useEffect(() => {
    const theme = appearance.theme;
    if (!theme) return;
    const root = document.documentElement;
    root.style.setProperty('--brand-accent', theme.brandAccent);
    root.style.setProperty('--radius', theme.radius === 'compact' ? '0.35rem' : theme.radius === 'soft' ? '0.9rem' : '0.625rem');
  }, [appearance.theme]);
  return null;
}
