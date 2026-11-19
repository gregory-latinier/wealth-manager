// Runs in every test worker before the app modules load (dotenv never overrides variables already set).
const base = process.env.DATABASE_URL || 'postgresql://wmuser:wmpassword@localhost:5433/wealthmanager'
const url = new URL(base)
url.pathname = '/wealthmanager_test'

process.env.DATABASE_URL = url.toString()
process.env.NODE_ENV = 'test'
// bcrypt hash of "correct-horse-battery" at cost 4 (fast for tests)
process.env.APP_PASSWORD_HASH = require('bcryptjs').hashSync('correct-horse-battery', 4)
