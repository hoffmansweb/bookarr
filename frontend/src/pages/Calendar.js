import React, { useState, useEffect } from 'react';
import { calendarAPI } from '../services/api';
import { toast } from 'react-toastify';
import './Calendar.css';

// new Date('2024-01-01') is parsed as UTC midnight, which is the previous day
// in US timezones, so releases showed up in the wrong day/month. Parse
// YYYY-MM-DD as a local date instead.
const parseLocalDate = (str) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str || '');
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(str);
};

const toDateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const Calendar = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDayEvents, setSelectedDayEvents] = useState([]);
  const [selectedDateKey, setSelectedDateKey] = useState('');

  useEffect(() => {
    fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate]);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      
      // Calculate start and end range for current month +/- 1 month for buffer
      const start = new Date(year, month - 2, 1).toISOString();
      const end = new Date(year, month + 1, 0).toISOString();

      const { data } = await calendarAPI.getEvents({ start, end });
      setEvents(data);
      
      // Clear selected day events on month change
      setSelectedDayEvents([]);
      setSelectedDateKey('');
    } catch (error) {
      console.error('Failed to fetch calendar events:', error);
      toast.error('Failed to load release calendar');
    } finally {
      setLoading(false);
    }
  };

  const getDaysInMonth = (year, month) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year, month) => {
    return new Date(year, month, 1).getDay();
  };

  const handlePrevMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const formatMonthYear = (date) => {
    return date.toLocaleDateString('default', { month: 'long', year: 'numeric' });
  };

  // Generate calendar days
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDayIndex = getFirstDayOfMonth(year, month);
  
  const calendarCells = [];
  
  // Add empty placeholders for previous month padding
  for (let i = 0; i < firstDayIndex; i++) {
    calendarCells.push({ key: `empty-${i}`, day: null, dateStr: null });
  }

  // Add days of current month
  for (let day = 1; day <= daysInMonth; day++) {
    const monthStr = String(month + 1).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    const dateStr = `${year}-${monthStr}-${dayStr}`;
    calendarCells.push({ key: `day-${day}`, day, dateStr });
  }

  const handleDayClick = (cell) => {
    if (!cell.dateStr) return;
    
    const dayEvents = events.filter(e => e.date === cell.dateStr);
    setSelectedDayEvents(dayEvents);
    setSelectedDateKey(cell.dateStr);
  };

  const todayKey = toDateKey(new Date());

  // Only events in the displayed month, used for the "All Month Releases" list
  const monthEvents = events.filter(e => {
    const evDate = parseLocalDate(e.date);
    return evDate.getFullYear() === year && evDate.getMonth() === month;
  });

  // Group events by date string for rendering badges in calendar grid
  const eventsByDate = events.reduce((acc, event) => {
    if (!acc[event.date]) acc[event.date] = [];
    acc[event.date].push(event);
    return acc;
  }, {});

  return (
    <div className="calendar-page animate-fade-in">
      <div className="page-header">
        <h1>Calendar</h1>
        <div className="calendar-controls">
          <button onClick={handlePrevMonth} className="ctrl-btn">◀ Prev</button>
          <button onClick={handleToday} className="ctrl-btn today-btn">Today</button>
          <button onClick={handleNextMonth} className="ctrl-btn">Next ▶</button>
        </div>
      </div>

      <div className="calendar-container glass-panel">
        <div className="calendar-header-title">
          <h2>{formatMonthYear(currentDate)}</h2>
        </div>

        <div className="weekday-header">
          <div>Sun</div>
          <div>Mon</div>
          <div>Tue</div>
          <div>Wed</div>
          <div>Thu</div>
          <div>Fri</div>
          <div>Sat</div>
        </div>

        {loading ? (
          <div className="loading" style={{ minHeight: '300px' }}>Loading releases...</div>
        ) : (
          <div className="calendar-grid">
            {calendarCells.map((cell, index) => {
              const hasEvents = cell.dateStr && eventsByDate[cell.dateStr]?.length > 0;
              const cellEvents = cell.dateStr ? eventsByDate[cell.dateStr] : [];
              const isToday = cell.dateStr === todayKey;
              const isSelected = cell.dateStr === selectedDateKey;

              return (
                <div 
                  key={cell.key}
                  className={`calendar-cell ${cell.day ? 'active-cell' : 'empty-cell'} ${isToday ? 'today-cell' : ''} ${isSelected ? 'selected-cell' : ''} ${hasEvents ? 'has-events-cell' : ''}`}
                  onClick={() => handleDayClick(cell)}
                >
                  <span className="day-number">{cell.day}</span>
                  {hasEvents && (
                    <div className="event-indicators">
                      {cellEvents.map(e => (
                        <div key={e.id} className={`event-dot ${e.status}`} title={`${e.author} - ${e.title}`}>
                          <span className="dot-title">{e.title}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="day-details-section">
        {selectedDateKey ? (
          <div className="details-header">
            <h2>Releases for {new Date(selectedDateKey + 'T00:00:00').toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h2>
          </div>
        ) : (
          <div className="details-header">
            <h2>All Month Releases</h2>
          </div>
        )}

        <div className="release-cards-container">
          {((selectedDateKey ? selectedDayEvents : monthEvents).length === 0) ? (
            <p className="no-releases-msg">No book releases scheduled for this period.</p>
          ) : (
            (selectedDateKey ? selectedDayEvents : monthEvents).map(event => (
              <div key={event.id} className="release-card glass-panel">
                {event.coverUrl ? (
                  <img src={event.coverUrl} alt={event.title} className="release-cover" />
                ) : (
                  <div className="release-cover-placeholder">📚</div>
                )}
                <div className="release-card-body">
                  <h3>{event.title}</h3>
                  <p className="release-author">by {event.author}</p>
                  <p className="release-date">📅 Released: {event.publishedDate}</p>
                  <div className="release-card-badges">
                    <span className={`media-badge ${event.mediaType}`}>
                      {event.mediaType === 'audiobook' ? '🎧 Audiobook' : '📖 Ebook'}
                    </span>
                    <span className={`status-badge ${event.status}`}>
                      {event.status}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default Calendar;
