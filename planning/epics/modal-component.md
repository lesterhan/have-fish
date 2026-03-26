# Epic: Reusable Modal Component

Goal: Build a reusable `Modal.svelte` component that wraps arbitrary content in an XP-style popup window. This is a foundational UI primitive needed by several upcoming epics (add-account-wizard, manual-transaction-entry, transactions-edit-ux).

## Background

Several features need a focused overlay UI — a wizard, a form, a confirmation dialog. Rather than building one-off solutions per feature, we need a shared modal primitive that handles the chrome, focus trapping, backdrop, and dragging so each feature only has to worry about its content.

---

## Stories

### 1. Modal shell — static, centered

Frontend / `lib/components/Modal.svelte`.

- Renders a fixed-position backdrop (`rgba(0,0,0,0.4)`) covering the viewport
- Inside: a window panel using `--color-window` with an XP-style title bar (navy-to-sky gradient, white title text)
- Close button (`✕`) in the top-right of the title bar — raised bevel at rest, sunken on press
- `open` prop (bindable) controls visibility; `title` prop sets the title bar text
- `children` snippet renders inside the window body
- Clicking the backdrop closes the modal
- `Escape` key closes the modal
- `onclose` callback prop for parent to react to close events
- `role="dialog"` + `aria-modal="true"` + `aria-labelledby` pointing at the title element

### 2. Smoke test button on Assets page

Frontend / Assets page.

- Add an "Add new account" button to the top of the assets page
- Clicking it opens a `<Modal title="Add Account">` with placeholder text "The Modal Is Ajar"
- Used to verify the modal shell works in context before building real content into it

### 3. Focus trap

Frontend / `Modal.svelte`.

- While open, Tab/Shift+Tab cycles only through focusable elements inside the modal
- Focus moves into the modal when it opens (first focusable element or the close button)
- Focus returns to the trigger element when the modal closes

### 4. Drag to move

Frontend / `Modal.svelte`.

- Dragging the title bar repositions the window
- Implemented via `pointerdown` on the title bar + `pointermove`/`pointerup` on the window
- Use `setPointerCapture` so drag continues if the pointer leaves the title bar
- Apply `transform: translate(x, y)` — does not fight with the centered default position
- Position resets when the modal closes

### 5. Integrate into add-account-wizard

Frontend / Add Account button on Import page.

- Replace whatever placeholder trigger exists with a `<Modal title="Add Account">` wrapper
- Smoke test: modal opens, can be closed, can be dragged

### 6. Integrate into manual-transaction-entry

Frontend / Transactions page.

- "New Transaction" button opens a `<Modal title="New Transaction">` wrapper
- Smoke test: same as above
