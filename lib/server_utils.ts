import crypto from 'crypto';

let lastGlobalTimestamp = 0;

/**
 * Generiert einen formatierten Datums-String des lokalen Server-Tages (YYYY-MM-DD).
 * @returns {string} Lokales Datum.
 */
export function getLocalDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generiert ein stabiles, eintägig gültiges SHA-256-Sitzungstoken basierend auf dem Admin-Passwort.
 * @param {string} adminPassword - Das konfigurierte Admin-Passwort.
 * @returns {string} Aktuelles Sitzungstoken.
 */
export function getAdminSessionToken(adminPassword: string): string {
  return crypto.createHash('sha256')
    .update(`${adminPassword}GAP_FLOW_SALT_${getLocalDateString()}`)
    .digest('hex');
}

/**
 * Generiert einen eindeutigen, streng monoton aufsteigenden Millisekunden-Zeitstempel.
 * @returns {number} Eindeutiger Zeitstempel.
 */
export function getUniqueTimestamp(): number {
  let now = Date.now();
  if (now <= lastGlobalTimestamp) {
    now = lastGlobalTimestamp + 1;
  }
  lastGlobalTimestamp = now;
  return now;
}

/**
 * Bereinigt und beschränkt Zeichenketten zum Schutz vor Injektionen.
 * @param {string} str - Die zu bereinigende Zeichenkette.
 * @param {number} maxLength - Die maximale zulässige Länge.
 * @returns {string} Bereinigte Zeichenkette.
 */
export function sanitizeName(str: string, maxLength: number): string {
  if (typeof str !== 'string') return '';
  let cleaned = str.trim().substring(0, maxLength);
  cleaned = cleaned.replace(/[^a-zA-Z0-9\s\-.,äöüÄÖÜßéèàáíóúÉÈÀÁÍÓÚ/()]/g, '');
  return cleaned.trim();
}

/**
 * Bereinigt und validiert Telefonnummern nach striktem Schema (optionales '+' am Anfang, gefolgt von Ziffern).
 * @param {string} str - Die zu bereinigende Telefonnummer.
 * @param {number} maxLength - Die maximale zulässige Länge.
 * @returns {string} Bereinigte Telefonnummer.
 */
export function sanitizePhoneNumber(str: string, maxLength: number): string {
  if (typeof str !== 'string') return '';
  let cleaned = str.trim().substring(0, maxLength);
  const startsWithPlus = cleaned.startsWith('+');
  cleaned = cleaned.replace(/[^0-9]/g, '');
  return startsWithPlus ? `+${cleaned}` : cleaned;
}
