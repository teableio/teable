import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../../context/__tests__/createAppContext';
import { ConjunctionSelect } from './ConjunctionSelect';

const wrapper = createAppContext();

const classesOf = (element: Element) => element.className.split(/\s+/).filter(Boolean);

describe('ConjunctionSelect', () => {
  it('cannot be collapsed by its container unless a caller opts in', () => {
    // The filter's condition list is a flex *column*, so `flex-shrink` on this
    // trigger is vertical, not horizontal. The trigger also sets
    // `overflow-hidden`, which drops its automatic minimum size to zero - so a
    // shrinkable trigger in that column is squeezed to no height at all once
    // the list overflows, and no amount of scrolling brings it back.
    render(<ConjunctionSelect value="and" onSelect={vi.fn()} />, { wrapper });

    const classes = classesOf(screen.getByRole('combobox'));
    expect(classes).toContain('shrink-0');
    expect(classes).not.toContain('shrink');
  });

  it('lets a row container opt into shrinking sideways', () => {
    // The condition-group header *is* a row, where shrinking is horizontal and
    // is what keeps the add/delete buttons on screen next to a long label.
    render(<ConjunctionSelect value="and" onSelect={vi.fn()} className="min-w-0 shrink" />, {
      wrapper,
    });

    const classes = classesOf(screen.getByRole('combobox'));
    expect(classes).toContain('shrink');
    expect(classes).not.toContain('shrink-0');
  });
});
