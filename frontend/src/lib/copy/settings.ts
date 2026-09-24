/**
 * Settings — the user's own details, the three account pointers, and the root paths.
 *
 * Every row here is a setting that commits on its own, so each one owns a confirmation
 * sentence rather than sharing a `${label} saved` template. That template was the reason
 * "Uncategorized account saved" existed nowhere in the source: it was a label from one
 * object glued to a word in another, which is unfindable when you want to edit it and
 * unreachable for a translator who needs the verb somewhere other than the end.
 *
 * The example paths under the three pointers are copy — they are illustrations, chosen to
 * read as advice. The root-path placeholders are not: those are the schema defaults, and
 * they come from `DEFAULT_ROOTS` so the hint cannot drift from the value the field falls
 * back to.
 */
export const settingsCopy = {
  user: {
    /** The 🧧 in the corner. Chinese first: it is the app's name, and the toast is the joke. */
    greeting: '年年有鱼 · Year Year Have Fish',
    greetingLabel: 'Year Year Have Fish',
    namePlaceholder: 'Display name',
    /** Stands in for an unset display name, inside the brackets the page draws. */
    nameUnset: "what's your name…",
    editName: 'Edit display name',
    saveName: 'Save name',
    nameSaved: 'Display name saved',
    nameFailed: 'Failed to save display name',
    signOut: 'Sign out',
  },

  defaults: {
    title: 'Account Defaults',
    manage: 'Accounts',
    manageHint: 'Add, rename, pin and hide accounts and categories',

    offset: {
      label: 'Uncategorized',
      hint: 'Imported transactions with no matched category will use this account.',
      example: 'liabilities:offset',
      saved: 'Uncategorized account saved',
    },
    conversion: {
      label: 'Conversion balance',
      hint: 'Equity account used to balance cross-currency transfers. Required for multi-currency imports.',
      example: 'equity:conversions',
      saved: 'Conversion account saved',
    },
    adjustments: {
      label: 'Adjustments',
      hint: 'Equity account used as the offset when posting a reconciliation adjustment.',
      example: 'equity:adjustments',
      saved: 'Adjustments account saved',
    },
    currency: {
      label: 'Preferred currency',
      hint: 'Your home currency. Used for FX conversion displays.',
      saved: 'Preferred currency saved',
    },
  },

  roots: {
    title: 'Root Paths',
    assets: {
      label: 'Assets',
      hint: "Root prefix for asset accounts (e.g. 'assets' → 'assets:bank:chequing').",
      saved: 'Assets root path saved',
    },
    liabilities: {
      label: 'Liabilities',
      hint: "Root prefix for liability accounts (e.g. 'liabilities' → 'liabilities:creditcard').",
      saved: 'Liabilities root path saved',
    },
    expenses: {
      label: 'Expenses',
      hint: 'Root prefix for expense accounts. Used to filter spending reports.',
      saved: 'Expenses root path saved',
    },
    equity: {
      label: 'Equity',
      hint: "Root prefix for equity accounts. (e.g. 'equity' → 'equity:investments').",
      saved: 'Equity root path saved',
    },
  },

  /** The quiet footer. The alarm is in the confirmation, not in the link that opens it. */
  danger: {
    open: 'Delete my account…',
    description: 'Permanently removes your account and all associated data. This cannot be undone.',
    title: 'Delete account',
    warning: 'This will permanently delete your user account and all data. This cannot be undone.',
    confirm: 'Delete account',
  },
} as const
