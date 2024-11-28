/* eslint-disable import/no-duplicates */
import type { EventDropArg, EventInput, EventMountArg } from '@fullcalendar/core/index.js';
import enGbLocale from '@fullcalendar/core/locales/en-gb';
import frLocale from '@fullcalendar/core/locales/fr';
import jaLocale from '@fullcalendar/core/locales/ja';
import ruLocale from '@fullcalendar/core/locales/ru';
import zhCnLocale from '@fullcalendar/core/locales/zh-cn';
import dayGridPlugin from '@fullcalendar/daygrid';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import interactionPlugin from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import { FieldKeyType } from '@teable/core';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Loader2 } from '@teable/icons';
import { updateRecord } from '@teable/openapi';
import { AppContext, CalendarDailyCollectionContext } from '@teable/sdk/context';
import { useTableId } from '@teable/sdk/hooks';
import { Record } from '@teable/sdk/model';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Calendar as DatePicker,
  cn,
} from '@teable/ui-lib/shadcn';
import { addDays, subDays, format, set } from 'date-fns';
import { enUS, zhCN, ja, ru, fr } from 'date-fns/locale';
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import { useTranslation } from 'next-i18next';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { EventListContainer } from '../components/EventListContainer';
import { EventMenu } from '../components/EventMenu';
import { useCalendar, useEventMenuStore } from '../hooks';
import { getColorByConfig, getDateByTimezone, getEventTitle } from '../util';

const ADD_EVENT_BUTTON_CLASS_NAME = 'calendar-add-event-button';
const MORE_LINK_TEXT_CLASS_NAME = 'calendar-custom-more-link-text';

const FULL_CALENDAR_LOCALE_MAP = {
  zh: zhCnLocale,
  en: enGbLocale,
  ja: jaLocale,
  ru: ruLocale,
  fr: frLocale,
};

const DATE_PICKER_LOCAL_MAP = {
  zh: zhCN,
  en: enUS,
  ja: ja,
  ru: ru,
  fr: fr,
};

export interface ICalendarProps {
  dateRange?: { startDate: string; endDate: string };
  setDateRange?: (dateRange: { startDate: string; endDate: string }) => void;
}

