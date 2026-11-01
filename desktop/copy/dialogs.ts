// The words main shows itself, in dialogs before the window exists.

import type { Failure } from '@have-fish/core/outcome'

const TITLE = "have-fish can't open your ledger"

function cannotOpen(failure: Failure): { title: string; message: string } {
  switch (failure.code) {
    case 'LEDGER_TOO_NEW':
      return {
        title: TITLE,
        message:
          `${failure.details.path} was saved by a newer version of have-fish. ` +
          'Update the app to open it. Nothing was changed.',
      }
    case 'LEDGER_UNREADABLE':
      return {
        title: TITLE,
        message:
          `${failure.details.path} isn't a have-fish ledger, or it's damaged. ` +
          'Nothing was changed.',
      }
    default:
      return { title: TITLE, message: `It was refused as ${failure.code}. Nothing was changed.` }
  }
}

const failedToStart = {
  title: "have-fish couldn't start",
  message: 'Something went wrong opening your ledger. Start have-fish from a terminal to see why.',
}

export const dialogs = { cannotOpen, failedToStart }
