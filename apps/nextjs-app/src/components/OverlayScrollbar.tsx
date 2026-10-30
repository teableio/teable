'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Axis = 'x' | 'y';

const AXES = ['x', 'y'] as const;

/**
 * Scrollers that draw their own bar or keep theirs hidden on purpose: tailwind-scrollbar's
 * styled native bars (the grid), Radix ScrollArea viewports, and `[scrollbar-width:none]`.
 */
const SKIP_SELECTOR =
  '.scrollbar, .no-scrollbar, .\\[scrollbar-width\\:none\\], [data-radix-scroll-area-viewport]';
// Named on the active scroller and hoisted to the root by `timeline-scope` in global.css.
const SCROLL_TIMELINE = '--overlay-scroll-y y, --overlay-scroll-x x';
// Gap between the bar and the scroller's edge, and the bar's hit area across its axis.
const INSET = 2;
const HIT = 11;
const MIN_THUMB = 24;
const HIDE_DELAY = 800;
// While a scroll goes on, content may grow (a list loading more), so the thumb is re-measured.
const REMEASURE_INTERVAL = 250;

const SCROLLABLE_OVERFLOW = new Set(['auto', 'scroll', 'overlay']);

type Corner = 'TopLeft' | 'TopRight' | 'BottomRight' | 'BottomLeft';

const CORNERS: Corner[] = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'];

interface IRounded {
  el: Element;
  radii: Record<Corner, number>;
}

interface IActive {
  el: HTMLElement;
  axes: Record<Axis, boolean>;
  rtl: boolean;
  // Ancestors that clip the scroller, so the bar never shows past what is visible of it.
  clips: Element[];
  // The scroller and clipping ancestors with rounded corners, which a bar's ends must clear.
  rounded: IRounded[];
  // The scroller's own inline `scroll-timeline`, put back once it is no longer active.
  ownTimeline: string;
}

interface IMetrics {
  // How far the thumb travels along its track, and how far the content scrolls.
  travel: number;
  max: number;
}

interface IDrag {
  axis: Axis;
  pointer: number;
  scroll: number;
  ratio: number;
}

const getClips = (el: Element) => {
  const clips: Element[] = [];
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') clips.push(parent);
  }
  return clips;
};

const getRounded = (els: Element[]) =>
  els.flatMap((el): IRounded[] => {
    const style = getComputedStyle(el);
    const radii = Object.fromEntries(
      CORNERS.map((corner) => [corner, parseFloat(style[`border${corner}Radius`]) || 0])
    ) as Record<Corner, number>;
    return Object.values(radii).some(Boolean) ? [{ el, radii }] : [];
  });

const activate = (el: Element): IActive | undefined => {
  if (!(el instanceof HTMLElement) || el.matches(SKIP_SELECTOR)) return;
  const style = getComputedStyle(el);
  const axes = {
    x: SCROLLABLE_OVERFLOW.has(style.overflowX) && el.scrollWidth - el.clientWidth > 1,
    y: SCROLLABLE_OVERFLOW.has(style.overflowY) && el.scrollHeight - el.clientHeight > 1,
  };
  if (!axes.x && !axes.y) return;
  const ownTimeline = el.style.getPropertyValue('scroll-timeline');
  el.style.setProperty('scroll-timeline', SCROLL_TIMELINE);
  const clips = getClips(el);
  const rounded = getRounded([el, ...clips]);
  return { el, axes, rtl: style.direction === 'rtl', clips, rounded, ownTimeline };
};

const deactivate = ({ el, ownTimeline }: IActive) => {
  if (ownTimeline) el.style.setProperty('scroll-timeline', ownTimeline);
  else el.style.removeProperty('scroll-timeline');
};

interface IBox {
  top: number;
  left: number;
  bottom: number;
  right: number;
  // Both bars shown: each stops short of the corner the other one runs into.
  corner: number;
  // How far a bar's end stays from each corner: INSET, or half the radius of a rounded corner
  // there, so the end clears the curve instead of being cut by it.
  ends: Record<Corner, number>;
}

// Box edges within this of a rounded element's edges count as that element's corner.
const CORNER_SLOP = 2;

const getEnds = (rounded: IRounded[], box: Omit<IBox, 'ends'>) => {
  const ends: Record<Corner, number> = {
    TopLeft: INSET,
    TopRight: INSET,
    BottomRight: INSET,
    BottomLeft: INSET,
  };
  rounded.forEach(({ el, radii }) => {
    const rect = el.getBoundingClientRect();
    const near = (a: number, b: number) => Math.abs(a - b) <= CORNER_SLOP;
    const top = near(rect.top, box.top);
    const bottom = near(rect.bottom, box.bottom);
    const left = near(rect.left, box.left);
    const right = near(rect.right, box.right);
    const at = {
      TopLeft: top && left,
      TopRight: top && right,
      BottomRight: bottom && right,
      BottomLeft: bottom && left,
    };
    CORNERS.forEach((corner) => {
      if (at[corner]) ends[corner] = Math.max(ends[corner], radii[corner] / 2);
    });
  });
  return ends;
};

