/**
 * SDK collection switches shared by the server and the browser bundle.
 * `beforeSend` scrubbing is the second layer. These stop the SDK from attaching
 * cookies, bodies, local variables, and user identity in the first place.
 */
export function sentryPrivacyOptions(): {
  sendDefaultPii: false;
  dataCollection: {
    userInfo: false;
    cookies: false;
    httpHeaders: {
      request: { deny: string[] };
      response: false;
    };
    httpBodies: [];
    urlQueryParams: { deny: string[] };
    databaseQueryData: false;
    stackFrameVariables: false;
    genAI: { inputs: false; outputs: false };
    graphQL: { document: false; variables: false };
  };
} {
  return {
    sendDefaultPii: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: {
          deny: [
            "authorization",
            "proxy-authorization",
            "cookie",
            "set-cookie",
            "x-admin-token",
            "x-list-owner",
            "x-api-key",
            "x-auth-token",
            "kroger",
          ],
        },
        response: false,
      },
      httpBodies: [],
      urlQueryParams: {
        deny: [
          "access_token",
          "refresh_token",
          "id_token",
          "client_secret",
          "api_key",
          "apikey",
          "token",
          "code",
          "state",
          "password",
          "auth",
          "key",
          "signature",
          "kroger_shopper",
        ],
      },
      databaseQueryData: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
    },
  };
}
