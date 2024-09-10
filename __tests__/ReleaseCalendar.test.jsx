/**
 * @jest-environment jsdom
 * @ts-nocheck
 */
//import '@testing-library/jest-dom'
import { jest, describe, beforeEach, it } from '@jest/globals'
import { render, screen, waitFor, expect } from '@testing-library/react'
import ReleaseCalendar from '@components/Calendar/ReleaseCalendar'
import '../__mocks__/intersectionObserverMock'

jest.mock('@fullcalendar/react', () => {
  return function DummyFullCalendar(props) {
    return <div data-testid="full-calendar">{JSON.stringify(props)}</div>
  }
})

jest.mock('ical.js')

global.fetch = jest.fn()

const currentDate = new Date()
const tomorrow = new Date(currentDate)
tomorrow.setDate(currentDate.getDate() + 1)

const mockSonarrData = `BEGIN:VCALENDAR
  NAME:Sonarr TV Schedule
  PRODID:-//github.com/rianjs/ical.net//NONSGML ical.net 4.0//EN
  VERSION:2.0
  X-WR-CALNAME:Sonarr TV Schedule
  BEGIN:VEVENT
  CATEGORIES:FXX
  DESCRIPTION:A voyage home gets interrupted by an alien battle cruiser carrying precious cargo.
  DTEND:${tomorrow.toISOString().replace(/[-:]/g, '').split('.')[0]}Z
  DTSTAMP:${currentDate.toISOString().replace(/[-:]/g, '').split('.')[0]}Z
  DTSTART:${currentDate.toISOString().replace(/[-:]/g, '').split('.')[0]}Z
  SEQUENCE:0
  STATUS:CONFIRMED
  SUMMARY:Archer (2009) - 10x07 - Space Pirates
  UID:NzbDrone_episode_4617
  END:VEVENT
  END:VCALENDAR
`

const mockRadarrData = `BEGIN:VCALENDAR
  NAME:Radarr Movies Calendar
  PRODID:-//github.com/rianjs/ical.net//NONSGML ical.net 4.0//EN
  VERSION:2.0
  X-WR-CALNAME:Radarr Movies Calendar
  BEGIN:VEVENT
  CATEGORIES:BoulderLight Pictures
  DESCRIPTION:In town for a job interview, a young woman arrives at her Airbnb late at night only to find that it has been mistakenly double-booked and a strange man is already staying there. Against her better judgement, she decides to stay the night anyway.
  DTEND;VALUE=DATE:${tomorrow.toISOString().slice(0, 10).replace(/-/g, '')}
  DTSTAMP:${currentDate.toISOString().replace(/[-:]/g, '').split('.')[0]}Z
  DTSTART;VALUE=DATE:${currentDate.toISOString().slice(0, 10).replace(/-/g, '')}
  SEQUENCE:0
  STATUS:CONFIRMED
  SUMMARY:Barbarian (Theatrical Release)
  UID:Radarr_movie_13_cinemas
  END:VEVENT
  END:VCALENDAR
`

describe('ReleaseCalendar', () => {
  beforeEach(() => {
    fetch.mockClear()
    fetch.mockImplementation((url) => {
      if (url.includes('sonarr')) {
        return Promise.resolve({ text: () => Promise.resolve(mockSonarrData) })
      } else if (url.includes('radarr')) {
        return Promise.resolve({ text: () => Promise.resolve(mockRadarrData) })
      }
      return Promise.reject(new Error('Invalid URL'))
    })
    global.innerWidth = 1024
  })

  it('renders the Release Calendar heading', () => {
    render(<ReleaseCalendar />)
    const heading = screen.getByText('Release Calendar')
    expect(heading).toBeInTheDocument()
  })

  it('displays loading state initially', () => {
    render(<ReleaseCalendar />)
    const loadingElement = screen.getByTestId('loading')
    expect(loadingElement).toBeInTheDocument()
  })

  it('fetches and displays events from Sonarr and Radarr', async () => {
    render(<ReleaseCalendar />)

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
      expect(screen.getByTestId('full-calendar')).toBeInTheDocument()
    })

    const calendarContent = screen.getByTestId('full-calendar').textContent
    const calendarProps = JSON.parse(calendarContent)

    expect(calendarProps.initialView).toBe('dayGridMonth')
    expect(calendarProps.events).toHaveLength(2)
    expect(calendarProps.events[0].title).toBe('Archer (2009) - 10x07 - Space Pirates')
    expect(calendarProps.events[1].title).toBe('Barbarian (Theatrical Release)')
  })

  it('handles fetch errors gracefully', async () => {
    console.error = jest.fn()
    fetch.mockRejectedValue(new Error('Fetch error'))

    render(<ReleaseCalendar />)

    await waitFor(() => {
      expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
      expect(screen.getByTestId('full-calendar')).toBeInTheDocument()
    })

    expect(console.error).toHaveBeenCalledWith('Error fetching events:', expect.any(Error))
  })
})
