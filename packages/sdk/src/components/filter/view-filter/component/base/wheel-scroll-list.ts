export const scrollListByWheel = (event: WheelEvent, list: HTMLElement | null) => {
  if (!list || event.deltaY === 0 || list.scrollHeight <= list.clientHeight) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  list.scrollTop += event.deltaY;
};
