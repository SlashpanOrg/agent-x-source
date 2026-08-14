/**
 * WhatsApp Tools — barrel export for all Phase 6 tool handlers.
 *
 * This file re-exports every WhatsApp tool handler so the toolkit
 * registration in toolkit.ts can import from a single location.
 */
// Session tools (Phase 6.1)
export {
  whatsappLinkSession,
  whatsappGetSessionStatus,
  whatsappStopSession,
  whatsappUnlinkSession,
  whatsappRequestPairingCode,
} from './session-tools.js';
export {
  whatsappStandingOrderList,
  whatsappStandingOrderUpsert,
  whatsappStandingOrderRevoke,
} from './standing-order-tools.js';

// Messaging tools (Phase 6.2)
export {
  whatsappSendText,
  whatsappSendImage,
  whatsappSendVideo,
  whatsappSendAudio,
  whatsappSendDocument,
  whatsappSendLocation,
  whatsappSendContact,
  whatsappSendPoll,
  whatsappSendSticker,
  whatsappReply,
  whatsappForward,
  whatsappReact,
  whatsappEditMessage,
  whatsappDeleteMessage,
  whatsappGetMessageHistory,
  whatsappGetReactions,
} from './messaging-tools.js';

// Bulk send-safety tools (Phase 6.3)
export {
  whatsappSendBulk,
  whatsappGetBatchStatus,
  whatsappCancelBatch,
} from './bulk-tools.js';

// Contact tools (Phase 6.4)
export {
  whatsappCheckNumber,
  whatsappBlockContact,
  whatsappUnblockContact,
  whatsappListContacts,
  whatsappGetContact,
  whatsappGetProfilePicture,
  whatsappResolveContact,
  whatsappRememberContactAlias,
  whatsappSyncContacts,
} from './contact-tools.js';

// Group tools (Phase 6.5)
export {
  whatsappCreateGroup,
  whatsappGetGroupInfo,
  whatsappAddParticipants,
  whatsappRemoveParticipants,
  whatsappPromoteParticipant,
  whatsappDemoteParticipant,
  whatsappSetGroupSubject,
  whatsappSetGroupDescription,
  whatsappLeaveGroup,
  whatsappJoinGroupByInvite,
} from './group-tools.js';

// Label tools (Phase 6.6)
export {
  whatsappListLabels,
  whatsappGetChatLabels,
  whatsappAddLabelToChat,
  whatsappRemoveLabelFromChat,
} from './label-tools.js';

// Status/Channel/Call/Profile tools (Phase 6.7)
export {
  whatsappPostTextStatus,
  whatsappPostImageStatus,
  whatsappListStatusUpdates,
  whatsappSubscribeChannel,
  whatsappListChannels,
  whatsappRejectCall,
  whatsappSetProfileName,
  whatsappSetProfileStatus,
  whatsappSetProfilePicture,
} from './status-profile-tools.js';

// Webhook tools (Phase 6.8)
export {
  whatsappCreateWebhook,
  whatsappListWebhooks,
  whatsappUpdateWebhook,
  whatsappDeleteWebhook,
  whatsappTestWebhook,
} from './webhook-tools.js';
