'use client'

import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import listPlugin from '@fullcalendar/list'
import Loading from '@src/app/loading'
import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence'
import { useState, useEffect, useRef, useCallback } from 'react'
import ical from 'ical.js'
import { motion, AnimatePresence } from 'framer-motion'
import { classNames, generateColors } from '@src/utils'

const variants = {
  hidden: { opacity: 0, x: 0, y: -20 },
  enter: { opacity: 1, x: 0, y: 0 },
}

function extractShowTitleAndDetails(eventTitle) {
  const regex = /^(.*?)\s*-\s*(.+)$/
  const match = eventTitle.match(regex)

  if (match && match[1] && match[2]) {
    return {
      showTitle: match[1].trim(),
      showDetails: match[2].trim(),
    }
  }

  return {
    showTitle: eventTitle.trim(),
    showDetails: '',
  }
}

// Helper function to parse calendar data from Sonarr and Radarr
function parseCalendarData(data, sourceType) {
  // The calendar route returns a JSON error body (e.g. {"error":"Failed to sync data"})
  // when the upstream Sonarr/Radarr fetch fails. Feeding that to ical.parse throws deep
  // inside _handleContentLine because there is no VCALENDAR component to attach the line
  // to. Guard on the iCal sentinel so non-calendar payloads never reach the parser.
  if (typeof data !== 'string' || !data.includes('BEGIN:VCALENDAR')) {
    if (data) {
      console.warn(`Skipping ${sourceType} calendar: response was not iCal data`)
    }
    return []
  }

  let calendarData
  try {
    calendarData = new ical.Component(ical.parse(data))
  } catch (error) {
    console.warn(`Could not parse ${sourceType} calendar feed:`, error?.message ?? error)
    return []
  }

  // Map each VEVENT independently so a single malformed event can't discard the whole feed.
  return calendarData
    .getAllSubcomponents('vevent')
    .map((vevent) => {
      const title = vevent.getFirstPropertyValue('summary')
      const dtstart = vevent.getFirstPropertyValue('dtstart')
      // A summary and a start date are the minimum needed to render an event.
      if (!title || !dtstart) return null

      const dtend = vevent.getFirstPropertyValue('dtend')
      const showTitle = title.split(' - ')[0] // Show/movie title, used to derive a stable color
      const colors = generateColors(showTitle) // Generate unique colors based on the show or movie title
      return {
        title,
        start: dtstart.toJSDate(),
        end: dtend ? dtend.toJSDate() : dtstart.toJSDate(), // Sonarr feeds may omit DTEND
        backgroundColor: colors.backgroundColor,
        fontColor: colors.fontColor,
        sourceType: sourceType,
      }
    })
    .filter(Boolean)
}

