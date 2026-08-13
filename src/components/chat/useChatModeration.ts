"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { actOnChannelReport, submitModerationPetition } from "@/lib/api-chat";
import type { Message, PetitionMeta, ReportMeta } from "./chatTypes";

interface BannerState {
  text: string;
  color: string;
}

interface OwnerModerationState {
  status: "active" | "warned" | "suspended" | "frozen";
  petitionStatus: "none" | "open" | "accepted" | "rejected";
}

interface ModerationText {
  ownerSuspendedPetitionOpen: string;
  ownerSuspendedPetitionRejected: string;
  ownerSuspendedBanner: string;
  reportResolvedBanner: string;
  reportDismissedBanner: string;
  warnOwnerSentBanner: string;
  channelFrozenByModerationBanner: string;
  channelUnfrozenByModerationBanner: string;
  channelDeletedByModerationBanner: string;
  reportAlreadyProcessed: string;
  channelAlreadyFrozen: string;
  channelNotFrozen: string;
  freezeBeforeDelete: string;
  petitionPendingReview: string;
  reportActionFailed: string;
  petitionAccepted: string;
  petitionRejected: string;
  petitionAlreadyProcessed: string;
  petitionActionFailed: string;
  moderationPetitionSubmitted: string;
  petitionExists: string;
  petitionUnavailable: string;
  petitionRequired: string;
  moderationPetitionFailed: string;
}

interface UseChatModerationArgs {
  isOwner: boolean;
  effectiveAdmin: boolean;
  dmMode: boolean;
  channelFrozen: boolean;
  viewerModerationStatus: "frozen" | null | undefined;
  ownerModeration?: OwnerModerationState;
  channelId: string;
  setOwnerModeration: Dispatch<SetStateAction<OwnerModerationState | undefined>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setBanner: Dispatch<SetStateAction<BannerState | null>>;
  setShowModerationPetitionDialog: Dispatch<SetStateAction<boolean>>;
  refreshOwnerModeration: () => void;
  text: ModerationText;
}

interface UseChatModerationResult {
  ownerModerationBlocked: boolean;
  viewerModerationBlocked: boolean;
  canUseAdminMutations: boolean;
  ownerCanSubmitPetition: boolean;
  ownerModerationBannerText: string;
  reportActionPendingId: string | null;
  submittingModerationPetition: boolean;
  handleReportAction: (
    report: ReportMeta,
    action: "warn_owner" | "freeze_channel" | "unfreeze_channel" | "delete_channel" | "resolve" | "dismiss",
  ) => Promise<void>;
  handlePetitionAction: (
    petition: PetitionMeta,
    action: "accept_petition" | "reject_petition" | "unfreeze_channel",
  ) => Promise<void>;
  handleModerationPetitionSubmit: (text: string) => Promise<void>;
}

interface ReportInboxUpdate {
  message_id: string;
  report: ReportMeta;
  message_text: string;
}

