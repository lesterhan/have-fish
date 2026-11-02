// Every word the app shows, in one object that main and the window both read:
// `copy.spends.pane.save`. Import `copy`, never a file's own export, so a word is found from
// the screen it's on. `copy.test.ts` fails on a word written anywhere else.
//
// The rules, as in the web app:
// 1. A message owns its whole sentence: never one built from two keys and a conditional.
// 2. A message that varies is a function with named, typed parameters.
// 3. Formatted data isn't copy: amounts and dates go through their formatters.
// 4. One file per surface.
//
// No i18n library and no `en/` folder: a typed object is the whole design, and a second
// language, if one comes, is a translation of these files.

import { actions } from './actions'
import { app } from './app'
import { dialogs } from './dialogs'
import { errors } from './errors'
import { spends } from './spends'

export const copy = { actions, app, dialogs, errors, spends } as const
