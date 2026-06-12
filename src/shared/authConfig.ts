declare const __CLIENT_ID__: string;
declare const __TENANT_ID__: string;
declare const __ADDIN_URL__: string;

export const msalConfig = {
  auth: {
    clientId: typeof __CLIENT_ID__ !== 'undefined' ? __CLIENT_ID__ : '',
    authority: `https://login.microsoftonline.com/${
      typeof __TENANT_ID__ !== 'undefined' ? __TENANT_ID__ : 'common'
    }`,
    redirectUri:
      typeof __ADDIN_URL__ !== 'undefined'
        ? `${__ADDIN_URL__}/taskpane.html`
        : 'https://localhost:3000/taskpane.html',
  },
  cache: {
    cacheLocation: 'sessionStorage' as const,
    storeAuthStateInCookie: false,
  },
};

export const loginRequest = {
  scopes: ['openid', 'profile', 'email', 'User.Read'],
};
