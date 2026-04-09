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
    x: rand(15, 85),       // spread across middle of screen
    rise: rand(55, 120),   // vh — shoot high
    delay: rand(0, 0.4),   // tight burst, not staggered
    duration: rand(1.5, 2.5),
    size: rand(1.2, 2.2),
    sway: rand(-20, 20),   // wider spread for explosion feel
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
    }, (0.4 + 2.5 + 0.3) * 1000)
  },
}