// The part of the scroller's padding box that is on screen.
const getVisibleBox = ({ el, axes, clips, rounded }: IActive): IBox => {
  const rect = el.getBoundingClientRect();
  const box = {
    top: Math.max(rect.top + el.clientTop, 0),
    left: Math.max(rect.left + el.clientLeft, 0),
    bottom: Math.min(rect.top + el.clientTop + el.clientHeight, window.innerHeight),
    right: Math.min(rect.left + el.clientLeft + el.clientWidth, window.innerWidth),
    corner: axes.x && axes.y ? HIT : 0,
  };
  clips.forEach((clip) => {
    const clipRect = clip.getBoundingClientRect();
    box.top = Math.max(box.top, clipRect.top);
    box.left = Math.max(box.left, clipRect.left);
    box.bottom = Math.min(box.bottom, clipRect.bottom);
    box.right = Math.min(box.right, clipRect.right);
  });
  return { ...box, ends: getEnds(rounded, box) };
};

const getThumb = (bar: HTMLElement) => bar.firstElementChild as HTMLElement;

// Places the track over the scroller's edge and sizes the thumb. The thumb's offset along
// the track comes from the scroll timeline, or from `follow` where that is unsupported.
const measureY = (bar: HTMLElement, { el, rtl }: IActive, box: IBox): IMetrics => {
  const start = rtl ? box.ends.TopLeft : box.ends.TopRight;
  const end = rtl ? box.ends.BottomLeft : box.ends.BottomRight;
  const track = Math.max(box.bottom - box.top - start - end - box.corner, 0);
  const length = Math.min(track, Math.max(MIN_THUMB, (track * el.clientHeight) / el.scrollHeight));
  const left = rtl ? box.left + INSET : box.right - INSET - HIT;
  bar.style.width = `${HIT}px`;
  bar.style.height = `${track}px`;
  bar.style.transform = `translate(${left}px, ${box.top + start}px)`;
  bar.toggleAttribute('data-rtl', rtl);
  getThumb(bar).style.height = `${length}px`;
  return { travel: track - length, max: el.scrollHeight - el.clientHeight };
};

const measureX = (bar: HTMLElement, { el, rtl }: IActive, box: IBox): IMetrics => {
  const { BottomLeft: start, BottomRight: end } = box.ends;
  const track = Math.max(box.right - box.left - start - end - box.corner, 0);
  const length = Math.min(track, Math.max(MIN_THUMB, (track * el.clientWidth) / el.scrollWidth));
  const left = rtl ? box.left + start + box.corner : box.left + start;
  bar.style.width = `${track}px`;
  bar.style.height = `${HIT}px`;
  bar.style.transform = `translate(${left}px, ${box.bottom - INSET - HIT}px)`;
  bar.toggleAttribute('data-rtl', rtl);
  getThumb(bar).style.width = `${length}px`;
  return { travel: track - length, max: el.scrollWidth - el.clientWidth };
};

/**
 * macOS draws overlay scrollbars only while a trackpad is the sole pointer: once a mouse is
 * connected every scroller gets a classic bar that stays on screen and takes width. global.css
 * hides native bars for fine pointers, and this draws a thumb for whichever element last
 * scrolled, shown while it scrolls and faded out once it rests, so a mouse behaves like a
 * trackpad. The thumb can be dragged while it shows.
 *
 * Rects are read only when a scroller becomes active or shows again, every
 * REMEASURE_INTERVAL while it scrolls, and when it resizes. In between, the thumb rides the
 * scroller's scroll timeline (see global.css), so it keeps up with the content even while
 * the main thread is busy.
 */
