/**
 * State Machine Demo — Phase 1 + Phase 2 features:
 * useState, VizInput, VizButton, pulumiToComponent
 */

import { pulumiToComponent, VizButton, VizInput } from "@react-pulumi/core";
import { createElement, Fragment, useState } from "react";

// Mock resources
class MockVpc {
  static __pulumiType = "aws:ec2/vpc:Vpc";
  name: string;
  args: Record<string, unknown>;
  constructor(n: string, a: Record<string, unknown>) {
    this.name = n;
    this.args = a;
  }
}
class MockInstance {
  static __pulumiType = "aws:ec2/instance:Instance";
  name: string;
  args: Record<string, unknown>;
  constructor(n: string, a: Record<string, unknown>) {
    this.name = n;
    this.args = a;
  }
}
class MockSG {
  static __pulumiType = "aws:ec2/securityGroup:SecurityGroup";
  name: string;
  args: Record<string, unknown>;
  constructor(n: string, a: Record<string, unknown>) {
    this.name = n;
    this.args = a;
  }
}

const [Vpc] = pulumiToComponent(MockVpc as never);
const [Instance] = pulumiToComponent(MockInstance as never);
const [SG] = pulumiToComponent(MockSG as never);

export default function App() {
  const [replicas, setReplicas] = useState(2);
  const [instanceType, setInstanceType] = useState("t3.micro");
  const [region, setRegion] = useState("us-west-2");
  const [env, setEnv] = useState("production");

  return createElement(
    Fragment,
    null,
    // Viz controls
    createElement(VizInput, {
      name: "replicas",
      label: "Replicas",
      inputType: "number" as const,
      value: replicas,
      setValue: setReplicas,
      min: 1,
      max: 10,
    }),
    createElement(VizInput, {
      name: "instanceType",
      label: "Instance Type",
      inputType: "text" as const,
      value: instanceType,
      setValue: setInstanceType,
    }),
    createElement(VizInput, {
      name: "region",
      label: "Region",
      inputType: "text" as const,
      value: region,
      setValue: setRegion,
    }),
    createElement(VizInput, {
      name: "environment",
      label: "Environment",
      inputType: "text" as const,
      value: env,
      setValue: setEnv,
    }),
    createElement(VizButton, {
      name: "scale-up",
      label: "Scale Up (+1)",
      handler: () => setReplicas((n: number) => Math.min(10, n + 1)),
    }),
    createElement(VizButton, {
      name: "scale-down",
      label: "Scale Down (-1)",
      handler: () => setReplicas((n: number) => Math.max(1, n - 1)),
    }),

    // Resources
    createElement(
      Vpc,
      { name: `${env}-vpc`, cidrBlock: "10.0.0.0/16", region },
      createElement(SG, { name: `${env}-web-sg` }),
      ...Array.from({ length: replicas }, (_, i) =>
        createElement(Instance, { key: `web-${i}`, name: `${env}-web-${i}`, instanceType, region }),
      ),
    ),
  );
}
