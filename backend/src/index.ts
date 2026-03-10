import { app } from './app'

export default {
  port: process.env.PORT ?? 3001,
  fetch: app.fetch,
}
