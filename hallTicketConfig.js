/**
 * Hall Ticket Availability Configuration & Utilities
 * 
 * Centralized configuration for Hall Ticket unlock date/time
 * Uses Asia/Kolkata (IST) timezone for all comparisons
 * 
 * Temporary trial configuration. Change only these two values for the actual exam.
 */

// ================================
// EXAM CONFIGURATION
// ================================
const HALL_TICKET_UNLOCK_DATE = '2026-08-23T17:00:00+05:30';
const EXAM_DATE = '2026-08-22T00:00:00+05:30';

const DEFAULT_HALL_TICKET_UNLOCK_DATE = HALL_TICKET_UNLOCK_DATE;

/**
 * Get the current Hall Ticket unlock date config
 * Reads from environment variable, falls back to default
 * @returns {string} The configured unlock date string
 */
function getHallTicketUnlockDateConfig() {
  return process.env.HALL_TICKET_UNLOCK_DATE || HALL_TICKET_UNLOCK_DATE;
}

/**
 * Parse the Hall Ticket unlock date string into a Date object
 * Supports ISO timestamps with an explicit timezone offset.
 * Returns a UTC Date object representing the unlock time in IST
 * 
 * @param {string} dateStr - Date string in format "DD-MM-YYYY HH:mm" or "DD-MM-YYYY"
 * @returns {Date} Date object in UTC
 */
function parseHallTicketUnlockDate(dateStr) {
  if (!dateStr) return null;

  try {
    const trimmed = String(dateStr).trim();
    const parsedDate = new Date(trimmed);
    if (!Number.isNaN(parsedDate.getTime())) return parsedDate;

    const normalized = trimmed
      .replace(/\s*Asia\/Kolkata\s*$/i, '')
      .replace(/\s*IST\s*$/i, '')
      .trim();

    const directMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{2}):(\d{2}))?$/);
    if (directMatch) {
      const [, year, month, day, hour = '00', minute = '00'] = directMatch;
      return new Date(`${year}-${month}-${day}T${hour}:${minute}:00+05:30`);
    }

    const dayMonthMatch = normalized.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
    if (dayMonthMatch) {
      const [, day, month, year, hour = '00', minute = '00'] = dayMonthMatch;
      return new Date(`${year}-${month}-${day}T${hour}:${minute}:00+05:30`);
    }

    return null;
  } catch (e) {
    console.error('[HALL_TICKET] Failed to parse unlock date:', dateStr, e);
    return null;
  }
}

/**
 * Check if Hall Ticket is currently available (unlocked)
 * Takes into account Asia/Kolkata (IST) timezone
 * 
 * Returns true if current time >= unlock time (in IST)
 * 
 * @param {string} dateStr - Optional override of unlock date string
 * @returns {boolean} True if Hall Ticket is available
 */
function isHallTicketAvailable(dateStr = null) {
  const configDate = dateStr || getHallTicketUnlockDateConfig();
  const unlockDate = parseHallTicketUnlockDate(configDate);
  
  if (!unlockDate) {
    console.error('[HALL_TICKET] Invalid unlock date configuration:', configDate);
    return false; // Locked by default if configuration is invalid
  }
  
  const now = new Date(); // This is in UTC
  return now.getTime() >= unlockDate.getTime();
}

/**
 * Get the formatted unlock date string for display
 * Format: "22 August 2026 at 05:00 PM"
 * 
 * @returns {string} Formatted unlock date string
 */
function getHallTicketUnlockDateDisplay() {
  const unlockDate = parseHallTicketUnlockDate(getHallTicketUnlockDateConfig());
  if (!unlockDate) return getHallTicketUnlockDateConfig();

  const day = String(unlockDate.getDate()).padStart(2, '0');
  const month = String(unlockDate.getMonth() + 1).padStart(2, '0');
  const year = unlockDate.getFullYear();
  const hours = unlockDate.getHours();
  const minutes = unlockDate.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  const displayMinutes = String(minutes).padStart(2, '0');

  return `${day}-${month}-${year} at ${displayHour}:${displayMinutes} ${period}`;
}

// Export functions for both Node.js and browser environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_HALL_TICKET_UNLOCK_DATE,
    HALL_TICKET_UNLOCK_DATE,
    EXAM_DATE,
    parseHallTicketUnlockDate,
    isHallTicketAvailable,
    getHallTicketUnlockDateDisplay,
    getHallTicketUnlockDateConfig
  };
} else if (typeof window !== 'undefined') {
  window.hallTicketConfig = {
    DEFAULT_HALL_TICKET_UNLOCK_DATE,
    HALL_TICKET_UNLOCK_DATE,
    EXAM_DATE,
    parseHallTicketUnlockDate,
    isHallTicketAvailable,
    getHallTicketUnlockDateDisplay,
    getHallTicketUnlockDateConfig
  };
}