export const Calendar = (props: ICalendarProps) => {
  const { dateRange, setDateRange } = props;
  const {
    titleField,
    startDateField,
    endDateField,
    colorConfig,
    colorField,
    permission,
    setExpandRecordId,
  } = useCalendar();
  const tableId = useTableId();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const { lang = 'en' } = useContext(AppContext);
  const calendarDailyCollection = useContext(CalendarDailyCollectionContext);
  const { openEventMenu } = useEventMenuStore();
  const [positionDate, setPositionDate] = useState<Date>();
  const [moreLinkDate, setMoreLinkDate] = useState<Date>();
  const [title, setTitle] = useState<string>('');

  const calendarRef = useRef<FullCalendar>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { isComputed: isStartComputed } = startDateField ?? {};
  const { eventCreatable, eventResizable, eventDraggable } = permission ?? {};

  useEffect(() => {
    if (!calendarRef.current) return;

    const calendarApi = calendarRef.current.getApi();

    const resizeObserver = new ResizeObserver(() => {
      calendarApi.updateSize();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      if (containerRef.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        resizeObserver.unobserve(containerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || !eventCreatable) return;

    const addButtonToDay = (dayEl: HTMLElement) => {
      if (dayEl.querySelector(`.${ADD_EVENT_BUTTON_CLASS_NAME}`)) return;

      const dateAttr = dayEl.getAttribute('data-date');
      if (!dateAttr) return;

      const date = new Date(dateAttr);
      dayEl.style.position = 'relative';

      const button = document.createElement('button');
      button.className = `${ADD_EVENT_BUTTON_CLASS_NAME} invisible absolute left-[2px] top-[2px] z-10 rounded-md bg-secondary text-secondary-foreground size-6 hover:bg-secondary/80 text-lg leading-[0.75] pb-[2px]`;
      button.textContent = '+';

      button.onclick = async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!tableId || !startDateField || !endDateField) return;

        const { timeZone } = startDateField.options.formatting;
        const newDate = set(date, { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 });
        const newDateStr = zonedTimeToUtc(newDate, timeZone).toISOString();

        const { data } = await Record.createRecords(tableId, {
          fieldKeyType: FieldKeyType.Id,
          records: [
            {
              fields: {
                [startDateField.id]: newDateStr,
                [endDateField.id]: newDateStr,
              },
            },
          ],
        });

        setExpandRecordId?.(data.records[0].id);
      };

      dayEl.appendChild(button);

      dayEl.addEventListener('mouseover', (e: MouseEvent) => {
        if (e.target instanceof Element && e.target.classList.contains('fc-daygrid-day-frame')) {
          button.classList.remove('invisible');
        }
      });

      dayEl.addEventListener('mouseleave', () => {
        button.classList.add('invisible');
      });
    };

    const dayElements = containerRef.current.querySelectorAll('.fc-day');
    dayElements.forEach((dayEl) => {
      addButtonToDay(dayEl as HTMLElement);
    });

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.classList.contains('fc-day')) {
            addButtonToDay(node);
          }
        });
      });
    });

    observer.observe(containerRef.current, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      document
        .querySelectorAll(`.${ADD_EVENT_BUTTON_CLASS_NAME}`)
        .forEach((button) => button.remove());
    };
  }, [tableId, endDateField, startDateField, eventCreatable, dateRange, setExpandRecordId]);

  const onDatesChanged = (data: { start: Date; end: Date }) => {
    const { start, end } = data;

    if (calendarRef.current) {
      setTitle(calendarRef.current.getApi().view.title);
    }

    const startStr = start.toISOString();
    const endStr = end.toISOString();

    setDateRange?.({
      startDate: startStr,
      endDate: endStr,
    });
  };

  const isLoading = startDateField && endDateField && !calendarDailyCollection;
  const { countMap, records = [] } = calendarDailyCollection ?? {};

  const events = useMemo(() => {
    return records
      .map((r) => {
        if (!titleField || !startDateField || !endDateField) return;

        const title = r.fields[titleField.id];
        const start = r.fields[startDateField.id];
        const end = r.fields[endDateField.id];
        const { timeZone } = startDateField.options.formatting;

        const { color: textColor, backgroundColor } = getColorByConfig(
          r as unknown as Record,
          colorConfig,
          colorField
        );
        const endDate = end ? addDays(new Date(end as string), 1).toISOString() : undefined;

        return {
          id: r.id,
          title: getEventTitle(
            titleField.cellValue2String(title) || t('sdk:common.unnamedRecord'),
            start as string,
            startDateField
          ),
          start: start ? utcToZonedTime(new Date(start as string), timeZone) : undefined,
          end: endDate ? utcToZonedTime(new Date(endDate), timeZone) : undefined,
          textColor,
          backgroundColor,
          allDay: true,
          meta: {
            start,
            end,
          },
        };
      })
      .filter(Boolean) as EventInput[];
  }, [records, colorConfig, titleField, colorField, startDateField, endDateField, t]);

  useEffect(() => {
    if (!countMap) return;

    const updateMoreLinkText = () => {
      const elements = document.getElementsByClassName(MORE_LINK_TEXT_CLASS_NAME);
      Array.from(elements).forEach((element) => {
        const dayEl = element.closest('.fc-day') as HTMLElement;
        const date = dayEl?.dataset.date;
        if (date && countMap[date]) {
          element.textContent = t('table:calendar.moreLinkText', { count: countMap[date] });
        }
      });
    };

    updateMoreLinkText();

    const observer = new MutationObserver(updateMoreLinkText);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
    });

    return () => observer.disconnect();
  }, [countMap, t]);

  const onEventDidMount = (info: EventMountArg) => {
    const element = info.el as HTMLElement;

    element.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const relativeX = e.clientX - containerRect.left;
      const relativeY = e.clientY - containerRect.top;

      openEventMenu({
        eventId: info.event.id,
        permission,
        position: {
          x: relativeX,
          y: relativeY,
        },
      });
    });
  };

  const onEventResize = (info: EventResizeDoneArg) => {
    const { event, startDelta, endDelta } = info;

    if (!tableId || !startDateField || !endDateField) return;

    const { timeZone } = startDateField.options.formatting;

    // resize start date
    if (startDelta.days !== 0) {
      const newDate = getDateByTimezone(
        new Date(event.startStr),
        timeZone,
        event.extendedProps.meta.start
      );

      updateRecord(tableId, event.id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [startDateField.id]: newDate,
          },
        },
      });
    }

    // resize end date
    if (endDelta.days !== 0) {
      const newDate = getDateByTimezone(
        subDays(new Date(event.endStr), 1),
        timeZone,
        event.extendedProps.meta.end
      );

      updateRecord(tableId, event.id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [endDateField.id]: newDate,
          },
        },
      });
    }
  };

  const onEventDrop = (info: EventDropArg) => {
    const { event } = info;

    if (!tableId || !startDateField || !endDateField) return;

    const { timeZone } = startDateField.options.formatting;

    const { start, end } = event.extendedProps.meta;
    const newStart = getDateByTimezone(new Date(event.startStr), timeZone, start);
    const newEnd = end
      ? getDateByTimezone(subDays(new Date(event.endStr), 1), timeZone, end)
      : undefined;

    updateRecord(tableId, event.id, {
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: {
          [startDateField.id]: newStart,
          ...(newEnd && { [endDateField.id]: newEnd }),
        },
      },
    });
  };

  const onPrevHandler = () => {
    const calendarApi = calendarRef.current?.getApi();
    calendarApi?.prev();
  };

  const onNextHandler = () => {
    const calendarApi = calendarRef.current?.getApi();
    calendarApi?.next();
  };

  const onTodayHandler = () => {
    const calendarApi = calendarRef.current?.getApi();
    calendarApi?.today();
  };

  const onDateSelect = (date: Date | undefined) => {
    if (!date || !calendarRef.current) return;
    const calendarApi = calendarRef.current.getApi();
    calendarApi.gotoDate(date);
    setPositionDate(date);
  };

  useEffect(() => {
    if (calendarRef.current) {
      setTitle(calendarRef.current.getApi().view.title);
    }
  }, []);

  return (
    <div className="relative flex size-full flex-col overflow-hidden p-4 pt-2" ref={containerRef}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="flex items-center text-xl font-semibold">
            {title || calendarRef.current?.getApi().view.title}
            <Loader2
              className={cn(
                'ml-1 size-5 animate-spin transition-opacity duration-1000',
                isLoading ? 'opacity-100' : 'opacity-0'
              )}
            />
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <CalendarIcon className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <DatePicker
                mode="single"
                locale={DATE_PICKER_LOCAL_MAP[lang as keyof typeof DATE_PICKER_LOCAL_MAP]}
                initialFocus
                selected={positionDate}
                defaultMonth={positionDate}
                onSelect={onDateSelect}
              />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="sm" className="text-sm" onClick={onTodayHandler}>
            {t('sdk:editor.date.today')}
          </Button>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={onPrevHandler}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={onNextHandler}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-x-auto overflow-y-hidden sm:overflow-hidden">
        <div className="size-full min-w-[640px]">
          <FullCalendar
            ref={calendarRef}
            locale={FULL_CALENDAR_LOCALE_MAP[lang as keyof typeof FULL_CALENDAR_LOCALE_MAP]}
            initialView="dayGridMonth"
            plugins={[dayGridPlugin, interactionPlugin]}
            height="100%"
            dayMaxEventRows
            dayHeaderClassNames="!py-1"
            headerToolbar={false}
            events={events}
            eventClassNames="outline-none text-xs px-2 h-5 border-none leading-[18px]"
            eventDurationEditable={eventResizable}
            eventResizableFromStart={eventResizable && !isStartComputed}
            editable={eventDraggable}
            datesSet={onDatesChanged}
            eventDidMount={onEventDidMount}
            eventResize={onEventResize}
            eventDrop={onEventDrop}
            eventClick={(info) => setExpandRecordId(info.event.id)}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            eventOrder={(a: any, b: any) => {
              if (a.start < b.start) return -1;
              if (a.start > b.start) return 1;
              return 0;
            }}
            moreLinkClick={(info) => {
              setMoreLinkDate(info.date);
              return 'popover';
            }}
            moreLinkContent={() => {
              return (
                <Button
                  size="xs"
                  variant="ghost"
                  className="h-[18px] w-full gap-1 rounded-sm text-xs font-normal text-muted-foreground"
                >
                  <span className={MORE_LINK_TEXT_CLASS_NAME}>{t('notification.showMore')}</span>
                </Button>
              );
            }}
          />
        </div>
      </div>
      {moreLinkDate && (
        <Dialog
          open={Boolean(moreLinkDate)}
          onOpenChange={(open) => !open && setMoreLinkDate(undefined)}
        >
          <DialogContent
            container={containerRef.current}
            className="max-h-4/5 flex h-[520px] max-w-xl flex-col p-4"
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <DialogHeader className="px-2 py-1">
              <DialogTitle>{format(moreLinkDate, 'yyyy-MM-dd')}</DialogTitle>
            </DialogHeader>
            <EventListContainer date={moreLinkDate} />
          </DialogContent>
        </Dialog>
      )}
      <EventMenu />
    </div>
  );
};
