// Usage: pnpm hash-password            (prompts, input hidden)
//        pnpm hash-password 'my pass'  (argument ends up in your shell history; prefer the prompt)
// Prints the bcrypt hash to set as APP_PASSWORD_HASH.
import bcrypt from 'bcryptjs'

const MIN_LENGTH = 12

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('No TTY available: pass the password as an argument instead.'))
      return
    }
    process.stdout.write(prompt)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    let value = ''
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false)
          process.stdin.pause()
          process.stdin.off('data', onData)
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (ch === '\u0003') {
          process.stdin.setRawMode(false)
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else value += ch
      }
    }
    process.stdin.on('data', onData)
  })
}

const password = process.argv[2] ?? (await readHidden('Password: '))
if (password.length < MIN_LENGTH) {
  console.error(`Password must be at least ${MIN_LENGTH} characters.`)
  process.exit(1)
}
if (process.argv[2] === undefined) {
  const confirm = await readHidden('Confirm:  ')
  if (confirm !== password) {
    console.error('Passwords do not match.')
    process.exit(1)
  }
}

const hash = await bcrypt.hash(password, 12)
console.log(`\nAPP_PASSWORD_HASH='${hash}'`)
console.log('\nIn a .env file keep the single quotes (the hash contains "$"). In cPanel paste only the value.')
