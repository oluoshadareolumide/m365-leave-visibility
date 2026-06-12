/**
 * Local development mock of the Office.js runtime.
 *
 * Only installed in dev builds (when __DEV_MODE__ is true) so the taskpane can
 * render in a plain browser — no Outlook host and no Entra ID SSO required.
 *
 * The mock recipients below intentionally match the sample leave data seeded by
 * the backend (server/src/data/mockData.ts), so you see real statuses:
 *   from : Alice Smith   (On Leave)
 *   to   : Bob Jones     (Returning Soon)
 *          Carol White   (Upcoming leave)
 *   cc   : Dave Brown    (On Leave + delegate)
 *          Erin Davis    (Available)
 */
export function installMockOffice(): void {
  const mockItem = {
    itemType: 'message',
    from: { emailAddress: 'alice.smith@contoso.com', displayName: 'Alice Smith' },
    to: [
      { emailAddress: 'bob.jones@contoso.com', displayName: 'Bob Jones' },
      { emailAddress: 'carol.white@contoso.com', displayName: 'Carol White' },
    ],
    cc: [
      { emailAddress: 'dave.brown@contoso.com', displayName: 'Dave Brown' },
      { emailAddress: 'erin.davis@contoso.com', displayName: 'Erin Davis' },
    ],
  };

  const mockOffice = {
    onReady: (cb?: (info: { host: string; platform: string }) => void) => {
      const info = { host: 'Outlook', platform: 'OfficeOnline' };
      if (cb) cb(info);
      return Promise.resolve(info);
    },
    context: {
      mailbox: {
        item: mockItem,
        userProfile: {
          emailAddress: 'dev.user@contoso.com',
          displayName: 'Dev User',
        },
      },
    },
    auth: {
      getAccessToken: () => Promise.resolve('dev-token'),
    },
    AsyncResultStatus: { Succeeded: 'succeeded', Failed: 'failed' },
    MailboxEnums: {
      ItemNotificationMessageType: { InformationalMessage: 'informationalMessage' },
    },
  };

  (window as unknown as { Office: unknown }).Office = mockOffice;
  // eslint-disable-next-line no-console
  console.info('[Leave Visibility] DEV MODE: mock Office runtime installed.');
}
