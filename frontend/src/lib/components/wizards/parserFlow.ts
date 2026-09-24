// Step transitions shared by the Add Account and Add Parser wizards: a first step of
// their own, then the parser steps, then confirm. "Skip" jumps from the parser upload
// straight to confirm and marks the parser skipped so submit leaves it out.
//
// Invariant: `parserSkipped` is only ever true while sitting on confirm. Leaving confirm
// by going back clears it, so a parser filled in after a skip is not silently dropped on
// submit (BUG-001, #256).

export const PARSER_STEP = {
  UPLOAD: 'parser-upload',
  COLUMNS: 'parser-columns',
  MULTICURRENCY: 'parser-multicurrency',
  CONFIRM: 'confirm',
} as const

type ParserStep = (typeof PARSER_STEP)[keyof typeof PARSER_STEP]

export interface FlowState<First extends string> {
  step: First | ParserStep
  parserSkipped: boolean
}

export function parserFlow<First extends string>(first: First) {
  type State = FlowState<First>

  function next(s: State, isMultiCurrency: boolean): State {
    switch (s.step) {
      case PARSER_STEP.UPLOAD:
        return { step: PARSER_STEP.COLUMNS, parserSkipped: false }
      case PARSER_STEP.COLUMNS:
        return {
          step: isMultiCurrency ? PARSER_STEP.MULTICURRENCY : PARSER_STEP.CONFIRM,
          parserSkipped: false,
        }
      case PARSER_STEP.MULTICURRENCY:
        return { step: PARSER_STEP.CONFIRM, parserSkipped: false }
      case PARSER_STEP.CONFIRM:
        return s
      default:
        return { step: PARSER_STEP.UPLOAD, parserSkipped: false }
    }
  }

  function back(s: State, isMultiCurrency: boolean): State {
    switch (s.step) {
      case PARSER_STEP.UPLOAD:
        return { step: first, parserSkipped: false }
      case PARSER_STEP.COLUMNS:
        return { step: PARSER_STEP.UPLOAD, parserSkipped: false }
      case PARSER_STEP.MULTICURRENCY:
        return { step: PARSER_STEP.COLUMNS, parserSkipped: false }
      case PARSER_STEP.CONFIRM:
        return {
          step: s.parserSkipped
            ? PARSER_STEP.UPLOAD
            : isMultiCurrency
              ? PARSER_STEP.MULTICURRENCY
              : PARSER_STEP.COLUMNS,
          parserSkipped: false,
        }
      default:
        return s
    }
  }

  function skip(): State {
    return { step: PARSER_STEP.CONFIRM, parserSkipped: true }
  }

  return { next, back, skip }
}
