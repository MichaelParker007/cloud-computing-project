import { AuthConfig } from 'angular-oauth2-oidc';

export const authConfig: AuthConfig = {
  issuer: 'https://accounts.google.com',
  strictDiscoveryDocumentValidation: false,

  clientId: '348933755247-43f27tovii99ekmu8c80jveld7jn1k21.apps.googleusercontent.com',

  redirectUri: window.location.origin + '/login',
  postLogoutRedirectUri: window.location.origin + '/login',

  responseType: 'id_token token',
  scope: 'openid profile email',

  showDebugInformation: true,
  useSilentRefresh: false,
};
