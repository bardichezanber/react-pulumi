import { createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetStackRefCache, useStackOutput } from "../hooks/useStackOutput.js";
import { setPulumiSDK } from "../pulumi-bridge.js";
import { renderToPulumi } from "../render-to-pulumi.js";
import { pulumiToComponent } from "../wrap.js";

// Mock resource
class MockSecurityGroup {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly opts: Record<string, unknown>;
  constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
    this.name = name;
    this.args = args;
    this.opts = opts ?? {};
  }
}

const [SecurityGroup] = pulumiToComponent(MockSecurityGroup as never, "aws:ec2:SecurityGroup");

// Mock Pulumi Output — a simple wrapper that holds a value
class MockOutput {
  constructor(public readonly _value: unknown) {}
}

function createMockPulumiSDK(stackOutputs: Record<string, Record<string, unknown>> = {}) {
  const stackRefsCreated: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynamicResources: any[] = [];

  return {
    Config: class MockConfig {
      get(): string | undefined {
        return undefined;
      }
    },
    StackReference: class MockStackReference {
      private stackName: string;
      constructor(stackName: string) {
        stackRefsCreated.push(stackName);
        this.stackName = stackName;
      }
      getOutput(key: string): MockOutput {
        const outputs = stackOutputs[this.stackName] ?? {};
        return new MockOutput(outputs[key]);
      }
    },
    dynamic: {
      Resource: class MockDynamicResource {
        constructor(provider: unknown, name: string, inputs: Record<string, unknown>) {
          dynamicResources.push({ name, provider, inputs });
        }
      },
    },
    _stackRefsCreated: stackRefsCreated,
    _dynamicResources: dynamicResources,
  };
}

beforeEach(() => {
  resetStackRefCache();
});

describe("useStackOutput", () => {
  it("returns an output from another stack", () => {
    const sdk = createMockPulumiSDK({
      "org/network/prod": { vpcId: "vpc-123" },
    });
    setPulumiSDK(sdk);

    let capturedVpcId: unknown = null;
    function App() {
      capturedVpcId = useStackOutput("org/network/prod", "vpcId");
      return createElement(SecurityGroup, { name: "sg", vpcId: capturedVpcId });
    }

    renderToPulumi(App)();
    expect(capturedVpcId).toBeInstanceOf(MockOutput);
    expect((capturedVpcId as MockOutput)._value).toBe("vpc-123");
  });

  it("returns undefined output for missing key", () => {
    const sdk = createMockPulumiSDK({
      "org/network/prod": { vpcId: "vpc-123" },
    });
    setPulumiSDK(sdk);

    let captured: unknown = "NOT_SET";
    function App() {
      captured = useStackOutput("org/network/prod", "nonexistent");
      return createElement(SecurityGroup, { name: "sg" });
    }

    renderToPulumi(App)();
    expect(captured).toBeInstanceOf(MockOutput);
    expect((captured as MockOutput)._value).toBeUndefined();
  });

  it("reads multiple outputs from the same stack", () => {
    const sdk = createMockPulumiSDK({
      "org/network/prod": { vpcId: "vpc-123", subnetId: "subnet-456" },
    });
    setPulumiSDK(sdk);

    let capturedVpc: unknown = null;
    let capturedSubnet: unknown = null;
    function App() {
      capturedVpc = useStackOutput("org/network/prod", "vpcId");
      capturedSubnet = useStackOutput("org/network/prod", "subnetId");
      return createElement(SecurityGroup, { name: "sg" });
    }

    renderToPulumi(App)();
    expect((capturedVpc as MockOutput)._value).toBe("vpc-123");
    expect((capturedSubnet as MockOutput)._value).toBe("subnet-456");
  });

  it("caches StackReference for the same stack name", () => {
    const sdk = createMockPulumiSDK({
      "org/network/prod": { vpcId: "vpc-123", subnetId: "subnet-456" },
    });
    setPulumiSDK(sdk);

    function App() {
      useStackOutput("org/network/prod", "vpcId");
      useStackOutput("org/network/prod", "subnetId"); // same stack — should reuse
      return createElement(SecurityGroup, { name: "sg" });
    }

    renderToPulumi(App)();
    // Only 1 StackReference created for "org/network/prod"
    expect(sdk._stackRefsCreated).toEqual(["org/network/prod"]);
  });

  it("creates separate StackReferences for different stacks", () => {
    const sdk = createMockPulumiSDK({
      "org/network/prod": { vpcId: "vpc-prod" },
      "org/network/staging": { vpcId: "vpc-staging" },
    });
    setPulumiSDK(sdk);

    let capturedProd: unknown = null;
    let capturedStaging: unknown = null;
    function App() {
      capturedProd = useStackOutput("org/network/prod", "vpcId");
      capturedStaging = useStackOutput("org/network/staging", "vpcId");
      return createElement(SecurityGroup, { name: "sg" });
    }

    renderToPulumi(App)();
    expect(sdk._stackRefsCreated).toEqual(["org/network/prod", "org/network/staging"]);
    expect((capturedProd as MockOutput)._value).toBe("vpc-prod");
    expect((capturedStaging as MockOutput)._value).toBe("vpc-staging");
  });

  it("works in nested components", () => {
    const sdk = createMockPulumiSDK({
      "org/network/prod": { vpcId: "vpc-nested" },
    });
    setPulumiSDK(sdk);

    let captured: unknown = null;
    function Inner() {
      captured = useStackOutput("org/network/prod", "vpcId");
      return createElement(SecurityGroup, { name: "sg", vpcId: captured });
    }

    function App() {
      return createElement(Inner);
    }

    renderToPulumi(App)();
    expect((captured as MockOutput)._value).toBe("vpc-nested");
  });

  it("passes output directly into resource props", () => {
    const sdk = createMockPulumiSDK({
      "org/network/prod": { vpcId: "vpc-abc" },
    });
    setPulumiSDK(sdk);

    const createdResources: MockSecurityGroup[] = [];
    const OrigCtor = MockSecurityGroup;
    // Temporarily track created resources
    class TrackingSecurityGroup extends OrigCtor {
      constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
        super(name, args, opts);
        createdResources.push(this);
      }
    }
    const [TrackedSG] = pulumiToComponent(TrackingSecurityGroup as never, "aws:ec2:TrackedSG");

    function App() {
      const vpcId = useStackOutput("org/network/prod", "vpcId");
      return createElement(TrackedSG, { name: "sg", vpcId });
    }

    renderToPulumi(App)();
    expect(createdResources).toHaveLength(1);
    // The vpcId prop should be the MockOutput instance
    expect(createdResources[0].args.vpcId).toBeInstanceOf(MockOutput);
    expect((createdResources[0].args.vpcId as MockOutput)._value).toBe("vpc-abc");
  });
});
