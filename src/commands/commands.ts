/* global Office */

Office.onReady(() => {
  // Function commands are registered here.
  // These are called by Office when a button with xsi:type="ExecuteFunction" is clicked.
});

/**
 * Opens the leave visibility taskpane programmatically.
 * Not currently wired to a manifest button but available for future use.
 */
export function openLeavePane(event: Office.AddinCommands.Event): void {
  const message: Office.NotificationMessageDetails = {
    type: Office.MailboxEnums.ItemNotificationMessageType.InformationalMessage,
    message: 'Opening Leave Visibility panel…',
    icon: 'Icon.32x32',
    persistent: false,
  };

  Office.context.mailbox.item?.notificationMessages.addAsync(
    'leaveVisibility',
    message,
    () => event.completed()
  );
}
