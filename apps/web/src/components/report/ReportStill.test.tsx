import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReportStill } from './ReportStill';

describe('sample report still', () => {
  it('names the stage with the title that is printed on the page', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    render(<ReportStill />);
    const stage = screen.getByRole('button', { name: /Audit report/ });
    expect(stage).toHaveAccessibleName(/Source assessment/);
    expect(stage).toHaveAccessibleName(/Audit report/);
    expect(stage.className).toContain('report-stage');
    vi.unstubAllGlobals();
  });
});
