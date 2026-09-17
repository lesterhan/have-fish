/**
 * Accounts: the page, its Categories tab, and every component under
 * `lib/components/accounts` — the drawer, the pickers, the palette, the settings modal,
 * Quick Entry and Reconcile.
 *
 * One file rather than six, because these surfaces borrow each other's words constantly.
 * "Recent entries and what is unfinished" is the same tooltip on an account row and on a
 * category row; `never` is the same empty last-activity cell in both tables; the same
 * "Nothing matches" answers a search in the table, in the tree and in the Ctrl+K palette.
 * Splitting by component would have made those four strings and then let them drift.
 *
 * The count sentences all live here as functions over `plural`, which is why this file
 * imports it: a caller asks for `hidden(n)` and gets a whole sentence, instead of holding
 * two of them and a comparison.
 *
 * What is deliberately *not* here: account paths, currency codes, amounts and dates. A
 * path is the user's own data, a code is an identifier, and both arrive as parameters.
 */
import { plural } from './plural'

export const accountsCopy = {
  page: {
    documentTitle: 'Accounts · have-fish',
    heading: 'Accounts',
    tabsLabel: 'Accounts page sections',
    tabs: {
      accounts: 'Accounts',
      categories: 'Categories',
    },
  },

  /**
   * The four-way split of what you have, and the band above it when something is
   * outstanding. Both outstanding sentences end in a full stop and are followed by their
   * own action word — a question beside an imperative, not one sentence cut in half.
   */
  position: {
    regionLabel: 'Position',
    cash: 'Available',
    investments: 'Investments',
    owed: 'Owed to you',
    owing: 'You owe',

    noStartingLine: (n: number) =>
      plural(
        n,
        'One account has no starting line, so nothing it holds is counted below.',
        `${n} accounts have no starting line, so nothing they hold is counted below.`,
      ),
    setStartingLines: 'Set them',
    needsDecision: (n: number) =>
      plural(n, 'One entry needs a decision.', `${n} entries need a decision.`),
    showOutstanding: 'Show them',
    showEverything: 'Show every account',
  },

  /**
   * What a figure leaves out. `currencies` arrives already joined — a list is formatting,
   * and the call site is the only place that knows which currencies are in the roll-up.
   */
  conversion: {
    missingRate: (currencies: string) =>
      `Balances in ${currencies} are not included — no exchange rate available`,
    notConverted: (currencies: string) =>
      `Also holds ${currencies} — convert to fold them in`,
    noRates: (currency: string) =>
      `No exchange rates available right now — still showing ${currency} balances.`,
    /** The cell for a row whose own currency has no rate. */
    noRate: 'No exchange rate available',
    showNative: (currency: string) => `Show ${currency} only`,
  },

  controls: {
    search: 'Search accounts',
    group: 'Group',
    groupBy: 'Group accounts by',
    grouping: {
      institution: 'Institution',
      type: 'Type',
      currency: 'Currency',
      flat: 'Flat',
    },
    show: 'Show',
    showWhich: 'Which accounts to show',
    showing: {
      active: 'Active',
      all: 'All',
      hidden: 'Hidden',
    },
    create: 'Create an account',
    newAccount: 'New account…',
    kinds: {
      asset: 'Asset',
      liability: 'Liability',
      equity: 'Equity',
    },
    select: 'Select',
    selectHint: 'Pin, hide or set the currency of several accounts at once',
    selectDone: 'Done',
    count: (n: number) => plural(n, '1 account', `${n} accounts`),
  },

  columns: {
    account: 'Account',
    type: 'Type',
    balance: 'Balance',
    /** The converted column's header. `≈` is punctuation; the code is the user's own. */
    converted: (currency: string) => `≈ ${currency}`,
    activity: 'Last activity',
    flags: 'Flags',
    actions: 'Actions',
    caption: 'Accounts, grouped',
  },

  /** Group headings. Institution names and currency codes are data and stay as they are. */
  groups: {
    /** Outside every configured root — the bucket that stops a mis-pathed account vanishing. */
    unfiled: 'Unfiled',
    /** Grouped by currency, for an account that has never been posted to. */
    noBalance: 'No balance',
    /** The one group the Flat view puts everything in. */
    all: 'All accounts',
    surface: {
      assets: 'Assets',
      liabilities: 'Liabilities',
      equity: 'Equity',
      expenses: 'Expenses',
      income: 'Income',
    },
    type: {
      asset: 'Assets',
      liability: 'Liabilities',
      equity: 'Equity',
      income: 'Income',
      expense: 'Expenses',
    },
    selectAll: (group: string) => `Select every account in ${group}`,
  },

  rows: {
    select: (account: string) => `Select ${account}`,
    /** The type chip for an account under no configured root. */
    unfiled: 'unfiled',
    /** Nothing has ever been posted here, in the Last activity column. */
    never: 'never',
    /** Days since the last entry, beside a stale date. */
    idle: (days: number) => `stale ${days}d`,
    pinned: 'pinned',
    hidden: 'hidden',
    showEntries: (account: string) => `Show recent entries for ${account}`,
    hideEntries: (account: string) => `Hide recent entries for ${account}`,
    entriesHint: 'Recent entries and what is unfinished',
    pin: (account: string) => `Pin ${account}`,
    unpin: (account: string) => `Unpin ${account}`,
    pinHint: 'Pin to sidebar',
    unpinHint: 'Unpin from sidebar',
    hide: (account: string) => `Hide ${account}`,
    unhide: (account: string) => `Unhide ${account}`,
    hideHint: 'Hide',
    unhideHint: 'Unhide',
  },

  /** The tray over the selection. Every label says what it does to all of them. */
  bulk: {
    pinAll: 'Pin all',
    unpinAll: 'Unpin all',
    hideAll: 'Hide all',
    allInUse: 'Every account selected is in use',
    someInUse: (n: number) =>
      plural(n, '1 in use and will be kept', `${n} in use and will be kept`),
    currency: 'Default currency for the selected accounts',
    setCurrency: 'Set currency…',
    apply: (currency: string) => `Apply ${currency}`,
    import: 'Import',
    importOne: 'Open Import targeting this account',
    importMany: 'Import takes one account — a statement belongs to one',
  },

  toasts: {
    loadFailed: 'Could not load accounts.',
    saveFailed: 'Could not save that — nothing changed.',
    /** Said because the Active view has just made the row disappear. */
    hidden: (n: number) =>
      plural(
        n,
        'Hidden — switch Show to All or Hidden to see it.',
        'Hidden — switch Show to All or Hidden to see them.',
      ),
    nothingToHide: 'Nothing to hide — every account selected is in use.',
    hidSomeKeptOthers: (hidden: number, kept: number) =>
      plural(
        kept,
        `Hid ${hidden}; kept ${kept} that is in use.`,
        `Hid ${hidden}; kept ${kept} that are in use.`,
      ),
    currencySet: (currency: string, n: number) =>
      plural(
        n,
        `Default currency set to ${currency} on 1 account.`,
        `Default currency set to ${currency} on ${n} accounts.`,
      ),
    currencyFailed: 'Could not set the currency on every account.',
  },

  /** Shared by the table and the tree: the search answer when a query matches nothing. */
  search: {
    noMatch: (query: string) => `Nothing matches “${query}”.`,
    empty: 'No accounts here yet.',
  },

  /**
   * What the rest of the app is pointing at this account for, and what is holding it.
   *
   * The role labels are shouted because they are chips on a row, not sentences. The
   * protection message is the opposite — it is the only explanation of why a control is
   * greyed out, so it names the blocker and the way out of it in one line.
   */
  flags: {
    managed: 'managed',
    roles: {
      offset: 'OFFSET',
      conversion: 'CONVERSION',
      adjustments: 'ADJUSTMENTS',
    },
    roleHints: {
      offset: 'Imports post uncategorized rows here',
      conversion: 'Cross-currency transactions clear through here',
      adjustments: 'Reconciliation writes its adjustments here',
    },
    systemManaged:
      'Fish Pie manages this account — it is re-created on import.',
    rolesInUse: (roles: string, n: number) =>
      plural(
        n,
        `Point ${roles} at another account in Settings first — this is in use.`,
        `Point ${roles} at another account in Settings first — these are in use.`,
      ),
  },

  /**
   * The heading above an account's figure. Uppercase because it is a label, and the
   * direction is a word here rather than a minus sign: a card that owes 3,759 is not an
   * error, and red is an alarm that would never stop going off.
   */
  balance: {
    neutral: 'BALANCE',
    owing: 'OWING',
    inCredit: 'IN CREDIT',
  },

  /** The row, opened: the last few entries and where to go next. */
  drawer: {
    loadFailed: 'Could not load recent entries.',
    empty: 'Nothing has been posted here yet.',
    /** One entry touching several accounts, where naming them all would not fit. */
    split: 'split',
    /** The `+ fx` marker: this entry moved a second currency the figure does not show. */
    partial: '+ fx',
    partialHint: (currency: string) =>
      `This entry also moved another currency in this account — only the ${currency} side is shown`,
    seeAll: (n: number) => `See all ${n} entries`,
    seeInTransactions: 'See these in Transactions',
    openAccount: 'Open account',
    importStatement: 'Import a statement',
  },

  /** Ctrl+K. The label and the key legend are the sidebar's, so they are not repeated. */
  jump: {
    placeholder: 'Jump to account…',
    empty: 'No accounts yet.',
  },

  /** The typed-path combobox, in Settings and on a Quick Entry row. */
  pathInput: {
    placeholder: 'Type an account path…',
    create: (path: string) => `Create new account '${path}'`,
    createFailed: 'Could not create that account',
  },

  /** The drill-and-search picker. Terse by design: it is a control, not a page. */
  picker: {
    placeholder: 'Pick an account…',
    search: 'Search accounts',
    searchHint: 'Search the whole tree — or just start typing',
    /** Printed as a key legend inside the search field. */
    escapeKey: 'esc',
    deeper: 'Go deeper',
    create: 'Create new account',
    /** Marks the top-ranked search result. */
    best: 'best',
    /** The drill column, when the account you are on has nothing under it. */
    noChildren: 'nothing deeper',
  },

  /**
   * Account settings. Every row commits as you touch it, so each carries its own failure
   * sentence naming what did not save — a shared "Save failed" would be true of six rows
   * and useful for none.
   */
  settings: {
    title: 'Account settings',
    tabsLabel: 'Account settings sections',
    tabs: {
      identity: 'Identity',
      preferences: 'Preferences',
      catchUp: 'Catch-up',
    },

    name: {
      label: 'Display name',
      hint: 'Shown instead of the path. Blank falls back to the path.',
      save: 'Save',
      failed: 'Could not save the name',
    },
    type: {
      label: 'Type',
      hint: 'Used on hledger export. Auto infers it from the path.',
      /** The Auto option says what inference would pick, so it is not a blind choice. */
      auto: (inferred: string) => `Auto (inferred: ${inferred})`,
      /** What inference yields for an atypical root: nothing. */
      unclassified: 'unclassified',
      failed: 'Could not save the type',
      options: {
        asset: 'Asset',
        cash: 'Cash',
        liability: 'Liability',
        equity: 'Equity',
        income: 'Income',
        expense: 'Expense',
        conversion: 'Conversion',
      },
    },
    currency: {
      label: 'Default currency',
      hint: 'Pre-selects the currency when you add a transaction here.',
      /** No pin of its own: fall back to the user's preferred currency. */
      fallback: (currency: string) => `Default (${currency})`,
      failed: 'Could not save the currency',
    },
    sidebar: {
      label: 'Show in sidebar',
      hint: 'Hidden accounts stay reachable from Accounts.',
      failed: 'Could not save sidebar visibility',
    },
    tracked: {
      label: 'Track this account',
      hint: 'Whether the coach asks you to keep this account up to date.',
      failed: 'Could not save tracking',
    },
    statements: {
      label: 'Statements',
      hint: 'A card only produces data when its cycle closes; most other accounts export any range.',
      range: 'Any date range',
      cycle: 'Statement cycle',
      failed: 'Could not save the statement cycle',
    },
    cycleDay: {
      label: 'Cycle closes on',
      hint: 'Clamped to the last day of shorter months.',
    },
    releaseLag: {
      label: 'Available after',
      hint: 'Days between the cycle closing and the statement being downloadable.',
      sameDay: 'Same day',
      days: (n: number) => plural(n, '1 day', `${n} days`),
      failed: 'Could not save the release lag',
    },

    /** Scoped to the name: the other rows are already on the server. */
    unsaved: 'Closing discards the unsaved name.',
  },

  /** The status a self-committing settings row reports, in the order it reports it. */
  saveRow: {
    saving: 'Saving…',
    saved: 'Saved',
    retry: 'Retry',
  },

  categories: {
    loadFailed: 'Could not load categories.',
    empty: 'No categories yet — add one above.',
    /** The empty-only filter is on and has nothing to show. */
    noneEmpty: 'Nothing empty here.',
    caption: 'Categories, grouped by root',

    search: 'Search categories',
    view: 'View',
    viewLabel: 'Category view',
    views: {
      tree: 'Tree',
      flat: 'Flat',
    },
    emptyCount: (n: number) => plural(n, '1 empty', `${n} empty`),
    showAll: 'Show every category again',
    showEmptyOnly:
      'Show only categories with no entries — the ones that can be deleted',

    addPlaceholder: 'expenses:travel:flights',
    addLabel: 'New category path',
    add: 'Add',
    adding: 'Adding…',
    added: (path: string) => `Added ${path}`,
    addFailed: 'Could not add that category',

    columns: {
      category: 'Category',
      entries: 'Entries',
      used: 'Last used',
      flags: 'Flags',
      actions: 'Actions',
    },
    /** The unit beside a section's entry count. */
    entryUnit: (n: number) => plural(n, 'entry', 'entries'),

    foldAll: 'Fold all',
    foldHint: 'Fold or unfold every branch in this section',
    foldBlocked: 'A filtered tree stays open — clear the filter to fold it',
    expand: (path: string) => `Expand ${path}`,
    collapse: (path: string) => `Collapse ${path}`,

    /** A path with no account of its own — it exists because something beneath it does. */
    virtual: 'category',
    virtualHint:
      'No account was filed at this path — it exists because something beneath it does',
    /** No entries and nothing beneath it: the only kind that can be deleted. */
    emptyFlag: 'empty',

    rename: (path: string) => `Rename ${path}`,
    renameHint: 'Rename',
    renameCascadeHint: 'Rename — this renames everything beneath it too',
    saveName: 'Save name',
    cancelRename: 'Cancel rename',
    renamed: (path: string) => `Renamed to ${path}`,
    renameFailed: 'Rename failed',
    collision: (path: string) =>
      `“${path}” already exists — merging isn't supported yet`,

    delete: (path: string) => `Delete ${path}`,
    deleteHint: 'Delete this category',
    deleteNothingHint: 'Nothing was filed here, so there is nothing to delete',
    deleteBlockedHint:
      'Only a category with no entries and nothing beneath it can be deleted',
    deleted: (path: string) => `Deleted ${path}`,
    deleteFailed: 'Could not delete that category',

    renameDialog: {
      title: 'Rename category',
      confirm: 'Rename all',
      busy: 'Renaming…',
      summary: (n: number) =>
        plural(
          n,
          'This renames 1 account; its entries stay attached, only the name changes.',
          `This renames ${n} accounts; their entries stay attached, only the name changes.`,
        ),
    },
    deleteDialog: {
      title: 'Delete category',
      confirm: 'Delete',
      busy: 'Deleting…',
      /**
       * The path is on its own line above this, as it is in the rename dialog. It used to
       * be spliced into the middle — "Delete `x`? It has no entries" — which is one
       * sentence that cannot be held in one message.
       */
      question:
        'Delete this category? It has no entries and nothing filed beneath it.',
    },

    /** Typed into the quick-add box or the rename field, answered as you type. */
    validation: {
      nameEmpty: 'A name cannot be empty',
      nameSeparator: 'A name cannot contain a colon',
      pathShape: 'Use single colons between names, with no blank segments',
      pathExists: 'That account already exists',
    },
  },

  quickEntry: {
    title: 'Quick Entry',
    currency: 'Currency',
    description: 'Description',
    removeRow: 'Remove row',
    offsetPlaceholder: 'expenses:…',
    addRow: '+ Add row',
    saving: 'Saving…',
    save: (n: number) =>
      plural(n, 'Save 1 transaction', `Save ${n} transactions`),
    failed: 'Failed to save transactions.',
  },

  reconcile: {
    title: (account: string) => `Reconcile — ${account}`,
    statementDate: 'Statement date',
    statementBalance: 'Statement balance',
    ledgerBalance: 'Ledger balance',
    difference: 'Difference',
    balanced: 'Ledger is balanced.',
    posted: 'Adjustment posted.',
    /** `date` is already formatted — the modal reconciles to a day, not to a timestamp. */
    markedComplete: (date: string) =>
      `Marks this account complete through ${date}.`,
    willMarkComplete: (date: string) =>
      `Posting the adjustment also marks this account complete through ${date}.`,
    noAdjustmentsAccount:
      'No adjustments account configured — set one in Settings before posting.',
    checking: 'Checking…',
    check: 'Check balance',
    posting: 'Posting…',
    post: 'Post adjustment',
    checkFailed: 'Failed to fetch balance.',
    noAdjustmentsAccountSet:
      'No adjustments account set. Configure one in Settings.',
    postFailed: 'Failed to post adjustment.',
    /** Written into the ledger, so the user reads it again on export. */
    adjustmentDescription: (account: string) =>
      `Reconciliation adjustment — ${account}`,
  },
} as const
