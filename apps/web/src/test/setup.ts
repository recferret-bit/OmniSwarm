import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetState } from '@/mocks/db';

afterEach(() => {
  cleanup();
  resetState();
  sessionStorage.clear();
});
