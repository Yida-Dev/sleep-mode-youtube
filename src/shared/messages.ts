import type {
  MeteringData,
  PipelineStatus,
  WorkletParams,
  VocalWorkletParams,
} from "./types";

// -- Popup --> Background --> Content Script --

export type PopupToContentMessage =
  | { type: "SET_ENABLED"; enabled: boolean }
  | { type: "SET_PRESET"; presetId: string }
  | { type: "SET_MASTER_GAIN"; gainDb: number }
  | { type: "SET_EQ_ENABLED"; enabled: boolean }
  | { type: "SET_VOCAL_ENHANCE"; enabled: boolean }
  | { type: "GET_STATUS" };

// -- Content Script --> Background --> Popup --

export type ContentToPopupMessage =
  | { type: "STATUS"; data: PipelineStatus }
  | { type: "METERING"; data: MeteringData };

// -- Content Script main thread <-> AudioWorklet --

export type WorkletInboundMessage = {
  type: "SET_PARAMS";
  params: WorkletParams;
};

export type WorkletOutboundMessage = {
  type: "METERING";
  lufs: number;
  gainReductionDb: number;
  inputPeakDb: number;
};

// -- Vocal worklet messages --

export type VocalWorkletInboundMessage = {
  type: "SET_PARAMS";
  params: VocalWorkletParams;
};

// -- Union type for all chrome.runtime messages --

export type ExtensionMessage = PopupToContentMessage | ContentToPopupMessage;

// -- Type guard helpers --

export function isPopupToContentMessage(
  msg: unknown
): msg is PopupToContentMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as { type?: string };
  return (
    m.type === "SET_ENABLED" ||
    m.type === "SET_PRESET" ||
    m.type === "SET_MASTER_GAIN" ||
    m.type === "SET_EQ_ENABLED" ||
    m.type === "SET_VOCAL_ENHANCE" ||
    m.type === "GET_STATUS"
  );
}

export function isContentToPopupMessage(
  msg: unknown
): msg is ContentToPopupMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as { type?: string };
  return m.type === "STATUS" || m.type === "METERING";
}
