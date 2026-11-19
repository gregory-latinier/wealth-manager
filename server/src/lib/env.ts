import dotenv from 'dotenv'
import path from 'path'

// Local dev reads ../.env (repo root). In production the variables come from cPanel and there is no .env file.
// dotenv never overrides a variable that is already set, so tests and cPanel values win.
dotenv.config({ path: path.join(__dirname, '../../../.env') })
