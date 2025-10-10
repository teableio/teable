export const scrollToTarget = (targetElement: HTMLElement) => {
  const leftScrollContainer = document.querySelector('.setting-page-left-container') as HTMLElement;
  if (leftScrollContainer) {
    const containerRect = leftScrollContainer.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const scrollTop = leftScrollContainer.scrollTop + (targetRect.top - containerRect.top);

    leftScrollContainer.scrollTo({
      top: scrollTop,
      behavior: 'smooth',
    });
  } else {
    targetElement?.scrollIntoView({ behavior: 'smooth' });
  }
};
