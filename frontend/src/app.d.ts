// No `App.Locals`: there is no server. The app is a static build (`adapter-static`) and
// the session is fetched in the browser — see `$lib/session.ts`.
declare global {
  namespace App {}
}

export {}
