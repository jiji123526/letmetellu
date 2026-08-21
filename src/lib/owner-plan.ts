export interface OwnerPlanBillingSummary {
  sourceType: string;
  provider: string | null;
  currentPeriodEndsAt: string | null;
  autoRenews: boolean;
  isGrandfathered: boolean;
}

export interface OwnerPlanState {
  hasPlus: boolean;
  ownedChannelLimit: number;
  billingSummary?: OwnerPlanBillingSummary | null;
  features: {
    channelCustomization: boolean;
    channelFreeze: boolean;
    liveSessions: boolean;
  };
  channelRetention?: {
    ownedChannelCount: number;
    retainedChannelId: string | null;
    effectiveAt: string | null;
    selectionRequired: boolean;
    locksActive: boolean;
  };
}

export interface ViewerPlanState {
  hasPlus: boolean;
  features: {
    personalBubbleColor: boolean;
  };
}
