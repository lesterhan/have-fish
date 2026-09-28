/**
 * The two unauthenticated screens.
 *
 * `question` / `action` pairs are not a splice. Each half is a complete utterance — a
 * question and an imperative — so a translator can render each on its own terms rather
 * than having to keep a sentence's grammar working across a link boundary. That is the
 * line: adjacent independent phrases are fine, one sentence cut in half is not.
 */
export const authCopy = {
  // The local build has no sign-in: a window gets its session from the link the app opens.
  // This is what a window without one sees — a restarted app, or a link already used.
  local: {
    title: 'have-fish',
    body: 'This window is not signed in. Start have-fish again and it opens one that is.',
  },

  signIn: {
    title: 'Sign in',
    email: 'Email',
    password: 'Password',
    submit: 'Sign in',
    failed: 'Sign in failed',
    switch: {
      question: "Don't have an account?",
      action: 'Sign up',
    },
  },

  signUp: {
    title: 'Create account',
    email: 'Email',
    emailHint: '(I will never email you)',
    name: 'Display name',
    // One line rather than a hint plus a placeholder: the placeholder said why the field
    // exists and the field was 40px too narrow to show it, so the only copy that explained
    // the field was the copy nobody could read.
    nameHint: '(optional) — how you appear in shared expenses',
    password: 'Password',
    confirmPassword: 'Confirm password',
    passwordMismatch: 'Passwords do not match',
    submit: 'Create account',
    failed: 'Sign up failed',
    switch: {
      question: 'Already have an account?',
      action: 'Sign in',
    },
  },
} as const
