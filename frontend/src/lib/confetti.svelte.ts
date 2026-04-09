export interface Particle {
  id: number
  symbol: string
  x: number      // vw, horizontal start
  rise: number   // vh, how high it shoots upward
  delay: number  // s
  duration: number  // s
  size: number   // rem
  sway: number   // vw, horizontal drift during flight
  rot0: number   // deg, start rotation
  rot1: number   // deg, end rotation
}

const SYMBOLS = ['💵', '💎', '🐟', '🧧', '💴', '💶', '💷', '🪙']
const COUNT = 88

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function generate(): Particle[] {
  return Array.from({ length: COUNT }, (_, i) => ({
    id: i,
    symbol: SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
    x: rand(-5, 105),
    delay: rand(0, 1.4),
    duration: rand(1, 2),
    size: rand(1.2, 2.2),
    sway: rand(-20, 20),
    rot0: rand(0, 360),
    rot1: rand(0, 360) + 360,  // full spin
  }))
}

let particles = $state<Particle[]>([])
let timer: ReturnType<typeof setTimeout> | null = null

export const confetti = {
  get particles() { return particles },
  trigger() {
    if (timer) clearTimeout(timer)
    particles = generate()
    timer = setTimeout(() => {
      particles = []
      timer = null
    }, (1.5 + 4.5 + 0.5) * 1000)
  },
}