export function useChatModeration({
  isOwner,
  effectiveAdmin,
  dmMode,
  channelFrozen,
  viewerModerationStatus,
  ownerModeration,
  channelId,
  setOwnerModeration,
  setMessages,
  setBanner,
  setShowModerationPetitionDialog,
  refreshOwnerModeration,
  text,
}: UseChatModerationArgs): UseChatModerationResult {
  const [reportActionPendingId, setReportActionPendingId] = useState<string | null>(null);
  const [submittingModerationPetition, setSubmittingModerationPetition] = useState(false);

  const ownerModerationBlocked = isOwner && ownerModeration?.status === "frozen";
  const viewerModerationBlocked = !isOwner
    && !effectiveAdmin
    && !dmMode
    && channelFrozen
    && viewerModerationStatus === "frozen";
  const canUseAdminMutations = effectiveAdmin && !ownerModerationBlocked;
  const ownerPetitionStatus = ownerModeration?.petitionStatus || "none";
  const ownerCanSubmitPetition = ownerModerationBlocked && ownerPetitionStatus === "none";
  const ownerModerationBannerText = ownerPetitionStatus === "open"
    ? text.ownerSuspendedPetitionOpen
    : ownerPetitionStatus === "rejected"
      ? text.ownerSuspendedPetitionRejected
      : text.ownerSuspendedBanner;

  const patchReportMessage = useCallback((reportId: string, update: (message: Message) => Message) => {
    setMessages((previous) => previous.map((message) => {
      if (message.report_meta?.report_id !== reportId) return message;
      return update(message);
    }));
  }, [setMessages]);

  const patchPetitionMessage = useCallback((petitionId: string, update: (message: Message) => Message) => {
    setMessages((previous) => previous.map((message) => {
      if (message.petition_meta?.petition_id !== petitionId) return message;
      return update(message);
    }));
  }, [setMessages]);

  const applyReportInboxUpdates = useCallback((updates: ReportInboxUpdate[] | undefined) => {
    if (!updates?.length) return;
    const updatesByMessageId = new Map(updates.map((update) => [update.message_id, update]));
    setMessages((previous) => previous.map((message) => {
      const update = updatesByMessageId.get(message.id);
      if (!update) return message;
      return {
        ...message,
        text: update.message_text,
        edited: true,
        report_meta: update.report,
      };
    }));
  }, [setMessages]);

  const handleReportAction = useCallback(async (
    report: ReportMeta,
    action: "warn_owner" | "freeze_channel" | "unfreeze_channel" | "delete_channel" | "resolve" | "dismiss",
  ) => {
    if (reportActionPendingId) return;
    setReportActionPendingId(report.report_id);
    try {
      const result = await actOnChannelReport({
        report_id: report.report_id,
        action,
      }) as {
        ok?: boolean;
        error?: string;
        report?: ReportMeta;
        message_text?: string;
        report_updates?: ReportInboxUpdate[];
      };

      if (result?.ok && result.report) {
        if (result.report_updates?.length) {
          applyReportInboxUpdates(result.report_updates);
        } else {
          patchReportMessage(report.report_id, (message) => ({
            ...message,
            text: result.message_text || message.text,
            edited: true,
            report_meta: result.report,
          }));
        }
        const reportActionBanner = {
          resolve: { text: text.reportResolvedBanner, color: "#2a9d4e" },
          dismiss: { text: text.reportDismissedBanner, color: "var(--meta)" },
          warn_owner: { text: text.warnOwnerSentBanner, color: "#b26a00" },
          freeze_channel: { text: text.channelFrozenByModerationBanner, color: "#8b5cf6" },
          unfreeze_channel: { text: text.channelUnfrozenByModerationBanner, color: "#2a9d4e" },
          delete_channel: { text: text.channelDeletedByModerationBanner, color: "#d32f2f" },
        } as const;
        setBanner(reportActionBanner[action]);
      } else if (result?.ok && action === "delete_channel") {
        patchReportMessage(report.report_id, (message) => ({
          ...message,
          text: result.message_text || message.text,
          edited: true,
          report_meta: message.report_meta
            ? { ...message.report_meta, status: "resolved", moderation_status: "frozen" }
            : message.report_meta,
        }));
        setBanner({ text: text.channelDeletedByModerationBanner, color: "#d32f2f" });
      } else if (result?.error === "report_already_processed") {
        setBanner({ text: text.reportAlreadyProcessed, color: "var(--meta)" });
      } else if (result?.error === "channel_already_frozen") {
        setBanner({ text: text.channelAlreadyFrozen, color: "var(--meta)" });
      } else if (result?.error === "channel_not_frozen") {
        setBanner({ text: text.channelNotFrozen, color: "var(--meta)" });
      } else if (result?.error === "freeze_required_before_delete") {
        setBanner({ text: text.freezeBeforeDelete, color: "var(--meta)" });
      } else if (result?.error === "petition_pending") {
        setBanner({ text: text.petitionPendingReview, color: "var(--meta)" });
      } else {
        setBanner({ text: text.reportActionFailed, color: "#d32f2f" });
      }
      setTimeout(() => setBanner(null), 3000);
    } finally {
      setReportActionPendingId(null);
    }
  }, [applyReportInboxUpdates, patchReportMessage, reportActionPendingId, setBanner, text]);

  const handlePetitionAction = useCallback(async (
    petition: PetitionMeta,
    action: "accept_petition" | "reject_petition" | "unfreeze_channel",
  ) => {
    if (reportActionPendingId) return;
    setReportActionPendingId(petition.petition_id);
    try {
      const result = await actOnChannelReport({
        petition_id: petition.petition_id,
        action,
      }) as {
        ok?: boolean;
        error?: string;
        petition?: PetitionMeta;
        message_text?: string;
        report_updates?: ReportInboxUpdate[];
      };

      if (result?.ok && result.petition) {
        applyReportInboxUpdates(result.report_updates);
        patchPetitionMessage(petition.petition_id, (message) => ({
          ...message,
          text: result.message_text || message.text,
          edited: true,
          petition_meta: result.petition,
        }));
        setBanner({
          text: action === "accept_petition"
            ? text.petitionAccepted
            : action === "reject_petition"
              ? text.petitionRejected
              : text.channelUnfrozenByModerationBanner,
          color: action === "accept_petition" || action === "unfreeze_channel" ? "#2a9d4e" : "#d32f2f",
        });
      } else if (result?.error === "petition_already_processed") {
        setBanner({ text: text.petitionAlreadyProcessed, color: "var(--meta)" });
      } else if (result?.error === "channel_not_frozen") {
        setBanner({ text: text.channelNotFrozen, color: "var(--meta)" });
      } else {
        setBanner({ text: text.petitionActionFailed, color: "#d32f2f" });
      }
      setTimeout(() => setBanner(null), 3000);
    } finally {
      setReportActionPendingId(null);
    }
  }, [applyReportInboxUpdates, patchPetitionMessage, reportActionPendingId, setBanner, text]);

  const handleModerationPetitionSubmit = useCallback(async (petitionText: string) => {
    if (submittingModerationPetition) return;
    setSubmittingModerationPetition(true);
    try {
      const result = await submitModerationPetition(channelId, petitionText.trim()) as { ok?: boolean; error?: string };
      if (result?.ok) {
        setOwnerModeration((previous) => previous
          ? { ...previous, status: "frozen", petitionStatus: "open" }
          : { status: "frozen", petitionStatus: "open" });
        setShowModerationPetitionDialog(false);
        setBanner({ text: text.moderationPetitionSubmitted, color: "#2a9d4e" });
      } else if (result?.error === "petition_exists") {
        setOwnerModeration((previous) => previous
          ? { ...previous, status: "frozen", petitionStatus: "open" }
          : previous);
        setShowModerationPetitionDialog(false);
        setBanner({ text: text.petitionExists, color: "var(--meta)" });
      } else if (result?.error === "petition_unavailable") {
        refreshOwnerModeration();
        setBanner({ text: text.petitionUnavailable, color: "var(--meta)" });
      } else if (result?.error === "petition_required") {
        setBanner({ text: text.petitionRequired, color: "#d32f2f" });
      } else {
        setBanner({ text: text.moderationPetitionFailed, color: "#d32f2f" });
      }
      setTimeout(() => setBanner(null), 3000);
    } finally {
      setSubmittingModerationPetition(false);
    }
  }, [channelId, refreshOwnerModeration, setBanner, setOwnerModeration, setShowModerationPetitionDialog, submittingModerationPetition, text]);

  return {
    ownerModerationBlocked,
    viewerModerationBlocked,
    canUseAdminMutations,
    ownerCanSubmitPetition,
    ownerModerationBannerText,
    reportActionPendingId,
    submittingModerationPetition,
    handleReportAction,
    handlePetitionAction,
    handleModerationPetitionSubmit,
  };
}
