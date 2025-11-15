// src/logger.js
const fetch = require('node-fetch'); // Use node-fetch for Node.js
const config = require('./config.js');

class Logger {
  /**
   * Express middleware to log all HTTP requests and responses
   */
  httpLogger = (req, res, next) => {
    const start = Date.now();
    const originalSend = res.send;

    res.send = (body) => {
      const duration = Date.now() - start;

      const logData = {
        authorized: !!req.headers.authorization,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: duration,
        reqBody: this.sanitize(JSON.stringify(req.body)),
        resBody: this.sanitize(JSON.stringify(body)),
      };

      const level = this.statusToLogLevel(res.statusCode);
      this.log(level, 'http', logData);

      res.send = originalSend;
      return res.send(body);
    };

    next();
  };

  /**
   * Log database query
   */
  dbQuery(query, params = []) {
    const logData = {
      query,
      params,
    };
    this.log('info', 'db', logData);
  }

  /**
   * Log factory service requests
   */
  factoryRequest(requestBody, responseBody) {
    const logData = {
      request: this.sanitize(JSON.stringify(requestBody)),
      response: this.sanitize(JSON.stringify(responseBody)),
    };
    this.log('info', 'factory', logData);
  }

  /**
   * Generic log function
   */
  log(level, type, logData) {
    const labels = {
      component: config.logging.source,
      level: level,
      type: type,
    };
    const values = [this.nowString(), JSON.stringify(logData)];
    const logEvent = { streams: [{ stream: labels, values: [values] }] };

    this.sendLogToGrafana(logEvent);
  }

  /**
   * Map HTTP status to log level
   */
  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  /**
   * Convert current time to Loki-compatible nanoseconds
   */
  nowString() {
    return (Date.now() * 1000000).toString();
  }

  /**
   * Sanitize sensitive data (passwords, tokens)
   */
  sanitize(data) {
    if (!data) return '';
    return data.replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"*****"')
               .replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"*****"');
  }

  /**
   * Send log event to Grafana Loki
   */
  async sendLogToGrafana(event) {
    try {
      const res = await fetch(config.logging.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.logging.userId}:${config.logging.apiKey}`,
        },
        body: JSON.stringify(event),
      });

      if (!res.ok) {
        console.error('Failed to send log to Grafana', await res.text());
      }
    } catch (err) {
      console.error('Error sending log to Grafana', err);
    }
  }

  /**
   * Catch unhandled exceptions
   */
  catchErrors() {
    process.on('uncaughtException', (err) => {
      this.log('error', 'exception', { message: err.message, stack: err.stack });
    });

    process.on('unhandledRejection', (reason) => {
      this.log('error', 'exception', { reason });
    });
  }
}

module.exports = new Logger();
