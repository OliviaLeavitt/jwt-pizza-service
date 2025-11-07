const os = require('os');
const config = require('./config.js');

let totalRequests = 0;
const requestsByMethod = { GET: 0, POST: 0, PUT: 0, DELETE: 0 };
let totalAuthAttempts = 0;
let successfulAuthAttempts = 0;
let failedAuthAttempts = 0;

// Active users
let activeUsers = 0;

// Pizza purchase metrics
let pizzasSold = 0;
let pizzaFailures = 0;
let totalRevenue = 0;
let totalPizzaLatency = 0;

const requestStartTimes = new Map();

// Middleware to track HTTP requests
function requestTracker(req, res, next) {
  const start = Date.now();
  totalRequests++;
  if (requestsByMethod[req.method] !== undefined) {
    requestsByMethod[req.method]++;
  }

  requestStartTimes.set(req, start);
  res.on('finish', () => {
    requestStartTimes.delete(req);
  });

  next();
}

// Record authentication attempts
function recordAuthAttempt(success) {
  totalAuthAttempts++;
  if (success) {
    successfulAuthAttempts++;
    activeUsers++; // increment active users on successful login
  } else {
    failedAuthAttempts++;
  }
}

// Record user logout
function recordLogout() {
  if (activeUsers > 0) activeUsers--; // decrement active users
}

// Record pizza purchases
function pizzaPurchase(success, latencyMs, price) {
  if (success) {
    pizzasSold++;
    totalRevenue += price;
  } else {
    pizzaFailures++;
  }
  totalPizzaLatency += latencyMs;
}

// System metrics helpers
function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return (cpuUsage * 100).toFixed(2);
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory) * 100;
  return memoryUsage.toFixed(2);
}

// Send a single metric to Grafana
async function sendMetricToGrafana(name, value, type, unit) {
  const metric = {
    resourceMetrics: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: config.metrics.source } }],
        },
        scopeMetrics: [
          {
            metrics: [
              {
                name,
                unit,
                [type]: {
                  dataPoints: [
                    {
                      asDouble: value,
                      timeUnixNano: Date.now() * 1_000_000,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };

  if (type === 'sum') {
    metric.resourceMetrics[0].scopeMetrics[0].metrics[0][type].aggregationTemporality =
      'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric.resourceMetrics[0].scopeMetrics[0].metrics[0][type].isMonotonic = true;
  }

  try {
    const response = await fetch(config.metrics.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.metrics.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metric),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Failed to push ${name}: ${text}`);
    }
  } catch (err) {
    console.error('Error sending metrics:', err);
  }
}

// Periodically send all metrics
function startPeriodicReporting(periodMs = 5000) {
  setInterval(() => {
    try {
      sendMetricToGrafana('cpu_usage', parseFloat(getCpuUsagePercentage()), 'gauge', '%');
      sendMetricToGrafana('memory_usage', parseFloat(getMemoryUsagePercentage()), 'gauge', '%');

      sendMetricToGrafana('http_requests_total', totalRequests, 'sum', '1');
      for (const method of Object.keys(requestsByMethod)) {
        sendMetricToGrafana(`http_requests_${method}`, requestsByMethod[method], 'sum', '1');
      }

      sendMetricToGrafana('auth_attempts_total', totalAuthAttempts, 'sum', '1');
      sendMetricToGrafana('auth_success_total', successfulAuthAttempts, 'sum', '1');
      sendMetricToGrafana('auth_fail_total', failedAuthAttempts, 'sum', '1');

      // Active users
      sendMetricToGrafana('active_users', activeUsers, 'gauge', '1');

      sendMetricToGrafana('pizzas_sold', pizzasSold, 'sum', '1');
      sendMetricToGrafana('pizza_failures', pizzaFailures, 'sum', '1');
      sendMetricToGrafana('pizza_revenue', totalRevenue, 'sum', 'USD');
      sendMetricToGrafana('pizza_latency_total', totalPizzaLatency, 'sum', 'ms');

      console.log('Metrics sent to Grafana');
    } catch (err) {
      console.error('Error building metrics:', err);
    }
  }, periodMs);
}

module.exports = {
  requestTracker,
  recordAuthAttempt,
  recordLogout, // export the logout function
  pizzaPurchase,
  startPeriodicReporting,
};
