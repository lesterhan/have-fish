declare global {
  namespace App {
    interface Locals {
      session: { user: { id: string; email: string } } | null
    }
  }
}

export { }

