import net from 'node:net';

// Zusätzlich erlaubte Hostnamen, z. B. ALLOWED_HOSTS=caltimer.fritz.box,zima.home
const EXTRA_HOSTS = new Set(
  (process.env.ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);

function hostname(hostHeader) {
  if (!hostHeader) return null;
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']')); // [IPv6]:port
  return h.replace(/:\d+$/, '');
}

/**
 * Schutz gegen DNS-Rebinding: Eine fremde Webseite kann ihre Domain auf die IP
 * des ZimaBoards zeigen lassen – der Host-Header bleibt dann aber ihre Domain.
 * Erlaubt sind daher nur IP-Adressen, localhost, *.local und ALLOWED_HOSTS.
 */
export function isAllowedHost(hostHeader) {
  const h = hostname(hostHeader);
  if (!h) return false;
  if (net.isIP(h)) return true;
  if (h === 'localhost' || h.endsWith('.local')) return true;
  return EXTRA_HOSTS.has(h);
}

export function hostCheck(req, res, next) {
  if (isAllowedHost(req.headers.host)) return next();
  res.status(403).type('text/plain').send('Host nicht erlaubt. Siehe ALLOWED_HOSTS in der README.');
}

// Zustandsändernde Anfragen müssen von CalTimer selbst kommen (zusätzlich zu SameSite-Cookies).
export function originCheck(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      originHost = null;
    }
    if (originHost !== String(req.headers.host).toLowerCase()) {
      return res.status(403).json({ error: 'Anfrage von fremder Seite abgelehnt.' });
    }
  } else if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
    return res.status(403).json({ error: 'Anfrage von fremder Seite abgelehnt.' });
  }
  next();
}

export function securityHeaders(_req, res, next) {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      // Radix/Vaul/Sonner setzen zur Laufzeit <style>-Elemente; Skripte bleiben strikt 'self'.
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  });
  next();
}
