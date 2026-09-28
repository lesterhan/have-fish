/**
 * Import: the page and its five steps, the parsers that read a bank's CSV, the rules that
 * pre-fill a row, and the two wizards that set a parser up — everything under
 * `lib/components/import`, `lib/components/wizards` and `routes/(authed)/import`.
 *
 * Organised by the component that speaks, in the order a statement meets them: the File
 * step, Accounts, Sort, Review, Confirm, then the parser and rule screens either side of the
 * flow. The one exception is `parser.fields`, which three screens share — the Add Parser
 * wizard, the Add Account wizard's parser steps and the Edit Parser panel ask the same eight
 * questions about the same columns, and each had its own copy of the words until this file.
 * Two of those copies had already drifted: the edit panel's tooltips were shorter than the
 * wizard's, and said less.
 *
 * Every count sentence is a function over `plural`, and every toast that reports more than
 * one outcome is one function that composes its own clauses — `imported({ created, … })`
 * rather than three fragments glued at the call site.
 *
 * What is deliberately *not* here: amounts, currency codes, dates, account paths, merchant
 * stems and file names. They are the statement's own data and arrive as parameters. The
 * example paths in placeholders (`expenses:food…`) *are* here: they are advice, not data.
 */
import { plural } from './plural'

export const importCopy = {
  page: {
    tabs: {
      import: 'Import',
      export: 'Export',
      rules: 'Rules',
    },
    /** Shown wherever the flow knows the import account is a debt. */
    liabilities: 'Imported as liabilities',
  },

  /** The stepper across the top of an import in progress. */
  steps: {
    label: 'Import progress',
    file: 'File',
    accounts: 'Accounts',
    sort: 'Sort',
    review: 'Review',
    confirm: 'Confirm',
  },

  /**
   * The strip above everything when the Catch-Up Coach sent the user here. Each reads as a
   * lead phrase followed by the account, so the path can stay bold without a sentence being
   * cut in half around it.
   */
  coach: {
    catchingUp: 'Catching up',
    /** Said only when the coach's account never came up — the path is the fallback's own. */
    unknownAccount: 'that account',
    askedAbout: 'The coach asked about',
    mismatch: "This file posts somewhere else. Importing is fine — it just won't close that gap.",
  },

  /** An import left half-done, offered back on the next visit. */
  resume: {
    lead: 'Unfinished import',
    /** `age` is already a phrase — `describeAge` in `import-session.ts` formats it. */
    meta: (rows: number, age: string) =>
      plural(rows, `1 row · saved ${age}`, `${rows} rows · saved ${age}`),
    discard: 'Discard',
    resume: 'Resume',
    justNow: 'just now',
  },

  /** Step 1, before a file is parsed. */
  file: {
    choose: 'Choose CSV…',
    dropHint: 'or drop a file here',
    remove: 'Remove file',
    size: (kilobytes: string) => `${kilobytes} KB`,
    preview: 'Preview import',
    parsing: 'Parsing…',
    defaults: 'Defaults',
    noUncategorized: 'no uncategorized account',
    defaultCurrency: 'Default currency',
    defaultCurrencyHint: "The currency to use when the CSV doesn't specify one.",
    uncategorized: 'Uncategorized account',
    uncategorizedHint: 'Transactions with no matching import rule are posted to this account.',
    accountPlaceholder: 'Select or create an account…',
    required: 'File and default currency are required.',
    parseFailed: 'Failed to parse the CSV. Please check the file and try again.',
    /**
     * Beside the error when no parser matched. It used to send the reader to Settings, which
     * has never had a parsers section — the parsers live on this page, and the button opens
     * the wizard directly.
     */
    noParserHint: 'Add one for it, then preview the file again.',
    noParserAction: 'Add parser',
  },

  /** Step 1, once the file is parsed: what was read, and the one override. */
  summary: {
    liabilitiesHint:
      'This account is a debt, so a charge on the statement increases what you owe. Amounts are stored negated to match.',
    facts: {
      parser: 'Parser',
      rows: 'Rows',
      dates: 'Dates',
      currency: 'Currency',
      unparsed: 'Unparsed',
    },
    override: 'Override',
    following: 'following the account',
    byHand: 'set by hand',
    importAsLiabilities: 'Import as liabilities',
    overrideHint:
      "Follows the import account's path by default. Change it only when the statement's signs don't match the account.",
    discard: 'Discard import',
    continue: 'Continue',
  },

  discard: {
    title: 'Discard import',
    body: (rows: number) =>
      plural(
        rows,
        '1 row and every account assignment made so far will be discarded. This cannot be undone.',
        `${rows} rows and every account assignment made so far will be discarded. This cannot be undone.`,
      ),
    keep: 'Keep working',
    confirm: 'Discard import',
  },

  export: {
    blurb:
      'Download all your data as an hledger-compatible journal file. This is your escape hatch — nothing is locked in.',
    from: 'From',
    fromHint: 'Leave both dates empty to export everything.',
    to: 'To',
    run: 'Export journal',
    running: 'Exporting…',
    failed: 'Failed to export journal.',
  },

  /** Step 2: which of the user's accounts each currency in the file belongs to. */
  accounts: {
    heading: 'Where does this money live?',
    currencies: (n: number) =>
      plural(
        n,
        'This file holds 1 currency. It needs an account.',
        `This file holds ${n} currencies. Each needs an account.`,
      ),
    suggestion:
      "The suggestion follows your account naming, but you can point a currency anywhere — including at an account that doesn't match the pattern.",
    single: 'Every row in this file posts to one account.',
    account: 'Account',
    placeholder: 'Select or create…',
    singlePlaceholder: 'Select or create an account…',
    needsAccount: 'needs an account',
    matchesNaming: 'matches your naming',
    custom: 'custom',
    required: 'required',
    back: 'Back',
    continue: 'Continue to review',
    stillToMap: (n: number) => `${n} still to map`,
  },

  /** Step 3: merchants that repeat, assigned in one go. */
  sort: {
    heading: 'Repeat merchants',
    repeats: (n: number) =>
      plural(n, '1 merchant appears more than once.', `${n} merchants appear more than once.`),
    intro:
      'Assign each one here and its rows drop out of the review list. Anything you skip is still waiting in Review.',
    mixedCurrencies: 'mixed currencies',
    removeSplit: 'Remove split',
    override: 'Override…',
    placeholder: 'expenses:groceries…',
    split: 'Split with group',
    splitHint: 'Split with a Fish Pie group',
    remember: 'remember',
    matchedBy: (pattern: string) => `matched by rule «${pattern}»`,
    editedByHand: 'edited by hand',
    skipped: 'skipped',
    back: 'Back',
    overrideAll: (n: number) => `Override all ${n}`,
    skip: 'Skip',
    applying: 'Applying…',
    nothing: 'Nothing to apply',
    /** The Apply button: the rows it writes, and the rules it will remember, if any. */
    apply: (rows: number, rules: number) => {
      const writes = plural(rows, 'Apply to 1 row', `Apply to ${rows} rows`)
      if (rules === 0) return writes
      return `${writes} · ${plural(rules, '1 rule', `${rules} rules`)}`
    },
    /** The toast once Apply has run. */
    applied: (rows: number, rules: number) => {
      const assigned = plural(rows, '1 row assigned', `${rows} rows assigned`)
      if (rules === 0) return assigned
      return `${assigned}, ${plural(rules, '1 rule saved', `${rules} rules saved`)}`
    },
    ruleFailed: (stem: string, reason: string) =>
      `Applied ${stem}, but the rule could not be saved: ${reason}`,
    unknownError: 'unknown error',
  },

  /** Step 4: the review table. */
  review: {
    title: (parser: string) => `Review — ${parser}`,
    progress: (reviewed: number, total: number) => `${reviewed} of ${total} reviewed`,
    unmappedLead: 'Flipping a row to convert-and-park needs an account for',
    unmapped: (n: number) =>
      plural(
        n,
        'Go back to the Accounts step to map it.',
        'Go back to the Accounts step to map them.',
      ),
    unfinished: (n: number) => plural(n, '1 still needs an account', `${n} still need an account`),
    cancel: 'Cancel',
    continue: 'Continue to confirm',
    filtersLabel: 'Filter rows',
    filters: {
      all: 'All',
      needsReview: 'Needs review',
      auto: 'Auto',
      done: 'Done',
      skipped: 'Skipped',
    },
    /** Printed beside its key legend, as `label: value` rather than a sentence around it. */
    nextUnreviewed: 'Next unreviewed row',
    nextUnreviewedKey: 'n',
    columns: {
      date: 'Date',
      description: 'Description',
      amount: 'Amount',
      currency: 'Currency',
      toAccount: 'To account',
      fishPie: 'Fish Pie',
      skip: 'Skip',
    },
    emptyFilter: 'Nothing here — every row is accounted for under this filter.',
  },

  /** A row that could not be read, wherever it is listed. */
  rowNumber: (row: number) => `Row ${row}`,
  unparsed: (n: number) =>
    plural(
      n,
      '1 row could not be parsed and will be skipped.',
      `${n} rows could not be parsed and will be skipped.`,
    ),

  /** One row of the review table, regular or transfer. */
  row: {
    /** A duplicate that is a Fish Pie entry names its group, which follows as a link. */
    fishPieMatch: {
      expense: 'Fish Pie split in',
      settlement: 'Fish Pie settlement in',
    },
    duplicate: {
      certain: (match: string) => `Already imported: ${match}`,
      possible: (match: string) => `Possible duplicate: ${match}`,
    },
    /** The small labels in front of each account field. */
    fields: {
      split: 'split',
      to: 'to',
      expense: 'expense',
      via: 'via',
      source: 'source',
      fee: 'fee',
    },
    fee: (amount: string) => `fee ${amount}`,
    prefilled: (pattern: string) => `Pre-filled by import rule «${pattern}»`,
    saveRule: 'Save as import rule',
    alwaysSplit: (stem: string) => `Always split “${stem}” this way`,
    alwaysSend: (stem: string) => `Always send “${stem}” here`,
    placeholders: {
      account: 'Select or create…',
      expense: 'expenses:food…',
      conversion: 'equity:conversion…',
      source: 'Source account…',
      fee: 'expenses:fees…',
    },
    removeSplit: 'Remove Fish Pie split',
    split: 'Split with group',
    toConversion: 'Switch to conversion',
    toConversionHint: 'Actually a conversion into an account you hold — not a spend',
    toSpend: 'Switch to spend',
    toSpendHint: 'Actually a spend in a currency you don’t hold — not a conversion',
  },

  /** The split picker that drops down from a row. */
  split: {
    chooseSplit: 'Choose split…',
    chooseCategory: 'Choose category…',
    recent: 'Recent',
    noCategory: 'No category',
    recentNoCategory: (group: string) => `${group} · No category`,
  },

  /** Step 5: the last look before anything is written. */
  confirm: {
    count: (n: number) => plural(n, '1 transaction', `${n} transactions`),
    via: (parser: string) => `via ${parser}`,
    mixedCurrencies: 'mixed currencies',
    uncategorized: 'uncategorized',
    uncategorizedHint: 'These rows were never assigned an account',
    nothing: 'Every row is skipped — there is nothing to import.',
    skippedDuplicates: (n: number) => `Skipped as duplicates: ${n}`,
    skippedByHand: (n: number) => `Skipped by hand: ${n}`,
    rulesCreated: (n: number) => `Import rules created: ${n}`,
    accountsCreated: (n: number) => `Accounts created: ${n}`,
    review: 'review',
    more: (n: number) => `${n} more`,
    incomplete: (n: number) =>
      plural(n, '1 row still needs an account:', `${n} rows still need an account:`),
    noDescription: 'no description',
    covers: 'This file covers',
    coveredFrom: 'Covered from',
    coveredThrough: 'Covered through',
    coverageBackwards: 'The start date has to come before the end date.',
    coverageFromCoach:
      'The range the coach asked for. A statement can cover days with no transactions on them, so this is usually wider than the dates in the file — leave it as the statement period rather than the first and last row.',
    coverageFromFile:
      'Taken from the dates in the file. Widen it if the statement period starts before its first transaction.',
    /** Only said when there is more than one, so it needs no singular. */
    coverageAccounts: (n: number) => `Recorded against all ${n} accounts this file posts to.`,
    back: 'Back to review',
    importing: 'Importing…',
    toFix: (n: number) => plural(n, '1 row to fix', `${n} rows to fix`),
    run: (n: number) => plural(n, 'Import 1 transaction', `Import ${n} transactions`),
  },

  /** The manifest's labels for a destination it cannot name from the ledger. */
  manifest: {
    unknownGroup: 'Fish Pie group',
    noAccount: 'No account assigned',
  },

  /** What committing says, and what stops it. */
  commit: {
    fromRequired: 'From account is required.',
    unmapped: (n: number, currencies: string) =>
      plural(
        n,
        `No account mapped for ${currencies}. Go back to Accounts to map it.`,
        `No account mapped for ${currencies}. Go back to Accounts to map them.`,
      ),
    incomplete: 'All transactions must have accounts assigned.',
    /**
     * The toast. The backend skips rows it has imported before even when the review missed
     * them (#282), so it says how many — otherwise a short count reads as rows gone missing.
     */
    imported: ({
      created,
      fishPie,
      skipped,
    }: {
      created: number
      fishPie: number
      skipped: number
    }) => {
      const clauses = [
        plural(created, '1 transaction imported', `${created} transactions imported`),
      ]
      if (fishPie > 0) clauses.push(`${fishPie} added to Fish Pie`)
      if (skipped > 0) clauses.push(`${skipped} already imported`)
      return clauses.join(', ')
    },
    coverageFailed: 'Imported, but the covered range could not be recorded',
    failed: 'Import failed. Please try again.',
    ruleFailed: 'Could not save the rule.',
    ruleSaved: (stem: string, applied: number) =>
      applied === 0
        ? `Rule saved for “${stem}”`
        : plural(
            applied,
            `Rule saved for “${stem}” — applied to 1 more row`,
            `Rule saved for “${stem}” — applied to ${applied} more rows`,
          ),
  },

  /**
   * Parsers: the table on the import page, the panel that edits one, and the wizard that
   * adds one — on its own, or as the second half of adding an account.
   */
  parser: {
    panel: {
      title: 'Parsers',
      add: 'Add parser',
      columns: {
        name: 'Name',
        account: 'Account',
        multiCurrency: 'Multi-currency',
        feeAccount: 'Fee account',
        configure: 'Configure',
      },
      empty: 'No parsers 🕵️',
      yes: 'Yes',
      no: 'No',
    },

    /** The questions every parser form asks, in the order it asks them. */
    fields: {
      name: 'Parser name',
      namePlaceholder: 'e.g. Imre Trust Visa',
      file: 'CSV file',
      detectedHeader: 'Detected header',
      delimiter: 'Delimiter',
      delimiterHint:
        "Auto-detected from the file. Override it if the columns below didn't split correctly (some banks export semicolon- or tab-separated CSVs).",
      columns: 'Columns',
      noColumns: 'No columns — try a different delimiter.',
      multiCurrency: 'Multi-currency',
      multiCurrencyHint:
        'Enable for banks that encode transfers inline (e.g. Wise). Source, target, and fee columns will be mapped separately.',
      date: 'Date',
      amount: 'Amount',
      description: 'Description',
      currency: 'Currency',
      direction: 'Direction column',
      directionHint:
        'For banks that put IN/OUT in a separate column (e.g. Wise). Select the column and enter the value that means debit/OUT.',
      negativeValue: 'Negative value',
      negativePlaceholder: 'e.g. OUT',
      sourceAmount: 'Source amount',
      sourceCurrency: 'Source currency',
      targetAmount: 'Target amount',
      targetCurrency: 'Target currency',
      feeAmount: 'Fee amount',
      feeCurrency: 'Fee currency',
      /** The empty option of a column a parser needs. */
      select: '— select —',
      /** The empty option of a column a parser can do without. */
      notMapped: '— not mapped —',
    },

    /** Delimiter names, each followed by the character itself. */
    delimiters: {
      comma: 'Comma  ,',
      semicolon: 'Semicolon  ;',
      tab: 'Tab  ⇥',
      pipe: 'Pipe  |',
    },

    edit: {
      title: (name: string) => `Edit parser — ${name}`,
      general: 'General',
      name: 'Name',
      defaultAccount: 'Default account',
      accountPlaceholder: 'Select or create…',
      feeAccount: 'Fee account',
      feePlaceholder: 'expenses:fees…',
      mapping: 'Column mapping',
      multiCurrency: 'Multi-currency columns',
      cancel: 'Cancel',
      save: 'Save',
      saving: 'Saving…',
      failed: 'Failed to save parser.',
    },

    /** The summary on a wizard's last step. */
    summary: {
      account: 'Account',
      path: 'Path',
      startingBalance: 'Starting balance',
      balanceDate: 'Balance date',
      noOffset: 'No offset account set — starting balance will be skipped. Set one in Settings.',
      parser: 'CSV Parser',
      none: 'No parser configured.',
      name: 'Name',
      date: 'Date column',
      amount: 'Amount column',
      description: 'Description column',
      direction: 'Direction column',
      negativeValue: 'Negative value',
      multiCurrency: 'Multi-currency',
      yes: 'Yes',
    },
  },

  /** The two wizards' furniture. */
  wizard: {
    addParser: 'Add Import Parser',
    account: 'Account',
    accountPlaceholder: 'Select an account…',
    back: 'Back',
    next: 'Next',
    skip: 'Skip',
    confirm: 'Confirm',
    creating: 'Creating…',
    failed: 'Something went wrong.',
  },

  addAccount: {
    titles: {
      asset: 'Add New Asset Account',
      liability: 'Add New Liability Account',
      equity: 'Add New Equity Account',
    },
    path: 'Account path',
    startingBalance: 'Starting balance',
    optional: '(optional)',
    balanceDate: 'Balance date',
    /** The description on the transaction that posts a starting balance. */
    openingBalance: 'Opening balance',
    createFailed: 'Failed to create account.',
    balanceFailed: 'Account created but failed to post starting balance.',
    parserFailed: 'Account created but failed to save parser.',
  },

  /** The rules page, and the target editor it shares with nothing else. */
  rules: {
    back: 'Back',
    backHint: 'Back to Import + Export',
    title: 'Active rules',
    add: 'Add rule',
    columns: {
      pattern: 'Pattern',
      target: 'Target',
    },
    empty: 'No active rules. Add one or approve a suggestion.',
    patternPlaceholder: 'e.g. LOBLAWS',
    save: 'Save',
    edit: 'Edit',
    delete: 'Delete',
    suggestions: 'Suggestions',
    denied: 'Denied',
    mine: 'Mine',
    mining: 'Mining…',
    mineHint: 'Analyze to find patterns in transaction history.',
    loading: 'Loading…',
    nothingMined: 'Nothing came up.',
    notMined: 'Click Mine to analyze your transaction history.',
    matches: (n: number) => plural(n, '1 match', `${n} matches`),
    approve: 'Approve',
    deny: 'Deny',
    revive: 'Revive',
    noneDenied:
      "Denied suggestions are hidden here. Mining won't suggest them again until you revive one.",
    noneFound: 'No new suggestions found.',
    found: (n: number) => plural(n, '1 suggestion added.', `${n} suggestions added.`),

    target: {
      kindLabel: 'Rule target kind',
      account: 'Account',
      split: 'Split',
      accountPlaceholder: 'Select account…',
      group: 'Group',
      selectGroup: 'Select group…',
      category: 'Category',
      uncategorized: 'Uncategorized',
    },
  },
} as const
