import { describe, expect, it } from "vitest";
import {
  downloadProgressSchema,
  modelManifestSchema,
  modelStatusInfoSchema,
} from "./localModels.js";

const exampleFile = {
  filename: "encoder.int8.onnx",
  url: "https://cdn.example.com/models/demo/encoder.int8.onnx",
  sha256: "a".repeat(64),
  sizeBytes: 123456,
};

const exampleModel = {
  id: "demo-model",
  name: "Demo Model",
  version: "1.0.0",
  engine: "sherpa-onnx",
  quantization: "int8",
  files: [exampleFile],
  languages: ["en"],
  minRamGb: 4,
  recommendedRamGb: 8,
  minVramGb: 0,
  recommendedVramGb: 0,
  license: "CC-BY-4.0",
  attribution: "Example attribution",
  supportedOs: ["windows"],
  supportedArch: ["x64"],
};

const exampleManifest = { manifestVersion: 1, models: [exampleModel] };

describe("localModels schemas", () => {
  it("accepts a valid manifest", () => {
    expect(modelManifestSchema.safeParse(exampleManifest).success).toBe(true);
  });

  it("rejects path traversal in filenames but allows safe subpaths", () => {
    const bad = {
      ...exampleManifest,
      models: [
        {
          ...exampleModel,
          files: [{ ...exampleFile, filename: "../evil.onnx" }],
        },
      ],
    };
    expect(modelManifestSchema.safeParse(bad).success).toBe(false);
    const good = {
      ...exampleManifest,
      models: [
        {
          ...exampleModel,
          files: [{ ...exampleFile, filename: "tokenizer/vocab.json" }],
        },
      ],
    };
    expect(modelManifestSchema.safeParse(good).success).toBe(true);
  });

  it("rejects non-HTTPS download URLs", () => {
    const bad = {
      ...exampleManifest,
      models: [
        {
          ...exampleModel,
          files: [{ ...exampleFile, url: "http://cdn.example.com/x" }],
        },
      ],
    };
    expect(modelManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects malformed sha256", () => {
    const bad = {
      ...exampleManifest,
      models: [
        {
          ...exampleModel,
          files: [{ ...exampleFile, sha256: "not-a-hash" }],
        },
      ],
    };
    expect(modelManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects duplicate model ids and filenames", () => {
    const dupId = {
      ...exampleManifest,
      models: [exampleModel, exampleModel],
    };
    expect(modelManifestSchema.safeParse(dupId).success).toBe(false);
    const dupFile = {
      ...exampleManifest,
      models: [{ ...exampleModel, files: [exampleFile, exampleFile] }],
    };
    expect(modelManifestSchema.safeParse(dupFile).success).toBe(false);
  });

  it("rejects recommended RAM below minimum RAM", () => {
    const bad = {
      ...exampleManifest,
      models: [{ ...exampleModel, recommendedRamGb: 2 }],
    };
    expect(modelManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts status info and download progress shapes", () => {
    expect(
      modelStatusInfoSchema.safeParse({
        id: "demo-model",
        status: "downloading",
        downloadedBytes: 10,
        totalBytes: 100,
      }).success,
    ).toBe(true);
    expect(
      downloadProgressSchema.safeParse({
        id: "demo-model",
        downloadedBytes: 10,
        totalBytes: 100,
        bytesPerSecond: 5,
        etaSeconds: 18,
      }).success,
    ).toBe(true);
    expect(
      modelStatusInfoSchema.safeParse({
        id: "demo-model",
        status: "bogus",
        downloadedBytes: 0,
        totalBytes: 0,
      }).success,
    ).toBe(false);
  });
});
