import { describe, expect, it } from "vitest";
import { isNoticeRelevantToMode } from "./DictateView.js";

describe("isNoticeRelevantToMode", () => {
  it("hides cloud errors while in local mode (the reported bug)", () => {
    expect(
      isNoticeRelevantToMode(
        "Cloud mode needs a Groq key — paste one in Dictate, or switch to Local (offline) in Settings.",
        true,
      ),
    ).toBe(false);
    expect(isNoticeRelevantToMode("Groq key saved to OS keyring.", true)).toBe(
      false,
    );
    expect(
      isNoticeRelevantToMode(
        "No local model — pick one in Settings → Local.",
        true,
      ),
    ).toBe(true);
  });

  it("keeps cloud-relevant hints while in cloud mode", () => {
    expect(
      isNoticeRelevantToMode(
        "Cloud mode needs a Groq key — paste one in Dictate, or switch to Local (offline) in Settings.",
        false,
      ),
    ).toBe(true);
    // The offline hint belongs to cloud mode (no connectivity) even
    // though it mentions "offline" — it must survive filtering.
    expect(
      isNoticeRelevantToMode(
        "Offline — switch to Local (offline) in Settings to transcribe without internet.",
        false,
      ),
    ).toBe(true);
    expect(
      isNoticeRelevantToMode(
        "No local model — pick one in Settings → Local.",
        false,
      ),
    ).toBe(false);
  });

  it("passes generic errors through in both modes", () => {
    for (const msg of [
      "Microphone blocked — allow access, then hold again.",
      "Copied — press Ctrl+V to paste.",
      "Transcription failed — check microphone and try again.",
    ]) {
      expect(isNoticeRelevantToMode(msg, true)).toBe(true);
      expect(isNoticeRelevantToMode(msg, false)).toBe(true);
    }
  });
});
