'use client';

import { useEffect, useState } from 'react';

type Theme = 'night' | 'day';
const KEY = 'os-theme';

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(KEY, theme);
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--os-field').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>('night');

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'day' ? 'day' : 'night');
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'day' ? 'night' : 'day';
    apply(next);
    setTheme(next);
  };

  const day = theme === 'day';
  return (
    <button type="button" className="theme-switch" aria-pressed={day} onClick={toggle}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        {day
          ? <path d="M12 4 V2 M12 22 V20 M4 12 H2 M22 12 H20 M6 6 L4.5 4.5 M19.5 19.5 L18 18 M18 6 L19.5 4.5 M4.5 19.5 L6 18 M12 8 a4 4 0 1 0 0.1 0" />
          : <path d="M16 14.5 A7 7 0 0 1 9.5 4 A7 7 0 1 0 16 14.5 Z" />}
      </svg>
      {day ? 'Day' : 'Night'}
    </button>
  );
}