export default function ReleaseCalendar({
  aspectRatio = 1.6,
  containerClasses = 'w-full lg:w-3/5 mx-auto mt-4',
}) {
  const [isLoading, setIsLoading] = useState(true)
  const [events, setEvents] = useState([])
  const calendarRef = useRef(null)
  const isMountedRef = useRef(false)
  const [initialView, setInitialView] = useState('dayGridWeek')

  const updateInitialView = useCallback(() => {
    let newView
    if (window.innerWidth < 768) {
      newView = 'dayGridDay'
    } else if (window.innerWidth >= 768 && window.innerWidth < 1024) {
      newView = 'dayGridWeek'
    } else if (window.innerWidth >= 1024) {
      newView = 'dayGridMonth'
    }

    if (newView !== initialView) {
      setInitialView(newView)
    }
  }, [initialView])

  const callback = useCallback(
    (arg) => {
      if (isMountedRef.current && calendarRef.current?.calendar) {
        // for large screens you can use a different aspect ratio
        if (
          window.innerWidth < 768 &&
          calendarRef.current.calendar.getOption('aspectRatio') !== 1
        ) {
          calendarRef.current.calendar.setOption('aspectRatio', 1)
        } else if (
          window.innerWidth > 768 &&
          window.innerWidth < 1024 &&
          calendarRef.current.calendar.getOption('aspectRatio') !== 1.6
        ) {
          calendarRef.current.calendar.setOption('aspectRatio', 1.6)
        } else if (
          window.innerWidth > 1024 &&
          calendarRef.current.calendar.getOption('aspectRatio') !== 1.8
        ) {
          calendarRef.current.calendar.setOption('aspectRatio', 1.8)
        }
        // set the view type dependent on the screen size
        if (window.innerWidth < 768 && arg.view.type !== 'dayGridDay') {
          calendarRef.current.calendar.changeView('dayGridDay')
        } else if (
          window.innerWidth > 768 &&
          window.innerWidth < 1024 &&
          arg.view.type !== 'dayGridWeek'
        ) {
          calendarRef.current.calendar.changeView('dayGridWeek')
        } else if (window.innerWidth > 1024 && arg.view.type !== 'dayGridMonth') {
          calendarRef.current.calendar.changeView('dayGridMonth')
        }
      }
    },
    [isMountedRef]
  )

  const fetchEvents = async () => {
    try {
      const [sonarr_response, radarr_response] = await Promise.all([
        fetch('/api/authenticated/calendar/sonarr'),
        fetch('/api/authenticated/calendar/radarr'),
      ])

      // Only read a feed's body when it responded OK. On failure the route returns a JSON
      // error body, which is not valid iCal and must never reach the parser.
      const sonarr_data = sonarr_response.ok ? await sonarr_response.text() : ''
      const radarr_data = radarr_response.ok ? await radarr_response.text() : ''

      // Parse Sonarr and Radarr data
      const sonarr_events = parseCalendarData(sonarr_data, 'Sonarr')
      const radarr_events = parseCalendarData(radarr_data, 'Radarr')

      // Group Sonarr events by start time and show title
      const groupedSonarrEvents = sonarr_events.reduce((acc, event) => {
        const startTime = event.start.getTime()
        const showTitle = event.title.split(' - ')[0]
        const key = `${startTime}-${showTitle}`

        if (!acc[key]) {
          acc[key] = {
            ...event,
            showDetails: [event.title.split(' - ').slice(1).join(' - ')],
          }
        } else {
          acc[key].showDetails.push(event.title.split(' - ').slice(1).join(' - '))
        }

        return acc
      }, {})

      // Combine grouped Sonarr events and Radarr events
      const combinedEvents = [...Object.values(groupedSonarrEvents), ...radarr_events]

      setEvents(combinedEvents)
      setIsLoading(false)
    } catch (error) {
      console.error('Error fetching events:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isMountedRef.current) return
    isMountedRef.current = true
    fetchEvents()
    updateInitialView()
  }, [updateInitialView])

  return (
    <PageContentAnimatePresence
      _key={'ReleaseCalendar-Container-AnimationCont'}
      variants={variants}
      transition={{
        type: 'linear',
        duration: 0.45,
      }}
    >
      <div className={classNames(containerClasses)}>
        <h4 className="text-center text-2xl font-bold text-white">Release Calendar</h4>
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div
              variants={variants}
              initial="hidden"
              exit="hidden"
              animate="enter"
              transition={{
                type: 'linear',
                delay: 0.3,
                duration: 0.45,
              }}
              key={'ReleaseCalendar-Loading-AnimationCont'}
            >
              <Loading fullscreenClasses={false} />
            </motion.div>
          ) : (
            <motion.div
              variants={variants}
              initial="hidden"
              exit="hidden"
              animate="enter"
              transition={{
                type: 'linear',
                delay: 0.3,
                duration: 1.45,
              }}
              key={'ReleaseCalendar-FullCalendar-AnimationCont'}
              data-testid="full-calendar"
            >
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, listPlugin]}
                initialView={initialView}
                weekends={true}
                events={events}
                eventContent={renderEventContent}
                headerToolbar={{
                  left: 'today prev,next',
                  center: 'title',
                  right: 'dayGridMonth,dayGridWeek,dayGridDay', // user can switch between the two
                }}
                windowResize={callback}
                aspectRatio={aspectRatio}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </PageContentAnimatePresence>
  )
}

export function renderEventContent(eventInfo) {
  const { showTitle, showDetails } = extractShowTitleAndDetails(eventInfo.event.title)
  const backgroundColor = eventInfo.event.backgroundColor
  const fontColor = eventInfo.event.extendedProps.fontColor
  const isGroupedSonarrEvent = Array.isArray(eventInfo.event.extendedProps.showDetails)

  // Extract RGB values from backgroundColor
  const rgbValues = backgroundColor.slice(5, -1).split(',').map(Number)

  // Calculate the darker background color for episodes
  const episodeBackgroundColor = isGroupedSonarrEvent
    ? `rgba(${rgbValues[0] * 0.8}, ${rgbValues[1] * 0.8}, ${rgbValues[2] * 0.8}, 0.8)`
    : backgroundColor

  return (
    <div
      style={{
        backgroundColor: backgroundColor,
        color: fontColor,
      }}
      className="w-full rounded-md bg-opacity-20 flex flex-col lg:flex-row"
    >
      <b className="self-center px-1 font-semibold">{eventInfo.timeText}</b>
      <i className="w-full flex flex-col border-t border-t-gray-600 lg:border-l lg:border-l-gray-600">
        <span
          className={classNames(
            'w-full text-center font-semibold',
            isGroupedSonarrEvent ? 'border-b border-b-gray-600' : ''
          )}
        >
          {showTitle}
        </span>
        {isGroupedSonarrEvent ? (
          eventInfo.event.extendedProps.showDetails.map((detail, index) => (
            <div
              key={index}
              className="flex flex-col"
              style={{ backgroundColor: episodeBackgroundColor }}
            >
              {index !== 0 && <div className="border-t border-t-gray-600 mb-1"></div>}
              <span className="text-center">{detail}</span>
            </div>
          ))
        ) : (
          <span className="text-center">{showDetails}</span>
        )}
      </i>
    </div>
  )
}
