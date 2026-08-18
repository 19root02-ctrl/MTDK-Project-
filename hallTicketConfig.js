/**
 * Hall Ticket Availability Configuration & Utilities
 * 
 * Centralized configuration for Hall Ticket unlock date/time
 * Uses Asia/Kolkata (IST) timezone for all comparisons
 * 
 * Unlock Date: 20 August 2026 at 12:00 AM IST
 */

// Default Hall Ticket unlock date/time configuration
// Format: "20-08-2026 00:00 Asia/Kolkata"
const DEFAULT_HALL_TICKET_UNLOCK_DATE = '20-08-2026 00:00 Asia/Kolkata';

/**
 * Get the current Hall Ticket unlock date config
 * Reads from environment variable, falls back to default
 * @returns {string} The configured unlock date string
 */
function getHallTicketUnlockDateConfig() {
  return process.env.HALL_TICKET_UNLOCK_DATE || DEFAULT_HALL_TICKET_UNLOCK_DATE;
}

/**
 * Parse the Hall Ticket unlock date string into a Date object
 * Supports formats: "20-08-2026 00:00 Asia/Kolkata" or "20-08-2026"
 * Returns a UTC Date object representing the unlock time in IST
 * 
 * @param {string} dateStr - Date string in format "DD-MM-YYYY HH:mm" or "DD-MM-YYYY"
 * @returns {Date} Date object in UTC
 */
function parseHallTicketUnlockDate(dateStr) {
  if (!dateStr) return null;
  
  try {
    // Remove timezone suffix if present
    const cleanStr = dateStr.replace(/\s*Asia\/Kolkata\s*$/i, '').trim();
    
    // Match DD-MM-YYYY HH:mm or DD-MM-YYYY
    const match = cleanStr.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
    if (!match) return null;
    
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // JS months are 0-indexed
    const year = parseInt(match[3], 10);
    const hours = match[4] ? parseInt(match[4], 10) : 0;
    const minutes = match[5] ? parseInt(match[5], 10) : 0;
    
    // Create a date at 00:00 IST
    // IST is UTC+5:30, so to get 00:00 IST we need to subtract 5:30 from UTC
    // For example, 20-08-2026 00:00 IST = 19-08-2026 18:30 UTC
    const istDate = new Date(year, month, day, hours, minutes, 0, 0);
    
    // Convert to UTC by adjusting for IST offset (UTC+5:30)
    // IST is 5 hours 30 minutes ahead of UTC
    const utcDate = new Date(istDate.getTime() - (5.5 * 60 * 60 * 1000));
    
    return utcDate;
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
 * Format: "20-08-2026 00:00 IST"
 * 
 * @returns {string} Formatted unlock date string
 */
function getHallTicketUnlockDateDisplay() {
  const configDate = getHallTicketUnlockDateConfig();
  const match = configDate.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!match) return configDate;
  
  const day = match[1];
  const month = match[2];
  const year = match[3];
  const hours = match[4] || '00';
  const minutes = match[5] || '00';
  
  return `${day}-${month}-${year} ${hours}:${minutes} IST`;
}

// Export functions for both Node.js and browser environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_HALL_TICKET_UNLOCK_DATE,
    parseHallTicketUnlockDate,
    isHallTicketAvailable,
    getHallTicketUnlockDateDisplay,
    getHallTicketUnlockDateConfig
  };
} else if (typeof window !== 'undefined') {
  window.hallTicketConfig = {
    DEFAULT_HALL_TICKET_UNLOCK_DATE,
    parseHallTicketUnlockDate,
    isHallTicketAvailable,
    getHallTicketUnlockDateDisplay,
    getHallTicketUnlockDateConfig
  };
}
