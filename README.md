
  # gooseCalendar

  This is a code bundle for gooseCalendar. The original project is available at https://www.figma.com/design/cXWJ96U55q4nqCQtRD6OGO/gooseCalendar.

  ## Running the code

  Run `npm i` to install the dependencies.

  Run `npm run dev` to start the development server.

  ## Google Calendar export

  To enable the Google Calendar button, create a `.env.local` file based on `.env.example` and set:

  `VITE_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com`

  The OAuth client needs your local and production domains added as Authorized JavaScript origins in Google Cloud.

  Google export uses one GooseCalendar-managed Google calendar per event type so the selected hex palette can be preserved exactly.
  It now requests narrower Google Calendar permissions that are limited to GooseCalendar-created calendars and the user's calendar list, instead of the full broad calendar scope.
  