export const OverlayScrollbar = () => {
  const [enabled, setEnabled] = useState(false);
  const barsRef = useRef<Record<Axis, HTMLDivElement | null>>({ x: null, y: null });

  useEffect(() => {
    const query = window.matchMedia('(pointer: fine)');
    const update = () => setEnabled(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const bars = barsRef.current;
    const scrollDriven = CSS.supports('animation-timeline: scroll()');
    const metrics: Record<Axis, IMetrics> = { x: { travel: 0, max: 0 }, y: { travel: 0, max: 0 } };
    let active: IActive | undefined;
    let drag: IDrag | undefined;
    let visible = false;
    let hovered = false;
    let measuredAt = 0;
    let frame = 0;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const setVisible = (next: boolean) => {
      visible = next;
      AXES.forEach((axis) => {
        bars[axis]?.toggleAttribute('data-visible', next && Boolean(active?.axes[axis]));
      });
    };

    const scheduleHide = () => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!hovered && !drag) setVisible(false);
      }, HIDE_DELAY);
    };

    // Without scroll timelines the thumb follows the scroll from here. RTL scrollLeft runs
    // from 0 down to -max, which moves the right-anchored thumb leftwards.
    const follow = () => {
      frame = 0;
      if (!active) return;
      const { el } = active;
      AXES.forEach((axis) => {
        const bar = bars[axis];
        const { travel, max } = metrics[axis];
        if (!bar || max <= 0) return;
        const offset = (travel * (axis === 'y' ? el.scrollTop : el.scrollLeft)) / max;
        getThumb(bar).style.transform =
          axis === 'y' ? `translateY(${offset}px)` : `translateX(${offset}px)`;
      });
    };

    const resizeObserver = new ResizeObserver(() => measure());

    const release = () => {
      if (active) deactivate(active);
      active = undefined;
      resizeObserver.disconnect();
      setVisible(false);
    };

    const measure = () => {
      if (!active) return;
      if (!active.el.isConnected) return release();
      measuredAt = performance.now();
      const box = getVisibleBox(active);
      if (bars.y && active.axes.y) metrics.y = measureY(bars.y, active, box);
      if (bars.x && active.axes.x) metrics.x = measureX(bars.x, active, box);
      if (!scrollDriven) follow();
    };

    const switchTo = (el: Element) => {
      const next = activate(el);
      if (!next) return false;
      if (active) deactivate(active);
      resizeObserver.disconnect();
      active = next;
      resizeObserver.observe(next.el);
      return true;
    };

    const onScroll = (event: Event) => {
      const target =
        event.target instanceof Document ? event.target.scrollingElement : event.target;
      if (!(target instanceof Element)) return;
      if (target !== active?.el) {
        if (drag || !switchTo(target)) return;
        measure();
      } else if (!visible || performance.now() - measuredAt > REMEASURE_INTERVAL) {
        measure();
      } else if (!scrollDriven && !frame) {
        frame = requestAnimationFrame(follow);
      }
      // Shown only once placed, so a bar never flashes where the previous scroller had it.
      setVisible(true);
      scheduleHide();
    };

    const onPointerDown = (axis: Axis) => (event: PointerEvent) => {
      const bar = bars[axis];
      if (!bar || !active || event.button !== 0) return;
      event.preventDefault();
      getThumb(bar).setPointerCapture(event.pointerId);
      bar.toggleAttribute('data-dragging', true);
      const { travel, max } = metrics[axis];
      drag = {
        axis,
        pointer: axis === 'y' ? event.clientY : event.clientX,
        scroll: axis === 'y' ? active.el.scrollTop : active.el.scrollLeft,
        // How far the content scrolls per pixel the thumb is dragged.
        ratio: travel > 0 ? max / travel : 0,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drag || !active) return;
      const delta = (drag.axis === 'y' ? event.clientY : event.clientX) - drag.pointer;
      const scroll = drag.scroll + delta * drag.ratio;
      if (drag.axis === 'y') active.el.scrollTop = scroll;
      else active.el.scrollLeft = scroll;
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!drag) return;
      const bar = bars[drag.axis];
      if (bar) {
        getThumb(bar).releasePointerCapture(event.pointerId);
        bar.removeAttribute('data-dragging');
      }
      drag = undefined;
      scheduleHide();
    };

    const onPointerEnter = () => {
      hovered = true;
    };

    const onPointerLeave = () => {
      hovered = false;
      scheduleHide();
    };

    const cleanups = AXES.map((axis) => {
      const bar = bars[axis];
      if (!bar) return () => undefined;
      const thumb = getThumb(bar);
      const down = onPointerDown(axis);
      thumb.addEventListener('pointerdown', down);
      thumb.addEventListener('pointermove', onPointerMove);
      thumb.addEventListener('pointerup', onPointerUp);
      thumb.addEventListener('pointercancel', onPointerUp);
      thumb.addEventListener('pointerenter', onPointerEnter);
      thumb.addEventListener('pointerleave', onPointerLeave);
      return () => {
        thumb.removeEventListener('pointerdown', down);
        thumb.removeEventListener('pointermove', onPointerMove);
        thumb.removeEventListener('pointerup', onPointerUp);
        thumb.removeEventListener('pointercancel', onPointerUp);
        thumb.removeEventListener('pointerenter', onPointerEnter);
        thumb.removeEventListener('pointerleave', onPointerLeave);
      };
    });

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      cleanups.forEach((cleanup) => cleanup());
      cancelAnimationFrame(frame);
      clearTimeout(hideTimer);
      release();
    };
  }, [enabled]);

  if (!enabled) return null;
  return createPortal(
    <>
      {(['y', 'x'] as const).map((axis) => (
        <div
          key={axis}
          ref={(el) => {
            barsRef.current[axis] = el;
          }}
          className="overlay-scrollbar"
          data-axis={axis}
          aria-hidden
        >
          {/* The timeline named on the active scroller (SCROLL_TIMELINE); see global.css. */}
          <div
            className="overlay-scrollbar-thumb"
            style={{ animationTimeline: `--overlay-scroll-${axis}` }}
          />
        </div>
      ))}
    </>,
    document.body
  );
};
