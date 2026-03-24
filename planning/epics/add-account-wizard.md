# Epic

Goal: Create an account onboarding wizard. A button component that will pop up a modal that adds an account with all the needed info that immediately makes it usable. It will have steps that gets the following info:

- Account path hints. "Is this account a.." buttons "asset" "liability" "equity"
  - Clicking on the button will pre-fill the AccountPathInput with "assets:" "liabilities:" "equity:" respectively
  - The label text "Or just start typing:" with the AccountPathInput
- A optional input field for "Starting balance"
- Next page is a skipable set up for a parser.
  - Button to upload a csv.
  - Automatically detect the title row.
  - Checkbox for "multi currency account"
    - Add an tooltip hint
  - Offer the column mappings, with multi currency support
- Final confirmation page that shows the account, the parser mapping for this account.

Add this button component to the top of the Import page, so a user can add an account without leaving this page, and import a csv for a new account quickly.
