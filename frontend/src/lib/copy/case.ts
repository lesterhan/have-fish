/**
 * The case: everything on screen when there are no transactions at all.
 *
 * DESIGN.md §2 splits the app into the case and the work. The case is the 2003-desktop
 * shell — titlebar, sidebar, status bar, the furniture every dialog and table shares — and
 * it is small, stable, and the place the app's voice is most audible. Collecting it in one
 * file is the first time that voice can be read as a block rather than inferred from
 * twenty components, which is most of why this file exists separately from the work
 * surfaces.
 *
 * Two inconsistencies were visible the moment it was collected, and are fixed here: the
 * accent control was labelled "colour" in one place and "color" in the other, and the
 * attention dot was "Needs attention" in the sidebar and "needs attention" in the tab
 * strip.
 */
export const caseCopy = {
  /** The product name. Not translated, but not typed out in four files either. */
  appName: 'have-fish',

  titlebar: {
    accent: 'Choose accent colour',
    openMenu: 'Open menu',
    maximize: 'Maximize',
    signOut: 'Sign out',
  },

  signOut: {
    confirm: 'Sign out',
    busy: 'Signing out…',
    question: 'Sign out of have-fish?',
    warning: 'Any unsaved entry on this page will be lost.',
  },

  accent: {
    picker: 'Choose accent colour',
    /** The save failed, but the accent is already applied — so this is news, not an error. */
    sessionOnly: 'Accent saved for this session only.',
  },

  sidebar: {
    nav: {
      accounts: 'Accounts',
      spending: 'Spending',
      budgeting: 'Budgeting',
      fishPie: 'Fish Pie',
      catchUp: 'Catch Up',
      importExport: 'Import + Export',
      transactions: 'Transactions',
    },
    jump: 'Jump to account',
    /** Printed as a key legend, so it is copy even though every word is a key name. */
    jumpKey: 'Ctrl K',
    pinned: 'Pinned',
    recent: 'Recent',
    needsAttention: 'Needs attention',
    /**
     * The empty state ended with the link instead of wrapping around it. The old wording
     * put `<a>Accounts</a>` in the middle of the sentence, which cannot be held in one
     * message — and a sentence split into before-link and after-link halves is the exact
     * shape this epic exists to remove.
     */
    empty: 'Pin accounts to keep them here.',
    emptyAction: 'Open Accounts',
    compress: 'Compress sidebar',
    expand: 'Expand sidebar',
    closeSidebar: 'Close sidebar',
    close: 'Close',
    lightTheme: 'Light Theme',
    darkTheme: 'Dark Theme',
    settings: 'Settings',
  },

  /** Furniture shared by every dialog, menu, tray and table. */
  dialog: {
    cancel: 'Cancel',
    close: 'Close',
  },

  menu: {
    moreActions: 'More actions',
  },

  selection: {
    clear: 'Clear',
    /** Printed beside Clear as the shortcut that does the same thing. */
    clearKey: 'Esc',
  },

  table: {
    noResults: 'No results.',
  },

  tabs: {
    needsAttention: 'Needs attention',
  },

  convert: {
    converting: 'Converting…',
    to: (currency: string) => `Convert to ${currency}`,
  },

  currency: {
    edit: (code: string) => `Edit currency ${code}`,
  },
} as const
