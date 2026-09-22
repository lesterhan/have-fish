// The whole app is client-rendered. There is no server to render on: the build is a
// directory of static files, and every route below resolves in the browser.
//
// This is what removes the per-page auth round trip. Previously `hooks.server.ts` called
// `/api/auth/get-session` before any markup was produced, so the first byte of every page
// waited on a request to the backend — two hops from anywhere far from the server, and a
// blank screen when the backend was unreachable.
export const ssr = false
export const prerender = false
