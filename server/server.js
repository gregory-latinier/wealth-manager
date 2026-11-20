// Phusion Passenger / cPanel Node.js startup wrapper for server
process.env.NODE_ENV = 'production'
process.chdir(__dirname)

const fs = require('fs')
const path = require('path')

// Passenger swallows stdout and stderr on shared hosting, so everything is also written to a file.
// This runs before any app code is loaded, so even a crash while loading modules ends up in the log.
// Override the location with LOG_FILE. Never put it under client/dist, which is served publicly.
const LOG_FILE = process.env.LOG_FILE || path.join(__dirname, 'logs', 'app.log')
const MAX_LOG_BYTES = 5 * 1024 * 1024

function prepareLogFile() {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    // One generation of rotation keeps the file from growing forever.
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_BYTES) fs.renameSync(LOG_FILE, `${LOG_FILE}.1`)
    return true
  } catch (err) {
    console.error(`[boot] cannot use log file ${LOG_FILE}: ${err.message}`)
    return false
  }
}

const logToFile = prepareLogFile()

function writeLog(level, message) {
  if (!logToFile) return
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [${level}] ${message}\n`)
  } catch {
    // Logging must never be the reason the app fails.
  }
}

const describe = (value) => (value instanceof Error ? value.stack || value.message : String(value))

// Mirror the app's own console.error/warn (config errors, DB errors) into the file.
for (const level of ['error', 'warn']) {
  const original = console[level].bind(console)
  console[level] = (...args) => {
    writeLog(level, args.map(describe).join(' '))
    original(...args)
  }
}

process.on('uncaughtException', (err) => {
  writeLog('fatal', `uncaughtException: ${describe(err)}`)
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  writeLog('fatal', `unhandledRejection: ${describe(reason)}`)
})
process.on('exit', (code) => writeLog('info', `process exiting with code ${code}`))

// Fastify's request logger writes to the same file.
if (logToFile) process.env.WM_LOG_FILE = LOG_FILE

const present = (name) => (process.env[name] && process.env[name].trim() ? 'set' : 'MISSING')
writeLog(
  'info',
  `starting: node ${process.version}, cwd ${process.cwd()}, PORT=${process.env.PORT || '(none)'}, ` +
    `DATABASE_URL ${present('DATABASE_URL')}, APP_PASSWORD ${present('APP_PASSWORD')}, APP_PASSWORD_HASH ${present('APP_PASSWORD_HASH')}, SNAPSHOT_TOKEN ${present('SNAPSHOT_TOKEN')}, ` +
    `client build ${fs.existsSync(path.join(__dirname, '../client/dist/index.html')) ? 'found' : 'NOT FOUND'}`
)

try {
  // dist/index.js only auto-starts when run directly (`node dist/index.js`),
  // so when loaded from here we have to start it explicitly.
  Promise.resolve(require('./dist/index.js').start()).catch((err) => {
    writeLog('fatal', `start() failed: ${describe(err)}`)
    process.exit(1)
  })
} catch (err) {
  writeLog('fatal', `could not load dist/index.js: ${describe(err)}`)
  process.exit(1)
}
