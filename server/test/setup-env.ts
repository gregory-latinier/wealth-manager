// Runs in every test worker before the app modules load (dotenv never overrides variables already set).
const base = process.env.DATABASE_URL || 'postgresql://wmuser:wmpassword@localhost:5433/wealthmanager'
const url = new URL(base)
url.pathname = '/wealthmanager_test'

process.env.DATABASE_URL = url.toString()
process.env.NODE_ENV = 'test'
process.env.SNAPSHOT_TOKEN = 'test-snapshot-token-0123456789abcdef0123456789'
// bcrypt hash of "correct-horse-battery" at cost 4 (fast for tests)
// Empty (not deleted) so dotenv does not refill it from a developer's .env: the tests exercise the hash path.
process.env.APP_PASSWORD = ''
process.env.APP_PASSWORD_HASH = require('bcryptjs').hashSync('correct-horse-battery', 4)

// Exchange credentials are encrypted with this. Tests never use a real secret.
process.env.EXCHANGE_KEY_SECRET = 'test-exchange-key-secret-0123456789abcdef'
