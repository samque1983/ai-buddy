import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContentPicker } from '@/components/ContentPicker';

afterEach(cleanup);

describe('<ContentPicker>', () => {
  it('renders the three options and marks the active one', () => {
    render(<ContentPicker value={['ielts']} onChange={() => {}} />);
    expect(screen.getByText('日常地道表达')).toBeTruthy();
    expect(screen.getByText('雅思')).toBeTruthy();
    expect(screen.getByText('自由畅聊')).toBeTruthy();
    // Exactly one "进行中" (single-select).
    expect(screen.getAllByText('✓ 进行中')).toHaveLength(1);
  });

  it('selecting an unselected option fires onChange with a single value', async () => {
    const onChange = vi.fn();
    render(<ContentPicker value={['daily-core']} onChange={onChange} />);
    await userEvent.click(screen.getByText('雅思'));
    expect(onChange).toHaveBeenCalledWith(['ielts']);
  });

  it('clicking the already-active option does nothing (no deselect to zero)', async () => {
    const onChange = vi.fn();
    render(<ContentPicker value={['daily-core']} onChange={onChange} />);
    await userEvent.click(screen.getByText('日常地道表达'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('normalizes a legacy multi-pack value to a single active option', () => {
    render(<ContentPicker value={['daily-core', 'ielts']} onChange={() => {}} />);
    // First content pack (daily-core) is the active one.
    expect(screen.getAllByText('✓ 进行中')).toHaveLength(1);
    const dailyBtn = screen.getByText('日常地道表达').closest('button')!;
    expect(dailyBtn.textContent).toContain('✓ 进行中');
  });

  it('is inert while disabled', async () => {
    const onChange = vi.fn();
    render(<ContentPicker value={['daily-core']} onChange={onChange} disabled />);
    await userEvent.click(screen.getByText('雅思'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
