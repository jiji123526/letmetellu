export interface OwnerPlanState {
  hasPlus: boolean;
  ownedChannelLimit: number;
  features: {
    channelCustomization: boolean;
    channelFreeze: boolean;
    liveSessions: boolean;
  };
}
