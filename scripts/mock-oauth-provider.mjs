import { createServer } from "node:http";

/**
 * A minimal fake OAuth 2.0 provider.
 *
 * Lets the verification suite drive the REAL authorization-code + PKCE flow
 * end to end (redirect -> code -> token -> profile) without contacting Google,
 * GitHub or Microsoft. It also records what it was asked for, so the suite can
 * assert that the PKCE challenge was correct and that the client secret never
 * reached the browser.
 */
export async function startMockProvider() {
  const state = {
    /** Authorization requests received: [{ challenge, method, state, redirectUri, scope }] */
    authRequests: [],
    /** Bodies posted to the token endpoint. */
    tokenRequests: [],
    lastCode: null,
    // Controls what /userinfo returns.
    profile: {
      sub: "mock-subject-1",
      email: "oauth.user@example.com",
      email_verified: true,
      name: "OAuth User",
      picture: null,
    },
    /** When set, the token endpoint returns 400 (simulates a rejected code). */
    rejectToken: false,
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${server.address().port}`);

    if (url.pathname === "/authorize") {
      state.authRequests.push({
        challenge: url.searchParams.get("code_challenge"),
        method: url.searchParams.get("code_challenge_method"),
        state: url.searchParams.get("state"),
        redirectUri: url.searchParams.get("redirect_uri"),
        scope: url.searchParams.get("scope"),
        clientId: url.searchParams.get("client_id"),
      });
      const code = `code-${state.authRequests.length}`;
      state.lastCode = code;
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { Location: back.toString() });
      res.end();
      return;
    }

    if (url.pathname === "/token" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const params = new URLSearchParams(body);
        state.tokenRequests.push({
          code: params.get("code"),
          verifier: params.get("code_verifier"),
          clientSecret: params.get("client_secret"),
          clientId: params.get("client_id"),
          redirectUri: params.get("redirect_uri"),
        });

        res.setHeader("Content-Type", "application/json");
        if (state.rejectToken) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "invalid_grant" }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ access_token: "mock-access-token", token_type: "Bearer" }));
      });
      return;
    }

    if (url.pathname === "/userinfo") {
      res.setHeader("Content-Type", "application/json");
      res.writeHead(200);
      res.end(JSON.stringify(state.profile));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    state,
    origin: `http://127.0.0.1:${port}`,
    authorizeUrl: `http://127.0.0.1:${port}/authorize`,
    tokenUrl: `http://127.0.0.1:${port}/token`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
