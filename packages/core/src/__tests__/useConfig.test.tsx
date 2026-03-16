import { describe, it, expect, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToPulumi } from "../render-to-pulumi.js";
import { setPulumiSDK } from "../pulumi-bridge.js";
import { pulumiToComponent } from "../wrap.js";
import { resetConfigCache } from "../hooks/useConfig.js";
import { useConfig } from "../hooks/useConfig.js";

// Mock resource
class MockBucket {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly opts: Record<string, unknown>;
  constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
    this.name = name;
    this.args = args;
    this.opts = opts ?? {};
  }
}

const [Bucket] = pulumiToComponent(MockBucket as never, "aws:s3:Bucket");

function createMockPulumiSDK(configStore: Record<string, string> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynamicResources: any[] = [];

  return {
    Config: class MockConfig {
      private ns: string;
      constructor(ns?: string) {
        this.ns = ns ?? "__project__";
      }
      get(key: string): string | undefined {
        // Try namespaced first, then bare key
        return configStore[`${this.ns}:${key}`] ?? configStore[key];
      }
    },
    dynamic: {
      Resource: class MockDynamicResource {
        constructor(provider: unknown, name: string, inputs: Record<string, unknown>) {
          dynamicResources.push({ name, provider, inputs });
        }
      },
    },
    _dynamicResources: dynamicResources,
  };
}

beforeEach(() => {
  resetConfigCache();
});

describe("useConfig", () => {
  it("reads a bare config key", () => {
    const sdk = createMockPulumiSDK({ replicas: "5" });
    setPulumiSDK(sdk);

    let captured = "";
    function App() {
      const replicas = useConfig("replicas", "2");
      captured = replicas ?? "";
      return createElement(Bucket, { name: `bucket-${replicas}` });
    }

    renderToPulumi(App)();
    expect(captured).toBe("5");
  });

  it("returns default when key is missing", () => {
    const sdk = createMockPulumiSDK({});
    setPulumiSDK(sdk);

    let captured = "";
    function App() {
      const replicas = useConfig("replicas", "3");
      captured = replicas ?? "";
      return createElement(Bucket, { name: `bucket-${replicas}` });
    }

    renderToPulumi(App)();
    expect(captured).toBe("3");
  });

  it("returns undefined when key is missing and no default", () => {
    const sdk = createMockPulumiSDK({});
    setPulumiSDK(sdk);

    let captured: string | undefined = "NOT_SET";
    function App() {
      captured = useConfig("missing");
      return createElement(Bucket, { name: "b" });
    }

    renderToPulumi(App)();
    expect(captured).toBeUndefined();
  });

  it("reads a namespaced config key (aws:region)", () => {
    const sdk = createMockPulumiSDK({ "aws:region": "us-west-2" });
    setPulumiSDK(sdk);

    let captured = "";
    function App() {
      const region = useConfig("aws:region");
      captured = region ?? "";
      return createElement(Bucket, { name: `bucket-${region}` });
    }

    renderToPulumi(App)();
    expect(captured).toBe("us-west-2");
  });

  it("reads multiple config keys in one component", () => {
    const sdk = createMockPulumiSDK({
      "aws:region": "eu-west-1",
      replicas: "10",
    });
    setPulumiSDK(sdk);

    let capturedRegion = "";
    let capturedReplicas = "";
    function App() {
      capturedRegion = useConfig("aws:region") ?? "";
      capturedReplicas = useConfig("replicas", "1") ?? "";
      return createElement(Bucket, { name: `bucket-${capturedRegion}-${capturedReplicas}` });
    }

    renderToPulumi(App)();
    expect(capturedRegion).toBe("eu-west-1");
    expect(capturedReplicas).toBe("10");
  });

  it("caches Config instances across multiple calls with same namespace", () => {
    let configConstructCount = 0;
    const configStore: Record<string, string> = { "aws:region": "us-east-1", "aws:profile": "prod" };

    const sdk = {
      Config: class MockConfig {
        private ns: string;
        constructor(ns?: string) {
          configConstructCount++;
          this.ns = ns ?? "__project__";
        }
        get(key: string): string | undefined {
          return configStore[`${this.ns}:${key}`];
        }
      },
      dynamic: {
        Resource: class { constructor() {} },
      },
    };
    setPulumiSDK(sdk);

    function App() {
      useConfig("aws:region");
      useConfig("aws:profile"); // same "aws" namespace — should reuse Config
      return createElement(Bucket, { name: "b" });
    }

    renderToPulumi(App)();
    // Only 2 Config instances: one for "aws", one for "react-pulumi" (internal state config)
    expect(configConstructCount).toBe(2);
  });

  it("works with nested components", () => {
    const sdk = createMockPulumiSDK({ env: "production" });
    setPulumiSDK(sdk);

    let innerCapture = "";
    function Inner() {
      innerCapture = useConfig("env", "dev") ?? "";
      return createElement(Bucket, { name: `bucket-${innerCapture}` });
    }

    function App() {
      return createElement(Inner);
    }

    renderToPulumi(App)();
    expect(innerCapture).toBe("production");
  });
});
