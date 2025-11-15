// src/logger.js
const fetch = require('node-fetch');
const config = require('./config');

class Logger {
  async sendLogToGrafana(event) {
    const body = JSON.stringify(event);
    try {
      const res = await fetch(config.logging.url, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.logging.userId}:${config.logging.apiKey}`,
        },
      });
      if (!res.ok) console.log('Failed to send log to Grafana', await res.text());
    } catch (err) {
      console.error('Error sending log:', err);
    }
  }

  httpLogger(req, res, next) {
    const startTime = Date.now();
    const auth = !!req.headers.authorization;

    const originalSend = res.send;
    res.send = (body) => {
      res.send = originalSend; // restore
      res.send(body);

      this.sendLogToGrafana({
        time: new Date().toISOString(),
        level: 'info',
        type: 'http',
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        auth,
        req: req.body,
        res: sanitize(body),
        ip: req.ip,
        durationMs: Date.now() - startTime,
      });
      return res;
    };
    next();
  }

  logDB(query, params) {
    this.sendLogToGrafana({
      time: new Date().toISOString(),
      level: 'info',
      type: 'db',
      query,
      params: sanitize(params),
    });
  }

  logFactory(requestBody, responseBody) {
    this.sendLogToGrafana({
      time: new Date().toISOString(),
      level: 'info',
      type: 'factory',
      req: sanitize(requestBody),
      res: sanitize(responseBody),
    });
  }

  logError(err) {
    this.sendLogToGrafana({
      time: new Date().toISOString(),
      level: 'error',
      type: 'exception',
      message: err.message,
      stack: err.stack,
    });
  }
}

// Simple sanitizer: remove sensitive fields
function sanitize(obj) {
  if (!obj) return obj;
  const clone = JSON.parse(JSON.stringify(obj));
  if (clone.password) clone.password = '***';
  if (clone.token) clone.token = '***';
  return clone;
}

module.exports = new Logger();
