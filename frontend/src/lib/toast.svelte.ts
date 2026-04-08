let message = $state<string | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

export const toast = {
  get message() {
    return message
  },
  show(text: string, duration = 2500) {
    message = text
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      message = null
    }, 3200)
  },
}
